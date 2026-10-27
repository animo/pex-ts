import { describe, expect, it } from 'vitest'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import { PexInvalidSubmissionError } from '../pex-error/e-pex.js'
import { parsePresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { createPresentationSubmission } from './create-presentation-submission.js'
import { zPresentationSubmission } from './m-presentation-submission.js'
import { type PexPresentation, resolveDescriptorCredential, resolveDescriptorLocation } from './resolve-descriptor.js'
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
      { presentation_index: 0, credential_index: undefined },
    ],
    [
      { id: 'a', format: 'mso_mdoc', path: '$[2]' },
      { presentation_index: 2, credential_index: undefined },
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
    [
      { id: 'a', format: 'ldp_vc', path: '$[2].verifiableCredential[1]' },
      { presentation_index: 2, credential_index: 1 },
    ],
    [
      {
        id: 'a',
        format: 'jwt_vp_json',
        path: '$[1]',
        path_nested: { id: 'a', format: 'jwt_vc_json', path: '$[1].vp.verifiableCredential[3]' },
      },
      { presentation_index: 1, credential_index: 3 },
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

  it.each([
    ['$[?(@.a)]', 'is not a supported JSONPath'],
    ['$.verifiableCredential', 'does not select a single credential'],
    ['$[0].verifiableCredential[1]', 'selects presentation 0, but path'],
  ])('rejects the nested path %s', (nestedPath, message) => {
    const result = resolveDescriptorLocation({
      id: 'a',
      format: 'x',
      path: '$[1]',
      path_nested: { id: 'a', format: 'y', path: nestedPath },
    })
    expect(result).toMatchObject({ success: false, message: expect.stringContaining(message) })
  })

  it('rejects nesting deeper than one level', () => {
    const result = resolveDescriptorLocation({
      id: 'a',
      format: 'x',
      path: '$',
      path_nested: {
        id: 'a',
        format: 'y',
        path: '$.verifiableCredential[0]',
        path_nested: { id: 'a', format: 'z', path: '$.verifiableCredential[0]' },
      },
    })
    expect(result).toMatchObject({ success: false, message: 'Nesting deeper than one level is not supported' })
  })

  it.each(['$', '$.verifiableCredential[0]'])(
    'rejects %s when there are several presentations, as $ is then the array of them',
    (path) => {
      const result = resolveDescriptorLocation({ id: 'a', format: 'x', path }, { presentationCount: 2 })
      expect(result).toMatchObject({ success: false, message: expect.stringContaining("with '$[n]'") })
    }
  )

  it('accepts a path selecting a presentation by index when there are several', () => {
    const result = resolveDescriptorLocation({ id: 'a', format: 'x', path: '$[1]' }, { presentationCount: 2 })
    expect(result).toEqual({ success: true, location: { presentation_index: 1, credential_index: undefined } })
  })
})

