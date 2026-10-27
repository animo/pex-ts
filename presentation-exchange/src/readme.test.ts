/**
 * Executes the code in README.md, so the documentation cannot drift from the API.
 *
 * Each test mirrors one section. Keep them in the same order as the README, and update both
 * together.
 */
import { describe, expect, it } from 'vitest'
import {
  createPresentationSubmission,
  type Descriptor,
  isSupportedJsonPath,
  type PexCredential,
  parseJsonPath,
  parsePresentationDefinition,
  queryPresentationDefinition,
  resolveDescriptorCredential,
  runPexQuery,
  runPresentationSubmission,
  stringifyJsonPath,
  validatePresentationDefinition,
  zFilter,
} from './index.js'

const presentationDefinition = {
  id: 'readme',
  input_descriptors: [
    {
      id: 'identity',
      group: ['A'],
      constraints: {
        limit_disclosure: 'required',
        fields: [
          { path: ['$.vct'], filter: { type: 'string', const: 'https://example.com/IdentityCredential' } },
          { path: ['$.given_name'] },
        ],
      },
    },
  ],
}

describe('README: quick start', () => {
  it('runs the first example', () => {
    const result = queryPresentationDefinition(presentationDefinition, {
      credentials: [
        {
          credential_format: 'dc+sd-jwt',
          claims: { vct: 'https://example.com/IdentityCredential', given_name: 'Erika' },
        },
      ],
    })

    expect(result.can_be_satisfied).toBe(true)

    const pairs: string[] = []
    for (const inputDescriptor of result.input_descriptors) {
      for (const match of inputDescriptor.matching_credentials) {
        pairs.push(`${inputDescriptor.input_descriptor_id} <- ${match.credential_index}`)
      }
    }
    expect(pairs).toEqual(['identity <- 0'])
  })

  it('runs the parse-once example', () => {
    const parsed = parsePresentationDefinition(presentationDefinition)
    validatePresentationDefinition(parsed.definition)

    expect(parsed.version).toBe('v2')

    const result = runPexQuery(parsed, {
      credentials: [{ credential_format: 'dc+sd-jwt', claims: { vct: 'x', given_name: 'y' } }],
    })
    expect(result.can_be_satisfied).toBe(false)
  })
})

describe('README: credentials', () => {
  it('accepts each documented credential shape', () => {
    const credentials: PexCredential[] = [
      {
        credential_format: 'mso_mdoc',
        doctype: 'org.iso.18013.5.1.mDL',
        namespaces: { 'org.iso.18013.5.1': { family_name: 'Mustermann' } },
      },
      { credential_format: 'vc+sd-jwt', claims: { vct: '...', given_name: 'Erika' } },
      { credential_format: 'dc+sd-jwt', claims: {} },
      { credential_format: 'ldp_vc', claims: { '@context': [], credentialSubject: {} } },
    ]

    expect(credentials).toHaveLength(4)
  })

  it('resolves an mdoc path against namespaces with no special handling', () => {
    const result = queryPresentationDefinition(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'org.iso.18013.5.1.mDL',
            constraints: { fields: [{ path: ["$['org.iso.18013.5.1']['family_name']"] }] },
          },
        ],
      },
      {
        credentials: [
          {
            credential_format: 'mso_mdoc',
            doctype: 'org.iso.18013.5.1.mDL',
            namespaces: { 'org.iso.18013.5.1': { family_name: 'Mustermann' } },
          },
        ],
      }
    )

    expect(result.can_be_satisfied).toBe(true)
  })

  it('admits through a presentation designation the credentials such a presentation carries', () => {
    const definition = (format: unknown) => ({
      id: 'd',
      format,
      input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.name'] }] } }],
    })
    const ldpVc: PexCredential = { credential_format: 'ldp_vc', claims: { name: 'Erika' } }
    const sdJwtVc: PexCredential = { credential_format: 'dc+sd-jwt', claims: { name: 'Erika' } }
    const ldpVp = { ldp_vp: { proof_type: ['Ed25519Signature2018'] } }

    expect(queryPresentationDefinition(definition(ldpVp), { credentials: [ldpVc] }).can_be_satisfied).toBe(true)
    expect(queryPresentationDefinition(definition(ldpVp), { credentials: [sdJwtVc] }).can_be_satisfied).toBe(false)
  })
})

