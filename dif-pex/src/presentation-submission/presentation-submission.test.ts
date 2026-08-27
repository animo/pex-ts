import { describe, expect, it } from 'vitest'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import { PexInvalidSubmissionError } from '../pex-error/e-pex.js'
import { parsePresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { createPresentationSubmission } from './create-presentation-submission.js'
import { zPresentationSubmission } from './m-presentation-submission.js'
import { resolveDescriptorLocation } from './resolve-descriptor.js'
import { runPresentationSubmission } from './run-presentation-submission.js'

const parsed = parsePresentationDefinition({
  id: 'definition-1',
  input_descriptors: [
    { id: 'a', constraints: { fields: [{ path: ['$.given_name'] }] } },
    { id: 'b', constraints: { fields: [{ path: ['$.family_name'] }] } },
  ],
})

const sdJwt: PexCredential = {
  credential_format: 'dc+sd-jwt',
  claims: { given_name: 'Erika', family_name: 'Mustermann' },
}

const ldpVc: PexCredential = {
  credential_format: 'ldp_vc',
  claims: { given_name: 'Erika', family_name: 'Mustermann' },
}

describe('createPresentationSubmission', () => {
  it('writes a self-describing format at the root, with nothing nested', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'sub-1',
      entries: [{ input_descriptor_id: 'a', format: 'dc+sd-jwt' }],
    })

    expect(submission).toEqual({
      id: 'sub-1',
      definition_id: 'definition-1',
      descriptor_map: [{ id: 'a', format: 'dc+sd-jwt', path: '$' }],
    })
  })

  it('wraps a W3C credential in its presentation format and nests the credential path', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'sub-1',
      entries: [{ input_descriptor_id: 'a', format: 'ldp_vc', credential_index: 1 }],
    })

    expect(submission.descriptor_map[0]).toEqual({
      id: 'a',
      format: 'ldp_vp',
      path: '$',
      path_nested: { id: 'a', format: 'ldp_vc', path: '$.verifiableCredential[1]' },
    })
  })

  it('nests a JWT VC under vp.verifiableCredential', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'sub-1',
      entries: [{ input_descriptor_id: 'a', format: 'jwt_vc_json' }],
    })

    expect(submission.descriptor_map[0]).toMatchObject({
      format: 'jwt_vp_json',
      path_nested: { format: 'jwt_vc_json', path: '$.vp.verifiableCredential[0]' },
    })
  })

  it('indexes the presentation only when there is more than one', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'sub-1',
      entries: [
        { input_descriptor_id: 'a', format: 'dc+sd-jwt', presentation_index: 0 },
        { input_descriptor_id: 'b', format: 'mso_mdoc', presentation_index: 1 },
      ],
    })

    expect(submission.descriptor_map.map((descriptor) => descriptor.path)).toEqual(['$[0]', '$[1]'])
  })

  it('addresses the credential directly when embedded in the presentation', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'sub-1',
      location: 'presentation',
      entries: [
        { input_descriptor_id: 'a', format: 'ldp_vc', credential_index: 2 },
        { input_descriptor_id: 'b', format: 'dc+sd-jwt' },
      ],
    })

    expect(submission.descriptor_map).toEqual([
      { id: 'a', format: 'ldp_vc', path: '$.verifiableCredential[2]' },
      { id: 'b', format: 'dc+sd-jwt', path: '$' },
    ])
  })

  it('rejects an entry for an input descriptor the definition does not declare', () => {
    expect(() =>
      createPresentationSubmission(parsed.definition, {
        id: 'sub-1',
        entries: [{ input_descriptor_id: 'nope', format: 'dc+sd-jwt' }],
      })
    ).toThrow(PexInvalidSubmissionError)
  })

  it('produces a submission that parses against the model', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'sub-1',
      entries: [{ input_descriptor_id: 'a', format: 'ldp_vc' }],
    })

    expect(zPresentationSubmission.safeParse(submission).success).toBe(true)
  })
})

