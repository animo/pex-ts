import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { arbitraryClaims, arbitraryDefinition, arbitrarySegments, toJsonPath } from '../fuzz-arbitraries.js'
import { isSupportedJsonPath, parseJsonPath } from '../json-path/parse-json-path.js'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import { parsePresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import type { Descriptor, PresentationSubmission } from './m-presentation-submission.js'
import { resolveDescriptorLocation } from './resolve-descriptor.js'
import { type PexPresentation, runPresentationSubmission } from './run-presentation-submission.js'

const index = fc.nat({ max: 3 })

/** The path shapes a submission uses, and some it shouldn't. */
const arbitraryPath = fc.oneof(
  fc.constant('$'),
  index.map((presentation) => `$[${presentation}]`),
  index.map((credential) => `$.verifiableCredential[${credential}]`),
  fc.tuple(index, index).map(([presentation, credential]) => `$[${presentation}].verifiableCredential[${credential}]`),
  fc
    .tuple(index, index)
    .map(([presentation, credential]) => `$[${presentation}].vp.verifiableCredential[${credential}]`),
  arbitrarySegments.map(toJsonPath),
  fc.string({ maxLength: 20 })
)

const arbitraryDescriptor: fc.Arbitrary<Descriptor> = fc
  .record(
    {
      id: fc.constantFrom('descriptor-0', 'descriptor-1', 'descriptor-2', 'ghost'),
      format: fc.constantFrom('dc+sd-jwt', 'ldp_vp', 'jwt_vp_json', 'mso_mdoc'),
      path: arbitraryPath,
      nestedPath: arbitraryPath,
      deeper: fc.boolean(),
    },
    { requiredKeys: ['id', 'format', 'path'] }
  )
  .map(({ id, format, path, nestedPath, deeper }) => ({
    id,
    format,
    path,
    ...(nestedPath === undefined
      ? {}
      : {
          path_nested: {
            id,
            format,
            path: nestedPath,
            ...(deeper ? { path_nested: { id, format, path: '$' } } : {}),
          },
        }),
  }))

const arbitraryCredential: fc.Arbitrary<PexCredential> = fc.oneof(
  arbitraryClaims.map((claims) => ({ credential_format: 'dc+sd-jwt' as const, claims })),
  arbitraryClaims.map((claims) => ({ credential_format: 'ldp_vc' as const, claims })),
  fc.tuple(fc.constantFrom('descriptor-0', 'descriptor-1'), arbitraryClaims).map(([doctype, claims]) => ({
    credential_format: 'mso_mdoc' as const,
    doctype,
    namespaces: { namespace: claims },
  }))
)

const arbitraryPresentations: fc.Arbitrary<PexPresentation[]> = fc.array(
  fc.record({ credentials: fc.array(arbitraryCredential, { maxLength: 3 }) }),
  { maxLength: 3 }
)

/** The presentation a path selects with a leading `$[n]`, if it does. */
function selectedPresentation(path: string): number | undefined {
  if (!isSupportedJsonPath(path)) return undefined
  const [first] = parseJsonPath(path)
  return typeof first === 'number' ? first : undefined
}

describe('resolveDescriptorLocation fuzz', () => {
  it('resolves to the presentation the path selects, and selects one when there are several', () => {
    fc.assert(
      fc.property(arbitraryDescriptor, fc.nat({ max: 4 }), (descriptor, presentationCount) => {
        const result = resolveDescriptorLocation(descriptor, { presentationCount })
        if (!result.success) return

        const selected = selectedPresentation(descriptor.path)
        if (presentationCount > 1) expect(selected).toBeDefined()
        expect(result.location.presentation_index).toBe(selected ?? 0)
      }),
      { numRuns: 2000 }
    )
  })
})

describe('runPresentationSubmission fuzz', () => {
  it('only reports a submission valid when every descriptor resolves and every input descriptor is answered', () => {
    fc.assert(
      fc.property(
        arbitraryDefinition,
        fc.array(arbitraryDescriptor, { maxLength: 4 }),
        fc.constantFrom('definition', 'other'),
        arbitraryPresentations,
        (definition, descriptorMap, definitionId, presentations) => {
          const parsed = parsePresentationDefinition(definition)
          const submission: PresentationSubmission = {
            id: 'submission',
            definition_id: definitionId,
            descriptor_map: descriptorMap,
          }
          const result = runPresentationSubmission(parsed, submission, { presentations })

          for (const issue of result.issues) expect(issue.length).toBeLessThan(400)

          for (const descriptor of result.descriptors) {
            const entry = descriptorMap[descriptor.descriptor_index] as Descriptor
            expect(descriptor.input_descriptor_id).toBe(entry.id)
            expect(presentations[descriptor.presentation_index]?.credentials[descriptor.credential_index]).toBeDefined()
            expect(descriptor.presentation_index).toBe(selectedPresentation(entry.path) ?? 0)
          }

          if (!result.valid) return
          expect(definitionId).toBe('definition')
          expect(result.issues).toEqual([])
          expect(result.descriptors).toHaveLength(descriptorMap.length)
          expect(result.descriptors.every((descriptor) => descriptor.satisfied)).toBe(true)
          for (const inputDescriptor of parsed.definition.input_descriptors) {
            expect(result.descriptors.some((descriptor) => descriptor.input_descriptor_id === inputDescriptor.id)).toBe(
              true
            )
          }
        }
      ),
      { numRuns: 2000 }
    )
  })
})