describe('README: reading the result', () => {
  it('reports every applicable reason a credential did not match', () => {
    const result = queryPresentationDefinition(
      {
        id: 'd',
        format: { mso_mdoc: { alg: ['ES256'] } },
        input_descriptors: [
          { id: 'x', constraints: { fields: [{ path: ['$.age'], filter: { type: 'number', minimum: 18 } }] } },
        ],
      },
      { credentials: [{ credential_format: 'jwt_vc', claims: { age: 16 } }] }
    )

    const reasons = result.input_descriptors[0]?.non_matching_credentials[0]?.reasons ?? []
    const byType = Object.fromEntries(reasons.map((reason) => [reason.type, reason.message]))

    expect(byType.format).toBe("Credential format 'jwt_vc' is not allowed; expected one of 'mso_mdoc'")
    expect(byType.field).toContain('Expected 16 to be at least 18')
  })

  it('mirrors the submission requirement tree', () => {
    const result = queryPresentationDefinition(
      { ...presentationDefinition, submission_requirements: [{ rule: 'pick', from: 'A', count: 1 }] },
      {
        credentials: [
          {
            credential_format: 'dc+sd-jwt',
            claims: { vct: 'https://example.com/IdentityCredential', given_name: 'Erika' },
          },
        ],
      }
    )

    const requirement = result.submission_requirements?.[0]
    expect(requirement?.rule).toBe('pick')
    expect(requirement?.needs_count).toBe(1)
    expect(requirement?.satisfied).toBe(true)
    expect(requirement?.from).toBe('A')
    expect(requirement?.input_descriptors).toEqual([{ input_descriptor_id: 'identity', satisfied: true }])
  })
})

describe('README: limit disclosure', () => {
  it('returns output, paths and mdoc namespaces', () => {
    const result = queryPresentationDefinition(presentationDefinition, {
      credentials: [
        {
          credential_format: 'dc+sd-jwt',
          claims: {
            vct: 'https://example.com/IdentityCredential',
            given_name: 'Erika',
            family_name: 'Mustermann',
          },
        },
      ],
    })

    const disclosure = result.input_descriptors[0]?.matching_credentials[0]?.disclosure
    expect(disclosure?.output).toEqual({ vct: 'https://example.com/IdentityCredential', given_name: 'Erika' })
    expect(disclosure?.paths).toEqual([['vct'], ['given_name']])
    // Not requested, so not disclosed.
    expect(JSON.stringify(disclosure)).not.toContain('Mustermann')
  })

  it('preserves array indices in output', () => {
    const result = queryPresentationDefinition(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              limit_disclosure: 'required',
              fields: [{ path: ['$.accounts[*].id'], filter: { const: 'target' } }],
            },
          },
        ],
      },
      {
        credentials: [{ credential_format: 'dc+sd-jwt', claims: { accounts: [{ id: 'a' }, { id: 'target' }] } }],
      }
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure?.output).toEqual({
      accounts: [null, { id: 'target' }],
    })
  })

  it('discloses whole mdoc data elements', () => {
    const privileges = [{ vehicle_category_code: 'B', expiry_date: '2030-01-01' }]
    const result = queryPresentationDefinition(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'org.iso.18013.5.1.mDL',
            constraints: {
              limit_disclosure: 'required',
              fields: [
                {
                  path: ["$['org.iso.18013.5.1']['driving_privileges'][0]['vehicle_category_code']"],
                  intent_to_retain: false,
                },
              ],
            },
          },
        ],
      },
      {
        credentials: [
          {
            credential_format: 'mso_mdoc',
            doctype: 'org.iso.18013.5.1.mDL',
            namespaces: { 'org.iso.18013.5.1': { driving_privileges: privileges, family_name: 'Mustermann' } },
          },
        ],
      }
    )

    const disclosure = result.input_descriptors[0]?.matching_credentials[0]?.disclosure
    expect(disclosure?.namespaces).toEqual({ 'org.iso.18013.5.1': { driving_privileges: false } })
    expect(disclosure?.output).toEqual({ 'org.iso.18013.5.1': { driving_privileges: privileges } })
  })
})

