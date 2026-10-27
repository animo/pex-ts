import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { arbitraryClaims, arbitraryJson } from '../fuzz-arbitraries.js'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import { PexParseError } from '../pex-error/e-pex.js'
import { runPexQuery } from '../pex-query-result/run-pex-query.js'
import { parsePresentationDefinition, safeParsePresentationDefinition } from './m-presentation-definition.js'
import { getPresentationDefinitionIssues } from './validate-definition.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/dif-pe-examples')

/** The corpus definitions this library parses, as a starting point for mutations. */
const corpus: unknown[] = ['pdV1', 'pdV2']
  .flatMap((version) =>
    readdirSync(join(fixturesDir, version))
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(fixturesDir, version, file), 'utf8')))
  )
  .map((contents) => contents.presentation_definition ?? contents)
  .filter((definition) => safeParsePresentationDefinition(definition).success)

type Container = Record<string, unknown> | unknown[]

function containersOf(root: unknown): Container[] {
  const containers: Container[] = []
  const pending = [root]
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null) continue
    containers.push(value as Container)
    pending.push(...Object.values(value))
  }
  return containers
}

/** Keys the models know, so a mutation often changes something that is read rather than rejected. */
const mutationKey = fc.constantFrom(
  ...['id', 'path', 'filter', 'constraints', 'fields', 'format', 'group', 'from', 'from_nested', 'rule'],
  ...['count', 'min', 'max', 'optional', 'predicate', 'limit_disclosure', 'type', 'const', 'not', 'unknown'],
  ...['__proto__', 'constructor']
)

const mutation = fc.record({
  target: fc.nat(),
  operation: fc.constantFrom('delete', 'replace', 'add'),
  key: mutationKey,
  value: arbitraryJson,
})

type Mutation = typeof mutation extends fc.Arbitrary<infer Value> ? Value : never

/** Delete, replace or add a property or element somewhere in a copy of the definition. */
function mutate(definition: unknown, mutations: Mutation[]): unknown {
  const copy = structuredClone(definition)
  for (const { target, operation, key, value } of mutations) {
    const containers = containersOf(copy)
    const container = containers[target % containers.length] as Container
    const keys = Object.keys(container)
    const existing = keys.length === 0 ? undefined : keys[target % keys.length]

    if (Array.isArray(container)) {
      if (operation === 'delete' && existing !== undefined) container.splice(Number(existing), 1)
      else if (operation === 'replace' && existing !== undefined) container[Number(existing)] = value
      else container.push(value)
    } else if (operation === 'delete' && existing !== undefined) delete container[existing]
    else if (operation === 'replace' && existing !== undefined) container[existing] = value
    else Object.defineProperty(container, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return copy
}

const arbitraryCredential: fc.Arbitrary<PexCredential> = fc.oneof(
  arbitraryClaims.map((claims) => ({ credential_format: 'dc+sd-jwt' as const, claims })),
  arbitraryClaims.map((claims) => ({ credential_format: 'ldp_vc' as const, claims })),
  arbitraryClaims.map((claims) => ({
    credential_format: 'mso_mdoc' as const,
    doctype: 'org.iso.18013.5.1.mDL',
    namespaces: { 'org.iso.18013.5.1': claims },
  }))
)

describe('presentation definition fuzz', () => {
  it('has a corpus to mutate', () => {
    expect(corpus.length).toBeGreaterThan(10)
  })

  it('parses any input, or throws a PexParseError', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), arbitraryJson), (input) => {
        expect(safeParsePresentationDefinition(input).success).toBeTypeOf('boolean')
        try {
          parsePresentationDefinition(input)
        } catch (error) {
          expect(error).toBeInstanceOf(PexParseError)
        }
      }),
      { numRuns: 1000 }
    )
  })

  it('parses, validates and evaluates a mutated corpus definition without throwing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...corpus),
        fc.array(mutation, { minLength: 1, maxLength: 3 }),
        fc.array(arbitraryCredential, { maxLength: 3 }),
        (definition, mutations, credentials) => {
          const parsed = safeParsePresentationDefinition(mutate(definition, mutations))
          if (!parsed.success) return

          getPresentationDefinitionIssues(parsed.definition)
          const result = runPexQuery(parsed, { credentials })

          for (const inputDescriptor of result.input_descriptors) {
            const indexes = [...inputDescriptor.matching_credentials, ...inputDescriptor.non_matching_credentials]
              .map((credential) => credential.credential_index)
              .sort()
            expect(indexes).toEqual(credentials.map((_, index) => index))
            expect(inputDescriptor.satisfied).toBe(inputDescriptor.matching_credentials.length > 0)
            for (const mismatch of inputDescriptor.non_matching_credentials) {
              expect(mismatch.reasons.length).toBeGreaterThan(0)
            }
          }
        }
      ),
      // About one in ten mutated definitions still parses
      { numRuns: 2000 }
    )

    expect(Object.keys(Object.prototype)).toEqual([])
  })
})