describe('resolveDescriptorCredential', () => {
  const mdl: PexCredential = { credential_format: 'mso_mdoc', doctype: 'org.iso.18013.5.1.mDL', namespaces: {} }
  const pid: PexCredential = { credential_format: 'mso_mdoc', doctype: 'eu.europa.ec.eudi.pid.1', namespaces: {} }

  it.each([
    ['an SD-JWT VC presented as itself', { id: 'a', format: 'dc+sd-jwt', path: '$[1]' }, 1, 0, sdJwt],
    [
      'a credential nested in a W3C presentation',
      {
        id: 'a',
        format: 'ldp_vp',
        path: '$[0]',
        path_nested: { id: 'a', format: 'ldp_vc', path: '$.verifiableCredential[1]' },
      },
      0,
      1,
      ldpVc,
    ],
    ['an mdoc document by doctype', { id: 'org.iso.18013.5.1.mDL', format: 'mso_mdoc', path: '$[2]' }, 2, 1, mdl],
  ])('resolves %s', (_, descriptor, presentationIndex, credentialIndex, credential) => {
    const presentations = [{ credentials: [sdJwt, ldpVc] }, { credentials: [sdJwt] }, { credentials: [pid, mdl] }]

    expect(resolveDescriptorCredential(descriptor, presentations)).toEqual({
      success: true,
      location: { presentation_index: presentationIndex, credential_index: credentialIndex },
      credential,
    })
  })

  it.each([
    [{ id: 'a', format: 'dc+sd-jwt', path: '$' }, "does not select one of the 2 presentations with '$[n]'"],
    [{ id: 'a', format: 'dc+sd-jwt', path: '$[2]' }, 'Points at presentation 2, which was not presented'],
    [
      { id: 'a', format: 'ldp_vc', path: '$[0].verifiableCredential[2]' },
      'Points at credential 2, which was not presented',
    ],
    [{ id: 'a', format: 'ldp_vp', path: '$[0]' }, 'Points at a presentation of 2 credentials without selecting one'],
  ])('rejects %o', (descriptor, message) => {
    const result = resolveDescriptorCredential(descriptor, [{ credentials: [sdJwt, ldpVc] }, { credentials: [sdJwt] }])
    expect(result).toMatchObject({ success: false, message: expect.stringContaining(message) })
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

  it('rejects a credential index beyond the credentials of the presentation', () => {
    const result = runPresentationSubmission(
      parsed,
      {
        ...submission,
        descriptor_map: [
          {
            id: 'a',
            format: 'ldp_vp',
            path: '$',
            path_nested: { id: 'a', format: 'ldp_vc', path: '$.verifiableCredential[5]' },
          },
        ],
      },
      { presentations: [{ credentials: [ldpVc] }] }
    )

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain(': Points at credential 5, which was not presented')
  })

  it('rejects a descriptor whose path it cannot resolve', () => {
    const result = runPresentationSubmission(
      parsed,
      { ...submission, descriptor_map: [{ id: 'a', format: 'ldp_vp', path: '$..given_name' }] },
      { presentations: [{ credentials: [ldpVc] }] }
    )

    expect(result.valid).toBe(false)
    expect(result.descriptors).toEqual([])
    expect(result.issues[0]).toContain("Path '$..given_name' is not a supported JSONPath")
  })

  it('rejects a path that does not select one of several presentations', () => {
    const result = runPresentationSubmission(
      parsed,
      { ...submission, descriptor_map: [{ id: 'a', format: 'dc+sd-jwt', path: '$' }] },
      { presentations }
    )

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("does not select one of the 2 presentations with '$[n]'")
  })

  it('evaluates the presentation a path selects, not the first', () => {
    const answering = { ...ldpVc, claims: { given_name: 'Erika' } }
    const other = { ...ldpVc, claims: {} }
    const result = runPresentationSubmission(
      parsed,
      { ...submission, descriptor_map: [{ id: 'a', format: 'ldp_vp', path: '$[1].verifiableCredential[0]' }] },
      { presentations: [{ credentials: [answering] }, { credentials: [other] }] }
    )

    expect(result.descriptors[0]).toMatchObject({ presentation_index: 1, credential_index: 0, satisfied: false })
  })

  it('rejects a presentation without credentials', () => {
    const result = runPresentationSubmission(
      parsed,
      { ...submission, descriptor_map: [{ id: 'a', format: 'dc+sd-jwt', path: '$' }] },
      { presentations: [{ credentials: [] }] }
    )

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain(': Points at a presentation without credentials')
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

describe('runPresentationSubmission checks', () => {
  const single = (definition: unknown, credential: PexCredential, path = '$') => {
    const parsedDefinition = parsePresentationDefinition(definition)
    const id = parsedDefinition.definition.input_descriptors[0]?.id ?? ''
    return runPresentationSubmission(
      parsedDefinition,
      { id: 's', definition_id: parsedDefinition.definition.id, descriptor_map: [{ id, format: 'x', path }] },
      { presentations: [{ credentials: [credential] }] }
    )
  }

  it('runs the same constraint checks as the query', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        {
          id: 'x',
          constraints: {
            subject_is_issuer: 'required',
            is_holder: [{ field_id: ['f'], directive: 'required' }],
            fields: [{ id: 'f', path: ['$.given_name'] }],
          },
        },
      ],
    }

    const result = single(definition, { ...sdJwt, issuer: 'a', subject: 'b' })
    expect(result.valid).toBe(false)
    expect(result.descriptors[0]?.reasons.map((reason) => reason.type)).toEqual([
      'unsupported_constraint',
      'subject_is_issuer',
    ])
  })

  it('checks the doctype of an mdoc', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        { id: 'org.iso.18013.5.1.mDL', constraints: { fields: [{ path: ["$['org.iso.18013.5.1']['family_name']"] }] } },
      ],
    }
    const mdoc = (doctype: string): PexCredential => ({
      credential_format: 'mso_mdoc',
      doctype,
      namespaces: { 'org.iso.18013.5.1': { family_name: 'Mustermann' } },
    })

    expect(single(definition, mdoc('org.iso.18013.5.1.mDL')).valid).toBe(true)
    expect(single(definition, mdoc('com.example.other')).descriptors[0]?.reasons[0]?.type).toBe('mdoc_doctype')
  })

  it('selects the mdoc document of a device response by doctype', () => {
    const definition = parsePresentationDefinition({
      id: 'd',
      input_descriptors: [
        { id: 'org.iso.18013.5.1.mDL', constraints: { fields: [{ path: ["$['org.iso.18013.5.1']['family_name']"] }] } },
        {
          id: 'eu.europa.ec.eudi.pid.1',
          constraints: { fields: [{ path: ["$['eu.europa.ec.eudi.pid.1']['given_name']"] }] },
        },
      ],
    })
    const deviceResponse: PexPresentation = {
      credentials: [
        {
          credential_format: 'mso_mdoc' as const,
          doctype: 'eu.europa.ec.eudi.pid.1',
          namespaces: { 'eu.europa.ec.eudi.pid.1': { given_name: 'Erika' } },
        },
        {
          credential_format: 'mso_mdoc' as const,
          doctype: 'org.iso.18013.5.1.mDL',
          namespaces: { 'org.iso.18013.5.1': { family_name: 'Mustermann' } },
        },
      ],
    }
    const submission = {
      id: 's',
      definition_id: 'd',
      descriptor_map: [
        { id: 'org.iso.18013.5.1.mDL', format: 'mso_mdoc', path: '$' },
        { id: 'eu.europa.ec.eudi.pid.1', format: 'mso_mdoc', path: '$' },
      ],
    }

    const result = runPresentationSubmission(definition, submission, { presentations: [deviceResponse] })
    expect(result.valid).toBe(true)
    expect(result.descriptors.map((descriptor) => descriptor.credential_index)).toEqual([1, 0])

    const ambiguous = runPresentationSubmission(definition, submission, {
      presentations: [{ credentials: [sdJwt, ldpVc] }],
    })
    expect(ambiguous.valid).toBe(false)
    expect(ambiguous.issues[0]).toContain('without selecting one')

    const twice = runPresentationSubmission(definition, submission, {
      presentations: [
        { credentials: [deviceResponse.credentials[1], deviceResponse.credentials[1]] as PexCredential[] },
      ],
    })
    expect(twice.valid).toBe(false)
    expect(twice.issues[0]).toContain("2 mdoc documents have doctype 'org.iso.18013.5.1.mDL'")
  })

  it('matches an array index against any element, as a disclosed array has gaps closed', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        { id: 'x', constraints: { fields: [{ path: ['$.nationalities[1]'], filter: { const: 'NL' } }] } },
      ],
    }

    // The holder disclosed only the second element, which is the first after presenting
    expect(single(definition, { credential_format: 'dc+sd-jwt', claims: { nationalities: ['NL'] } }).valid).toBe(true)
  })

  it('passes an optional field whose index matched only elements failing the filter, as that one may be withheld', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        {
          id: 'x',
          constraints: {
            fields: [
              { path: ['$.nationalities[2]'], optional: true, filter: { const: 'NL' } },
              { path: ['$.nationalities[0]'] },
            ],
          },
        },
      ],
    }
    // The holder had one nationality, so the optional field resolved nothing for them
    const result = single(definition, { credential_format: 'dc+sd-jwt', claims: { nationalities: ['DE'] } })

    expect(result.valid).toBe(true)
    expect(result.descriptors[0]?.fields[0]).toMatchObject({ field_index: 0, nodes: [] })
  })

  it('tries the next path when an index matched only elements failing the filter', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        {
          id: 'x',
          constraints: {
            fields: [{ path: ['$.nationalities[1]', '$.nationality'], filter: { const: 'NL' } }],
          },
        },
      ],
    }

    expect(
      single(definition, { credential_format: 'dc+sd-jwt', claims: { nationalities: ['DE'], nationality: 'NL' } }).valid
    ).toBe(true)
    // Without an index, the first path that resolves still decides
    expect(
      single(
        {
          ...definition,
          input_descriptors: [
            { id: 'x', constraints: { fields: [{ path: ['$.country', '$.nationality'], filter: { const: 'NL' } }] } },
          ],
        },
        { credential_format: 'dc+sd-jwt', claims: { country: 'DE', nationality: 'NL' } }
      ).valid
    ).toBe(false)
  })

  it('fails a required field whose index matched only elements failing the filter', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        { id: 'x', constraints: { fields: [{ path: ['$.nationalities[1]'], filter: { const: 'NL' } }] } },
      ],
    }
    const result = single(definition, { credential_format: 'dc+sd-jwt', claims: { nationalities: ['DE'] } })

    expect(result.valid).toBe(false)
    expect(result.descriptors[0]?.reasons[0]).toMatchObject({ type: 'field', cause: 'filter_failed' })
  })

  it('accepts a predicate result only from a credential that declares it presents them', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        {
          id: 'x',
          constraints: {
            fields: [{ path: ['$.age'], predicate: 'required', filter: { type: 'number', minimum: 18 } }],
          },
        },
      ],
    }
    const credential: PexCredential = { credential_format: 'ldp_vc', claims: { age: true } }

    expect(single(definition, credential).valid).toBe(false)
    expect(single(definition, { ...credential, predicate_results: true }).valid).toBe(true)
  })

  it('fails a format restriction the credential declares nothing for', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        {
          id: 'x',
          format: { 'dc+sd-jwt': { 'sd-jwt_alg_values': ['ES256'], 'kb-jwt_alg_values': ['ES256'] } },
          constraints: { fields: [{ path: ['$.given_name'] }] },
        },
      ],
    }

    expect(single(definition, sdJwt).descriptors[0]?.reasons[0]?.message).toContain('does not declare its algorithm')
    expect(single(definition, { ...sdJwt, algorithms: ['ES256'], key_binding_algorithms: ['ES256'] }).valid).toBe(true)
    expect(single(definition, { ...sdJwt, algorithms: ['ES256'], key_binding_algorithms: ['EdDSA'] }).valid).toBe(false)
  })

  it('fails a pick requirement when more than max were submitted', () => {
    const grouped = parsePresentationDefinition({
      id: 'd',
      input_descriptors: [
        { id: 'a', group: ['A'], constraints: { fields: [{ path: ['$.given_name'] }] } },
        { id: 'b', group: ['A'], constraints: { fields: [{ path: ['$.family_name'] }] } },
      ],
      submission_requirements: [{ rule: 'pick', from: 'A', min: 1, max: 1 }],
    })
    const both = createPresentationSubmission(grouped.definition, {
      id: 's',
      entries: [
        { input_descriptor_id: 'a', format: 'dc+sd-jwt', presentation_index: 0 },
        { input_descriptor_id: 'b', format: 'dc+sd-jwt', presentation_index: 1 },
      ],
    })

    const result = runPresentationSubmission(grouped, both, {
      presentations: [{ credentials: [sdJwt] }, { credentials: [sdJwt] }],
    })
    expect(result.valid).toBe(false)
    expect(result.submission_requirements?.[0]?.satisfied).toBe(false)
  })

  it('fails a pick requirement unless exactly count were submitted', () => {
    const grouped = parsePresentationDefinition({
      id: 'd',
      input_descriptors: [
        { id: 'a', group: ['A'], constraints: { fields: [{ path: ['$.given_name'] }] } },
        { id: 'b', group: ['A'], constraints: { fields: [{ path: ['$.family_name'] }] } },
      ],
      submission_requirements: [{ rule: 'pick', from: 'A', count: 1 }],
    })
    const submit = (ids: string[]) =>
      runPresentationSubmission(
        grouped,
        createPresentationSubmission(grouped.definition, {
          id: 's',
          entries: ids.map((id, index) => ({
            input_descriptor_id: id,
            format: 'dc+sd-jwt',
            presentation_index: index,
          })),
        }),
        { presentations: ids.map(() => ({ credentials: [sdJwt] })) }
      )

    expect(submit(['a']).valid).toBe(true)
    expect(submit(['a', 'b']).valid).toBe(false)
    expect(submit(['a', 'b']).submission_requirements?.[0]?.satisfied).toBe(false)
  })

  it('does not satisfy a requirement over a group no input descriptor declares', () => {
    const typo = parsePresentationDefinition({
      id: 'd',
      input_descriptors: [{ id: 'a', group: ['A'], constraints: { fields: [{ path: ['$.given_name'] }] } }],
      submission_requirements: [{ rule: 'all', from: 'typo' }],
    })

    const result = runPresentationSubmission(
      typo,
      { id: 's', definition_id: 'd', descriptor_map: [] },
      { presentations: [] }
    )
    expect(result.valid).toBe(false)
    expect(result.submission_requirements?.[0]).toMatchObject({ satisfied: false, needs_count: 0 })
  })

  it('shortens what it quotes from the submission', () => {
    const result = runPresentationSubmission(
      parsed,
      {
        id: 's',
        definition_id: 'definition-1',
        descriptor_map: [{ id: 'a'.repeat(10_000), format: 'dc+sd-jwt', path: `$${'.a'.repeat(10_000)}` }],
      },
      { presentations: [] }
    )

    expect(result.valid).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.length ?? 0).toBeLessThan(400)
  })
})