describe('README: presentations', () => {
  const parsed = parsePresentationDefinition({
    id: 'readme',
    input_descriptors: [
      { id: 'identity', constraints: { fields: [{ path: ['$.given_name'] }] } },
      { id: 'address', constraints: { fields: [{ path: ['$.locality'] }] } },
    ],
  })

  it('builds a submission', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'submission-1',
      location: 'external',
      entries: [
        { input_descriptor_id: 'identity', format: 'dc+sd-jwt', presentation_index: 0 },
        { input_descriptor_id: 'address', format: 'ldp_vc', presentation_index: 1, credential_index: 0 },
      ],
    })

    expect(submission.descriptor_map).toEqual([
      { id: 'identity', format: 'dc+sd-jwt', path: '$[0]' },
      {
        id: 'address',
        format: 'ldp_vp',
        path: '$[1]',
        path_nested: { id: 'address', format: 'ldp_vc', path: '$.verifiableCredential[0]' },
      },
    ])
  })

  it('verifies a submission', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'submission-1',
      entries: [
        { input_descriptor_id: 'identity', format: 'dc+sd-jwt', presentation_index: 0 },
        { input_descriptor_id: 'address', format: 'dc+sd-jwt', presentation_index: 1 },
      ],
    })

    const result = runPresentationSubmission(parsed, submission, {
      presentations: [
        { credentials: [{ credential_format: 'dc+sd-jwt', claims: { given_name: 'Erika' } }] },
        { credentials: [{ credential_format: 'dc+sd-jwt', claims: { locality: 'Köln' } }] },
      ],
    })

    expect(result.valid).toBe(true)
    expect(result.descriptors).toHaveLength(2)
    expect(result.issues).toEqual([])
  })

  it('resolves the presented credential of a descriptor', () => {
    const submission = createPresentationSubmission(parsed.definition, {
      id: 'submission-1',
      entries: [{ input_descriptor_id: 'address', format: 'ldp_vc', presentation_index: 1, credential_index: 1 }],
    })
    const address: PexCredential = { credential_format: 'ldp_vc', claims: { locality: 'Köln' } }
    const presentations = [
      { credentials: [{ credential_format: 'dc+sd-jwt' as const, claims: { given_name: 'Erika' } }] },
      { credentials: [{ credential_format: 'ldp_vc' as const, claims: {} }, address] },
    ]

    const resolved = resolveDescriptorCredential(submission.descriptor_map[0] as Descriptor, presentations)
    expect(resolved).toEqual({
      success: true,
      location: { presentation_index: 1, credential_index: 1 },
      credential: address,
    })
  })

  it('needs exactly count of a pick requirement, and never satisfies an undeclared group', () => {
    const grouped = parsePresentationDefinition({
      id: 'g',
      input_descriptors: [
        { id: 'a', group: ['A'], constraints: { fields: [{ path: ['$.given_name'] }] } },
        { id: 'b', group: ['A'], constraints: { fields: [{ path: ['$.given_name'] }] } },
      ],
      submission_requirements: [{ rule: 'pick', from: 'A', count: 1 }],
    })
    const credentials: PexCredential[] = [{ credential_format: 'dc+sd-jwt', claims: { given_name: 'Erika' } }]
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
        { presentations: ids.map(() => ({ credentials })) }
      )

    expect(submit(['a']).valid).toBe(true)
    expect(submit(['a', 'b']).valid).toBe(false)
    // For a query, both being available is fine: the holder picks one
    expect(runPexQuery(grouped, { credentials }).can_be_satisfied).toBe(true)

    const undeclared = parsePresentationDefinition({
      ...grouped.definition,
      submission_requirements: [{ rule: 'all', from: 'typo' }],
    })
    expect(runPexQuery(undeclared, { credentials }).can_be_satisfied).toBe(false)
    expect(
      runPresentationSubmission(undeclared, { id: 's', definition_id: 'g', descriptor_map: [] }, { presentations: [] })
        .valid
    ).toBe(false)
  })
})

