/**
 * Executes the code in README.md, so the documentation cannot drift from the API.
 *
 * Each test mirrors one section. Keep them in the same order as the README, and update both
 * together.
 */
import { describe, expect, it } from 'vitest'
import {
  createPresentationSubmission,
  isSupportedJsonPath,
  type PexCredential,
  parseJsonPath,
  parsePresentationDefinition,
  queryPresentationDefinition,
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
  it('returns output, presentation_frame and mdoc namespaces', () => {
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
    expect(disclosure?.presentation_frame).toEqual({ vct: true, given_name: true })
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
})

describe('README: supported JSONPath', () => {
  it.each(['$.name', "$['name']", '$["name"]', '$[0]', '$[*]', '$.*', '$..name', "$..['name']", '$.@context', '$.18'])(
    'supports %s',
    (path) => {
      expect(isSupportedJsonPath(path)).toBe(true)
    }
  )

  it.each(['$.a[?(@.b)]', '$.a[(@.length-1)]', '$.a[1:3]', '$.a[0,1]', '$.a[-1]', '$..'])('rejects %s', (path) => {
    expect(isSupportedJsonPath(path)).toBe(false)
  })

  it('exposes the helpers', () => {
    expect(parseJsonPath('$.a[0]')).toEqual([
      { type: 'key', key: 'a' },
      { type: 'index', index: 0 },
    ])
    expect(stringifyJsonPath(['a', 0])).toBe("$['a'][0]")
  })
})

describe('README: filters', () => {
  const supported = [
    'type',
    'const',
    'enum',
    'pattern',
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
    'minItems',
    'maxItems',
    'uniqueItems',
    'items',
    'contains',
    'required',
    'properties',
    'additionalProperties',
    'not',
    'allOf',
    'anyOf',
    'oneOf',
  ]

  const sampleValues: Record<string, unknown> = {
    type: 'string',
    const: 'a',
    enum: ['a'],
    pattern: '^a$',
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
    minItems: 1,
    maxItems: 2,
    uniqueItems: true,
    items: {},
    contains: {},
    required: ['a'],
    properties: { a: {} },
    additionalProperties: false,
    not: {},
    allOf: [{}],
    anyOf: [{}],
    oneOf: [{}],
  }

  it.each(supported)('supports the %s keyword', (keyword) => {
    expect(zFilter.safeParse({ [keyword]: sampleValues[keyword] }).success).toBe(true)
  })

  it.each(['title', 'description', '$comment', '$schema', '$id'])('accepts the %s annotation', (keyword) => {
    expect(zFilter.safeParse({ [keyword]: 'x' }).success).toBe(true)
  })

  it('rejects an unknown keyword rather than ignoring it', () => {
    expect(zFilter.safeParse({ multipleOf: 2 }).success).toBe(false)
  })
})

describe('README: migrating', () => {
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

  it('reports the wildcard node that matched, not the first', () => {
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
    expect(field?.value).toBe('target')
    expect(field?.resolved_path).toEqual(['accounts', 1, 'id'])
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
