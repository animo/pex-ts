import { isDeepStrictEqual } from 'node:util'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { runFilter } from '../filter/run-filter.js'
import { arbitraryQueryCase } from '../fuzz-arbitraries.js'
import type { PathComponent } from '../json-path/m-json-path.js'
import { isPlainObject } from '../json-path/query-json-path.js'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import type { Field } from '../presentation-definition/m-field.js'
import { parsePresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { createPresentationSubmission } from '../presentation-submission/create-presentation-submission.js'
import { runPresentationSubmission } from '../presentation-submission/run-presentation-submission.js'
import type { JsonObject } from '../u-pex.js'
import { runPexQuery } from './run-pex-query.js'

const missing = Symbol('missing')

/** The value at a concrete path, reading own properties only. */
function valueAt(root: unknown, path: PathComponent[]): unknown {
  let value = root
  for (const component of path) {
    if (Array.isArray(value) && typeof component === 'number' && component < value.length) value = value[component]
    else if (isPlainObject(value) && typeof component === 'string' && Object.hasOwn(value, component))
      value = value[component]
    else return missing
  }
  return value
}

const isPrefix = (prefix: PathComponent[], path: PathComponent[]) =>
  prefix.length <= path.length && prefix.every((component, index) => component === path[index])

/** Every leaf of a value with its path. An empty object or array is a leaf. */
function leavesOf(value: unknown, path: PathComponent[] = []): Array<{ path: PathComponent[]; value: unknown }> {
  if (Array.isArray(value) && value.length > 0)
    return value.flatMap((element, index) => leavesOf(element, [...path, index]))
  if (isPlainObject(value) && Object.keys(value).length > 0)
    return Object.entries(value).flatMap(([key, child]) => leavesOf(child, [...path, key]))
  return [{ path, value }]
}

/**
 * What an SD-JWT presentation of `paths` reveals: each disclosed claim with everything below it, and the
 * arrays on the way to one holding only the elements on a path, in order. A withheld element is gone,
 * not `null`.
 */
function present(value: unknown, paths: PathComponent[][]): unknown {
  if (paths.some((path) => path.length === 0)) return value
  const below = (component: PathComponent) => paths.filter((path) => path[0] === component).map((path) => path.slice(1))

  if (Array.isArray(value)) {
    return value.flatMap((element, index) => {
      const childPaths = below(index)
      return childPaths.length === 0 ? [] : [present(element, childPaths)]
    })
  }

  const output: Record<string, unknown> = {}
  for (const key of new Set(paths.map((path) => path[0]))) {
    if (typeof key !== 'string' || !isPlainObject(value) || !Object.hasOwn(value, key)) continue
    Object.defineProperty(output, key, {
      value: present(value[key], below(key)),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return output
}

describe('runPexQuery fuzz', () => {
  it('only matches nodes that are in the credential and pass the filter', () => {
    fc.assert(
      fc.property(arbitraryQueryCase, ({ definition, credentials }) => {
        const parsed = parsePresentationDefinition(definition)
        const result = runPexQuery(parsed, { credentials })

        for (const [descriptorIndex, inputDescriptor] of result.input_descriptors.entries()) {
          const fields = (parsed.definition.input_descriptors[descriptorIndex]?.constraints?.fields ?? []) as Field[]
          expect(inputDescriptor.satisfied).toBe(inputDescriptor.matching_credentials.length > 0)

          for (const match of inputDescriptor.matching_credentials) {
            const claims = (credentials[match.credential_index] as { claims: JsonObject }).claims
            for (const fieldMatch of match.fields) {
              const field = fields[fieldMatch.field_index] as Field
              for (const node of fieldMatch.nodes) {
                const value = valueAt(claims, node.path)
                expect(value).not.toBe(missing)
                if (field.filter) expect(runFilter(value, field.filter).success).toBe(true)
                expect(node.value).toBe(field.predicate === undefined ? value : true)
              }
            }
          }
        }
      }),
      { numRuns: 1000 }
    )
  })

  it('discloses exactly the matched claims', () => {
    fc.assert(
      fc.property(arbitraryQueryCase, ({ definition, credentials }) => {
        const result = runPexQuery(parsePresentationDefinition(definition), { credentials })

        for (const match of result.input_descriptors.flatMap((descriptor) => descriptor.matching_credentials)) {
          const claims = (credentials[match.credential_index] as { claims: JsonObject }).claims
          const nodePaths = (predicate: boolean) =>
            match.fields
              .filter((field) => (field.predicate !== undefined) === predicate)
              .flatMap((field) => field.nodes.map((node) => node.path))
          const valuePaths = nodePaths(false)
          const predicatePaths = nodePaths(true)
          const { output, paths } = match.disclosure

          // `paths` is every matched claim, leaving out a claim below another one
          const allPaths = [...valuePaths, ...predicatePaths]
          const minimal = allPaths.filter(
            (path, index) =>
              !allPaths.some(
                (other, otherIndex) => isPrefix(other, path) && (other.length < path.length || otherIndex < index)
              )
          )
          expect(new Set(paths.map((path) => JSON.stringify(path)))).toEqual(
            new Set(minimal.map((path) => JSON.stringify(path)))
          )

          // `output` holds a disclosed claim as it is, a predicate result as `true`, and nothing else
          for (const leaf of leavesOf(output).filter((leaf) => leaf.path.length > 0)) {
            if (valuePaths.some((path) => isPrefix(path, leaf.path))) {
              expect(isDeepStrictEqual(leaf.value, valueAt(claims, leaf.path))).toBe(true)
            } else if (leaf.value === null) {
              // The `null` that keeps the index of a later element of an array
              expect(Array.isArray(valueAt(output, leaf.path.slice(0, -1)))).toBe(true)
            } else {
              expect(predicatePaths.some((path) => isPrefix(path, leaf.path))).toBe(true)
              expect(leaf.value).toBe(true)
            }
          }

          for (const path of valuePaths) {
            expect(isDeepStrictEqual(valueAt(output, path), valueAt(claims, path))).toBe(true)
          }
          // A predicate claim is `true`, unless a disclosed claim covers it or lies below it, or it lies below
          // another predicate claim
          for (const path of predicatePaths) {
            if (valuePaths.some((other) => isPrefix(other, path) || isPrefix(path, other))) continue
            if (predicatePaths.some((other) => other.length < path.length && isPrefix(other, path))) continue
            expect(valueAt(output, path)).toBe(true)
          }
        }
      }),
      { numRuns: 1000 }
    )

    expect(Object.keys(Object.prototype)).toEqual([])
  })

  it('builds a submission a verifier accepts from what the holder discloses', () => {
    fc.assert(
      fc.property(arbitraryQueryCase, ({ definition, credentials }) => {
        const parsed = parsePresentationDefinition(definition)
        const result = runPexQuery(parsed, { credentials })
        if (!result.can_be_satisfied) return

        const chosen = result.input_descriptors.map((inputDescriptor) => {
          const match = inputDescriptor.matching_credentials[0]
          if (!match) throw new Error('A satisfiable definition has a match for every input descriptor')
          const claims = (credentials[match.credential_index] as { claims: JsonObject }).claims
          return {
            input_descriptor_id: inputDescriptor.input_descriptor_id,
            credential: {
              credential_format: 'dc+sd-jwt',
              claims: present(claims, match.disclosure.paths) as JsonObject,
            } satisfies PexCredential,
          }
        })

        const submission = createPresentationSubmission(parsed.definition, {
          id: 'submission',
          entries: chosen.map(({ input_descriptor_id }, index) => ({
            input_descriptor_id,
            format: 'dc+sd-jwt',
            presentation_index: chosen.length > 1 ? index : undefined,
          })),
        })
        const verified = runPresentationSubmission(parsed, submission, {
          presentations: chosen.map(({ credential }) => ({ credentials: [credential] })),
        })

        expect(verified.issues).toEqual([])
        expect(verified.descriptors.flatMap((descriptor) => descriptor.reasons)).toEqual([])
        expect(verified.valid).toBe(true)
      }),
      { numRuns: 1000 }
    )
  })
})