describe('README: not evaluated', () => {
  const withIsHolder = (directive: string) => ({
    id: 'd',
    input_descriptors: [{ id: 'x', constraints: { is_holder: [{ field_id: ['a'], directive }] } }],
  })

  it('fails when required', () => {
    const result = queryPresentationDefinition(withIsHolder('required'), {
      credentials: [{ credential_format: 'dc+sd-jwt', claims: {} }],
    })

    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons[0]).toMatchObject({
      type: 'unsupported_constraint',
      constraint: 'is_holder',
    })
  })

  it('passes when only preferred', () => {
    const result = queryPresentationDefinition(withIsHolder('preferred'), {
      credentials: [{ credential_format: 'dc+sd-jwt', claims: {} }],
    })

    expect(result.can_be_satisfied).toBe(true)
  })

  it('fails a status marked disallowed, and passes it when the caller evaluates it', () => {
    const definition = {
      id: 'd',
      input_descriptors: [{ id: 'x', constraints: { statuses: { revoked: { directive: 'disallowed' } } } }],
    }
    const credential: PexCredential = { credential_format: 'ldp_vc', claims: {} }

    expect(queryPresentationDefinition(definition, { credentials: [credential] }).can_be_satisfied).toBe(false)
    expect(
      queryPresentationDefinition(definition, {
        credentials: [{ ...credential, evaluated_constraints: ['statuses'] }],
      }).can_be_satisfied
    ).toBe(true)
  })
})

describe('README: supported JSONPath', () => {
  it.each(['$.name', "$['name']", '$["name"]', "$['@context']", '$[0]', '$[*]', '$.*', '$.18'])(
    'supports %s',
    (path) => {
      expect(isSupportedJsonPath(path)).toBe(true)
    }
  )

  it.each(['$.a[?(@.b)]', '$.a[(@.length-1)]', '$.a[1:3]', '$.a[0,1]', '$.a[-1]', '$..', '$..name', '$.@context'])(
    'rejects %s',
    (path) => {
      expect(isSupportedJsonPath(path)).toBe(false)
    }
  )

  it('exposes the helpers', () => {
    expect(parseJsonPath('$.a[0].*')).toEqual(['a', 0, null])
    expect(stringifyJsonPath(['a', 0])).toBe("$['a'][0]")
  })
})