describe('resolveDescriptorLocation', () => {
  it.each([
    [
      { id: 'a', format: 'dc+sd-jwt', path: '$' },
      { presentation_index: 0, credential_index: 0 },
    ],
    [
      { id: 'a', format: 'mso_mdoc', path: '$[2]' },
      { presentation_index: 2, credential_index: 0 },
    ],
    [
      {
        id: 'a',
        format: 'ldp_vp',
        path: '$',
        path_nested: { id: 'a', format: 'ldp_vc', path: '$.verifiableCredential[1]' },
      },
      { presentation_index: 0, credential_index: 1 },
    ],
    [
      {
        id: 'a',
        format: 'jwt_vp_json',
        path: '$[1]',
        path_nested: { id: 'a', format: 'jwt_vc_json', path: '$.vp.verifiableCredential[3]' },
      },
      { presentation_index: 1, credential_index: 3 },
    ],
    [
      { id: 'a', format: 'ldp_vc', path: '$.verifiableCredential[1]' },
      { presentation_index: 0, credential_index: 1 },
    ],
  ])('resolves %o', (descriptor, expected) => {
    const result = resolveDescriptorLocation(descriptor)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.location).toEqual(expected)
  })

  it('rejects a path that addresses neither a presentation nor a credential', () => {
    expect(resolveDescriptorLocation({ id: 'a', format: 'x', path: '$.verifiableCredential' }).success).toBe(false)
  })

  it('rejects a path_nested that contradicts an already-specific path', () => {
    const result = resolveDescriptorLocation({
      id: 'a',
      format: 'x',
      path: '$.verifiableCredential[0]',
      path_nested: { id: 'a', format: 'y', path: '$.verifiableCredential[1]' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported JSONPath', () => {
    expect(resolveDescriptorLocation({ id: 'a', format: 'x', path: '$[?(@.a)]' }).success).toBe(false)
  })
})

describe('runPresentationSubmission', () => {
  const submission = createPresentationSubmission(parsed.definition, {
    id: 'sub-1',
    entries: [
      { input_descriptor_id: 'a', format: 'dc+sd-jwt', presentation_index: 0 },
      { input_descriptor_id: 'b', format: 'dc+sd-jwt', presentation_index: 1 },
    ],
  })

  const presentations = [{ credentials: [sdJwt] }, { credentials: [sdJwt] }]

  it('accepts a submission that answers the definition', () => {
    const result = runPresentationSubmission(parsed, submission, { presentations })

    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.descriptors.map((descriptor) => descriptor.satisfied)).toEqual([true, true])
  })

  it('resolves a nested credential path', () => {
    const nestedSubmission = createPresentationSubmission(parsed.definition, {
      id: 'sub-2',
      entries: [
        { input_descriptor_id: 'a', format: 'ldp_vc', credential_index: 0 },
        { input_descriptor_id: 'b', format: 'ldp_vc', credential_index: 1 },
      ],
    })

    const result = runPresentationSubmission(parsed, nestedSubmission, {
      presentations: [{ credentials: [ldpVc, ldpVc] }],
    })

    expect(result.valid).toBe(true)
    expect(result.descriptors.map((d) => d.credential_index)).toEqual([0, 1])
  })

  it('rejects a submission for a different definition', () => {
    const result = runPresentationSubmission(parsed, { ...submission, definition_id: 'other' }, { presentations })

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("Submission is for definition 'other'")
  })

  it('rejects a descriptor naming an input descriptor the definition does not declare', () => {
    const result = runPresentationSubmission(
      parsed,
      { ...submission, descriptor_map: [{ id: 'ghost', format: 'dc+sd-jwt', path: '$' }] },
      { presentations }
    )

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("claims input descriptor 'ghost'")
  })

  it('rejects a descriptor pointing at a credential that was not presented', () => {
    const result = runPresentationSubmission(parsed, submission, { presentations: [{ credentials: [sdJwt] }] })

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain('which was not presented')
  })

  it('does not take the holder at their word about satisfying a descriptor', () => {
    // The submission says this credential satisfies 'b', but it carries no family_name.
    const result = runPresentationSubmission(
      parsed,
      {
        ...submission,
        descriptor_map: [...submission.descriptor_map.slice(0, 1), { id: 'b', format: 'dc+sd-jwt', path: '$[1]' }],
      },
      { presentations: [{ credentials: [sdJwt] }, { credentials: [{ ...sdJwt, claims: { given_name: 'Erika' } }] }] }
    )

    expect(result.valid).toBe(false)
    expect(result.descriptors[1]?.satisfied).toBe(false)
    expect(result.descriptors[1]?.reasons[0]).toMatchObject({ type: 'field', cause: 'path_not_found' })
  })

  it('fails when a descriptor is missing for a required input descriptor', () => {
    const result = runPresentationSubmission(
      parsed,
      { ...submission, descriptor_map: submission.descriptor_map.slice(0, 1) },
      { presentations }
    )

    // Descriptor 'a' is fine, but 'b' was never answered.
    expect(result.descriptors.every((descriptor) => descriptor.satisfied)).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('checks the submission against submission requirements', () => {
    const grouped = parsePresentationDefinition({
      id: 'definition-1',
      input_descriptors: [
        { id: 'a', group: ['A'], constraints: { fields: [{ path: ['$.given_name'] }] } },
        { id: 'b', group: ['A'], constraints: { fields: [{ path: ['$.family_name'] }] } },
      ],
      submission_requirements: [{ rule: 'pick', from: 'A', count: 1 }],
    })

    const partial = createPresentationSubmission(grouped.definition, {
      id: 'sub-3',
      entries: [{ input_descriptor_id: 'a', format: 'dc+sd-jwt' }],
    })

    const result = runPresentationSubmission(grouped, partial, { presentations: [{ credentials: [sdJwt] }] })

    // One of the group is enough, so answering only 'a' is valid here.
    expect(result.valid).toBe(true)
    expect(result.submission_requirements?.[0]?.satisfied).toBe(true)
  })

  it('round-trips: query, submit the winners, verify', () => {
    const result = runPresentationSubmission(
      parsed,
      createPresentationSubmission(parsed.definition, {
        id: 'sub-4',
        entries: parsed.definition.input_descriptors.map((inputDescriptor, index) => ({
          input_descriptor_id: inputDescriptor.id,
          format: 'dc+sd-jwt' as const,
          presentation_index: index,
        })),
      }),
      { presentations }
    )

    expect(result.valid).toBe(true)
  })
})