describe('README: filters', () => {
  const supported = [
    'type',
    'const',
    'enum',
    'format',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'formatMinimum',
    'formatMaximum',
    'formatExclusiveMinimum',
    'formatExclusiveMaximum',
    'not',
    'contains',
    'items',
  ]

  const sampleValues: Record<string, unknown> = {
    type: 'string',
    const: 'a',
    enum: ['a'],
    format: 'date',
    minLength: 1,
    maxLength: 2,
    minimum: 1,
    maximum: 2,
    exclusiveMinimum: 1,
    exclusiveMaximum: 2,
    formatMinimum: '2020-01-01',
    formatMaximum: '2020-01-01',
    formatExclusiveMinimum: '2020-01-01',
    formatExclusiveMaximum: '2020-01-01',
    not: { const: 'b' },
    contains: { const: 'a' },
    items: { type: 'string' },
  }

  it.each(supported)('supports the %s keyword', (keyword) => {
    // The comparison keywords need an ordered format to compare through, the array keywords an array
    const context = keyword.startsWith('format')
      ? { format: 'date' }
      : keyword === 'contains' || keyword === 'items'
        ? { type: 'array' }
        : {}
    expect(zFilter.safeParse({ ...context, [keyword]: sampleValues[keyword] }).success).toBe(true)
  })

  it.each([
    'pattern',
    'properties',
    'required',
    'additionalProperties',
    'minItems',
    'maxItems',
    'uniqueItems',
    'allOf',
    'anyOf',
    'oneOf',
    'multipleOf',
  ])('rejects the %s keyword rather than ignoring it', (keyword) => {
    const result = zFilter.safeParse({ [keyword]: keyword === 'pattern' ? '^a$' : {} })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message).join('\n')).toContain(`"${keyword}"`)
  })

  it('takes one level of sub-filter, and an array keyword only on an array', () => {
    expect(zFilter.safeParse({ type: 'array', contains: { contains: { const: 'a' } } }).success).toBe(false)
    expect(zFilter.safeParse({ contains: { const: 'a' } }).success).toBe(false)
  })

  it('matches a credential type array either way', () => {
    const credential: PexCredential = {
      credential_format: 'jwt_vc_json',
      claims: { vc: { type: ['VerifiableCredential', 'OpenBadgeCredential'] } },
    }
    const withFields = (fields: unknown[]) => ({ id: 'd', input_descriptors: [{ id: 'x', constraints: { fields } }] })

    const contains = [{ path: ['$.vc.type'], filter: { type: 'array', contains: { const: 'OpenBadgeCredential' } } }]
    const wildcard = [{ path: ['$.vc.type[*]'], filter: { const: 'OpenBadgeCredential' } }]
    expect(queryPresentationDefinition(withFields(contains), { credentials: [credential] }).can_be_satisfied).toBe(true)
    expect(queryPresentationDefinition(withFields(wildcard), { credentials: [credential] }).can_be_satisfied).toBe(true)
  })

  it.each([
    { type: 'number', minimum: '18' },
    { type: 'string', format: 'date', minimum: '1999-5-16' },
    { type: 'string', formatMinimum: '1999-05-16' },
  ])('rejects the bound in %o, which could not apply', (filter) => {
    expect(zFilter.safeParse(filter).success).toBe(false)
  })

  it('requires an offset on a date-time', () => {
    expect(
      zFilter.safeParse({ type: 'string', format: 'date-time', formatMinimum: '2020-01-01T00:00:00' }).success
    ).toBe(false)
  })

  it.each(['title', 'description', '$comment', '$schema', '$id'])('accepts the %s annotation', (keyword) => {
    expect(zFilter.safeParse({ [keyword]: 'x' }).success).toBe(true)
  })

  it('fails a format bound on a value that is not a string', () => {
    const result = queryPresentationDefinition(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              fields: [{ path: ['$.birthdate'], filter: { format: 'date', formatMaximum: '2008-01-01' } }],
            },
          },
        ],
      },
      { credentials: [{ credential_format: 'dc+sd-jwt', claims: { birthdate: 0 } }] }
    )
    expect(result.can_be_satisfied).toBe(false)
  })
})

describe('README: note on @animo-id/pex', () => {
  it('honours schema[].required in v1', () => {
    const result = queryPresentationDefinition(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            schema: [
              { uri: 'https://www.w3.org/2018/credentials/v1' },
              { uri: 'https://example.com/missing', required: true },
            ],
          },
        ],
      },
      {
        credentials: [
          { credential_format: 'ldp_vc', claims: { '@context': ['https://www.w3.org/2018/credentials/v1'] } },
        ],
      }
    )

    expect(result.can_be_satisfied).toBe(false)
  })

  it('reports the wildcard nodes that matched, not the first', () => {
    const result = queryPresentationDefinition(
      {
        id: 'd',
        input_descriptors: [
          { id: 'x', constraints: { fields: [{ path: ['$.accounts[*].id'], filter: { const: 'target' } }] } },
        ],
      },
      {
        credentials: [{ credential_format: 'dc+sd-jwt', claims: { accounts: [{ id: 'other' }, { id: 'target' }] } }],
      }
    )

    const field = result.input_descriptors[0]?.matching_credentials[0]?.fields[0]
    expect(field?.nodes).toEqual([{ path: ['accounts', 1, 'id'], value: 'target' }])
  })

  it('applies a string minimum bound that ajv would drop', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        {
          id: 'x',
          constraints: {
            fields: [{ path: ['$.birthdate'], filter: { type: 'string', format: 'date', minimum: '1999-05-16' } }],
          },
        },
      ],
    }

    const query = (birthdate: string) =>
      queryPresentationDefinition(definition, {
        credentials: [{ credential_format: 'dc+sd-jwt', claims: { birthdate } }],
      }).can_be_satisfied

    expect(query('2000-01-01')).toBe(true)
    expect(query('1998-01-01')).toBe(false)
  })
})
