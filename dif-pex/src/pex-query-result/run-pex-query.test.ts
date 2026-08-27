import { describe, expect, it } from 'vitest'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import { parsePresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { queryPresentationDefinition, runPexQuery } from './run-pex-query.js'

const sdJwtCredential: PexCredential = {
  credential_format: 'dc+sd-jwt',
  claims: {
    vct: 'https://example.com/IdentityCredential',
    given_name: 'Erika',
    family_name: 'Mustermann',
    birthdate: '1963-08-12',
    address: { locality: 'Köln', street_address: 'Heidestraße 17' },
    age_equal_or_over: { '18': true, '21': true },
  },
}

const mdocCredential: PexCredential = {
  credential_format: 'mso_mdoc',
  doctype: 'org.iso.18013.5.1.mDL',
  namespaces: {
    'org.iso.18013.5.1': { family_name: 'Mustermann', birth_date: '1963-08-12', document_number: 'X1234' },
  },
}

const w3cCredential: PexCredential = {
  credential_format: 'ldp_vc',
  issuer: 'did:example:issuer',
  claims: {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'PermanentResidentCard'],
    issuer: 'did:example:issuer',
    credentialSubject: { givenName: 'Erika', birthCountry: 'Bahamas' },
  },
}

function query(definition: unknown, credentials: PexCredential[]) {
  return queryPresentationDefinition(definition, { credentials })
}

describe('input descriptor evaluation', () => {
  it('matches a credential satisfying every field', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'identity',
            constraints: {
              fields: [
                { path: ['$.vct'], filter: { type: 'string', const: 'https://example.com/IdentityCredential' } },
                { path: ['$.given_name'] },
              ],
            },
          },
        ],
      },
      [sdJwtCredential]
    )

    expect(result.can_be_satisfied).toBe(true)
    expect(result.input_descriptors[0]?.satisfied).toBe(true)
    expect(result.input_descriptors[0]?.matching_credentials).toHaveLength(1)
    expect(result.input_descriptors[0]?.matching_credentials[0]?.fields.map((f) => f.value)).toEqual([
      'https://example.com/IdentityCredential',
      'Erika',
    ])
  })

  it('reports why a credential does not match', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              fields: [{ path: ['$.nationality'] }, { path: ['$.given_name'], filter: { const: 'Bob' } }],
            },
          },
        ],
      },
      [sdJwtCredential]
    )

    expect(result.can_be_satisfied).toBe(false)
    const reasons = result.input_descriptors[0]?.non_matching_credentials[0]?.reasons ?? []
    expect(reasons).toHaveLength(2)
    expect(reasons[0]).toMatchObject({ type: 'field', field_index: 0, cause: 'path_not_found' })
    expect(reasons[1]).toMatchObject({ type: 'field', field_index: 1, cause: 'filter_failed' })
  })

  it('tries paths in order and stops at the first that resolves', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          { id: 'x', constraints: { fields: [{ path: ['$.missing', '$.given_name', '$.family_name'] }] } },
        ],
      },
      [sdJwtCredential]
    )

    const match = result.input_descriptors[0]?.matching_credentials[0]?.fields[0]
    expect(match?.matched_path).toBe('$.given_name')
    expect(match?.value).toBe('Erika')
  })

  it('does not fall through to a later path when the winning path fails its filter', () => {
    // `$.given_name` resolves, so `$.family_name` is never consulted even though it would pass.
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: { fields: [{ path: ['$.given_name', '$.family_name'], filter: { const: 'Mustermann' } }] },
          },
        ],
      },
      [sdJwtCredential]
    )

    expect(result.can_be_satisfied).toBe(false)
  })

  it('passes an optional field whose path resolves nothing', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.nationality'], optional: true }] } }],
      },
      [sdJwtCredential]
    )

    expect(result.can_be_satisfied).toBe(true)
    expect(result.input_descriptors[0]?.matching_credentials[0]?.fields[0]?.value).toBeUndefined()
  })

  it('discloses only that a predicate holds, never the value', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              fields: [
                { path: ['$.age_equal_or_over.18'], predicate: 'required', filter: { type: 'boolean', const: true } },
              ],
            },
          },
        ],
      },
      [sdJwtCredential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.fields[0]?.value).toBe(true)
  })

  it('resolves a numeric-keyed path in dot notation', () => {
    const result = query(
      { id: 'd', input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.age_equal_or_over.21'] }] } }] },
      [sdJwtCredential]
    )
    expect(result.can_be_satisfied).toBe(true)
  })
})

describe('format restriction', () => {
  const definition = (format: unknown) => ({
    id: 'd',
    format,
    input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.vct'] }] } }],
  })

  it('accepts a credential whose format is designated', () => {
    expect(query(definition({ 'dc+sd-jwt': {} }), [sdJwtCredential]).can_be_satisfied).toBe(true)
  })

  it('rejects a credential whose format is not designated', () => {
    const result = query(definition({ mso_mdoc: { alg: ['ES256'] } }), [sdJwtCredential])
    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons[0]).toMatchObject({ type: 'format' })
  })

  it('matches designations exactly rather than by family', () => {
    const jwtVc: PexCredential = { credential_format: 'jwt_vc', claims: { vct: 'x' } }
    expect(query(definition({ jwt_vc_json: { alg: ['ES256'] } }), [jwtVc]).can_be_satisfied).toBe(false)
    expect(query(definition({ jwt_vc: { alg: ['ES256'] } }), [jwtVc]).can_be_satisfied).toBe(true)
  })

  it('intersects algorithms when the credential declares them', () => {
    const credential: PexCredential = { ...sdJwtCredential, algorithms: ['EdDSA'] }
    expect(query(definition({ 'dc+sd-jwt': { 'sd-jwt_alg_values': ['ES256'] } }), [credential]).can_be_satisfied).toBe(
      false
    )
    expect(query(definition({ 'dc+sd-jwt': { 'sd-jwt_alg_values': ['EdDSA'] } }), [credential]).can_be_satisfied).toBe(
      true
    )
  })

  it('ignores presentation designations, which say nothing about the credential', () => {
    // A definition-level `format` of `{ldp_vp: ...}` states which presentation encodings the
    // verifier accepts. A credential is never `ldp_vp`, so checking one against it is a category
    // error — it rejected every credential until the parity harness caught it.
    expect(
      query(definition({ ldp_vp: { proof_type: ['Ed25519Signature2018'] } }), [sdJwtCredential]).can_be_satisfied
    ).toBe(true)
    expect(query(definition({ jwt_vp: { alg: ['ES256'] } }), [sdJwtCredential]).can_be_satisfied).toBe(true)
  })

  it('still restricts on the credential designations of a mixed format', () => {
    const format = { ldp_vp: { proof_type: ['Ed25519Signature2018'] }, jwt_vc: { alg: ['ES256'] } }
    expect(query(definition(format), [sdJwtCredential]).can_be_satisfied).toBe(false)
  })

  it('does not reject a credential that declares no algorithms', () => {
    expect(
      query(definition({ 'dc+sd-jwt': { 'sd-jwt_alg_values': ['ES256'] } }), [sdJwtCredential]).can_be_satisfied
    ).toBe(true)
  })
})

describe('v1 schema matching', () => {
  const definition = (schema: unknown) => ({ id: 'd', input_descriptors: [{ id: 'x', schema }] })

  it('matches on @context', () => {
    const result = query(definition([{ uri: 'https://www.w3.org/2018/credentials/v1' }]), [w3cCredential])
    expect(result.version).toBe('v1')
    expect(result.can_be_satisfied).toBe(true)
  })

  it('matches on a credential type, which is what the JWT VC profile relies on', () => {
    expect(query(definition([{ uri: 'PermanentResidentCard' }]), [w3cCredential]).can_be_satisfied).toBe(true)
  })

  it('matches an SD-JWT on its vct, so SD-JWTs work with v1', () => {
    expect(
      query(definition([{ uri: 'https://example.com/IdentityCredential' }]), [sdJwtCredential]).can_be_satisfied
    ).toBe(true)
  })

  it('fails when the credential declares none of the URIs', () => {
    const result = query(definition([{ uri: 'https://example.com/other' }]), [w3cCredential])
    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons[0]).toMatchObject({ type: 'schema' })
  })

  it('honours a required schema entry, which the previous implementation ignored', () => {
    const result = query(
      definition([
        { uri: 'https://www.w3.org/2018/credentials/v1' },
        { uri: 'https://example.com/missing', required: true },
      ]),
      [w3cCredential]
    )

    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons[0]?.message).toContain(
      'required schema URI'
    )
  })
})

describe('unsupported constraints', () => {
  const withConstraints = (constraints: unknown) => ({ id: 'd', input_descriptors: [{ id: 'x', constraints }] })

  it.each(['is_holder', 'same_subject'] as const)('fails when %s is required', (constraint) => {
    const result = query(withConstraints({ [constraint]: [{ field_id: ['a'], directive: 'required' }] }), [
      sdJwtCredential,
    ])

    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons[0]).toMatchObject({
      type: 'unsupported_constraint',
      constraint,
    })
  })

  it('fails when a status directive is required', () => {
    const result = query(withConstraints({ statuses: { active: { directive: 'required' } } }), [sdJwtCredential])
    expect(result.can_be_satisfied).toBe(false)
  })

  it('passes when the directive is only preferred', () => {
    const result = query(withConstraints({ is_holder: [{ field_id: ['a'], directive: 'preferred' }] }), [
      sdJwtCredential,
    ])
    expect(result.can_be_satisfied).toBe(true)
  })
})

describe('subject_is_issuer', () => {
  const definition = { id: 'd', input_descriptors: [{ id: 'x', constraints: { subject_is_issuer: 'required' } }] }

  it('passes when issuer and subject are the same', () => {
    const credential: PexCredential = { ...w3cCredential, issuer: 'did:example:a', subject: 'did:example:a' }
    expect(query(definition, [credential]).can_be_satisfied).toBe(true)
  })

  it('fails when they differ', () => {
    const credential: PexCredential = { ...w3cCredential, issuer: 'did:example:a', subject: 'did:example:b' }
    expect(query(definition, [credential]).can_be_satisfied).toBe(false)
  })

  it('fails rather than assuming when the credential does not declare them', () => {
    const result = query(definition, [sdJwtCredential])
    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons[0]).toMatchObject({
      type: 'subject_is_issuer',
    })
  })
})

describe('mdoc', () => {
  const definition = {
    id: 'd',
    input_descriptors: [
      {
        id: 'org.iso.18013.5.1.mDL',
        format: { mso_mdoc: { alg: ['ES256'] } },
        constraints: {
          limit_disclosure: 'required',
          fields: [
            { path: ["$['org.iso.18013.5.1']['family_name']"], intent_to_retain: false },
            { path: ["$['org.iso.18013.5.1']['birth_date']"], intent_to_retain: true },
          ],
        },
      },
    ],
  }

  it('resolves namespaced paths against the namespaces object', () => {
    const result = query(definition, [mdocCredential])
    expect(result.can_be_satisfied).toBe(true)
  })

  it('builds the namespaces map an mdoc device request needs', () => {
    const result = query(definition, [mdocCredential])
    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure?.namespaces).toEqual({
      'org.iso.18013.5.1': { family_name: false, birth_date: true },
    })
  })

  it('does not disclose an element the definition did not ask for', () => {
    const result = query(definition, [mdocCredential])
    const disclosure = result.input_descriptors[0]?.matching_credentials[0]?.disclosure
    expect(disclosure?.output).toEqual({
      'org.iso.18013.5.1': { family_name: 'Mustermann', birth_date: '1963-08-12' },
    })
    expect(JSON.stringify(disclosure)).not.toContain('X1234')
  })

  it('requires the input descriptor id to be the doctype, per ISO 18013-7', () => {
    const result = query({ ...definition, input_descriptors: [{ ...definition.input_descriptors[0], id: 'wrong' }] }, [
      mdocCredential,
    ])

    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons[0]).toMatchObject({ type: 'mdoc_doctype' })
  })
})

describe('limit disclosure', () => {
  it('prunes claims to the matched paths and builds a presentation frame', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              limit_disclosure: 'required',
              fields: [{ path: ['$.given_name'] }, { path: ['$.address.locality'] }],
            },
          },
        ],
      },
      [sdJwtCredential]
    )

    const disclosure = result.input_descriptors[0]?.matching_credentials[0]?.disclosure
    expect(disclosure?.output).toEqual({ given_name: 'Erika', address: { locality: 'Köln' } })
    expect(disclosure?.presentation_frame).toEqual({ given_name: true, address: { locality: true } })
    // family_name and street_address were not requested.
    expect(JSON.stringify(disclosure)).not.toContain('Mustermann')
    expect(JSON.stringify(disclosure)).not.toContain('Heidestraße')
  })

  it('marks every leaf of a disclosed object individually', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          { id: 'x', constraints: { limit_disclosure: 'required', fields: [{ path: ['$.address'] }] } },
        ],
      },
      [sdJwtCredential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure?.presentation_frame).toEqual({
      address: { locality: true, street_address: true },
    })
  })

  it('preserves array indices so paths still resolve into the pruned output', () => {
    const credential: PexCredential = {
      credential_format: 'dc+sd-jwt',
      claims: { accounts: [{ id: 'a' }, { id: 'b' }, { id: 'target' }] },
    }

    const result = query(
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
      [credential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure?.output).toEqual({
      accounts: [null, null, { id: 'target' }],
    })
  })

  it('is absent when the descriptor does not ask to limit disclosure', () => {
    const result = query(
      { id: 'd', input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.given_name'] }] } }] },
      [sdJwtCredential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure).toBeUndefined()
  })

  it('reports the node that matched a wildcard, not merely the first', () => {
    const credential: PexCredential = {
      credential_format: 'dc+sd-jwt',
      claims: { accounts: [{ id: 'wrong' }, { id: 'right' }] },
    }

    const result = query(
      {
        id: 'd',
        input_descriptors: [
          { id: 'x', constraints: { fields: [{ path: ['$.accounts[*].id'], filter: { const: 'right' } }] } },
        ],
      },
      [credential]
    )

    const field = result.input_descriptors[0]?.matching_credentials[0]?.fields[0]
    expect(field?.value).toBe('right')
    expect(field?.resolved_path).toEqual(['accounts', 1, 'id'])
  })
})

describe('submission requirements', () => {
  const definition = {
    id: 'd',
    input_descriptors: [
      { id: 'a', group: ['A'], constraints: { fields: [{ path: ['$.given_name'] }] } },
      { id: 'b', group: ['A'], constraints: { fields: [{ path: ['$.family_name'] }] } },
      { id: 'c', group: ['B'], constraints: { fields: [{ path: ['$.nope'] }] } },
    ],
  }

  it('rule all requires every member of the group', () => {
    const result = query({ ...definition, submission_requirements: [{ rule: 'all', from: 'A' }] }, [sdJwtCredential])

    expect(result.can_be_satisfied).toBe(true)
    const requirement = result.submission_requirements?.[0]
    expect(requirement?.needs_count).toBe(2)
    expect(requirement?.satisfied).toBe(true)
    expect(requirement?.input_descriptors).toEqual([
      { input_descriptor_id: 'a', satisfied: true },
      { input_descriptor_id: 'b', satisfied: true },
    ])
  })

  it('rule all fails when a member is unsatisfied', () => {
    const result = query({ ...definition, submission_requirements: [{ rule: 'all', from: 'B' }] }, [sdJwtCredential])
    expect(result.can_be_satisfied).toBe(false)
  })

  it('rule pick needs count members', () => {
    const result = query({ ...definition, submission_requirements: [{ rule: 'pick', from: 'A', count: 1 }] }, [
      sdJwtCredential,
    ])

    expect(result.submission_requirements?.[0]?.needs_count).toBe(1)
    expect(result.can_be_satisfied).toBe(true)
  })

  it('rule pick defaults to needing one', () => {
    const result = query({ ...definition, submission_requirements: [{ rule: 'pick', from: 'A' }] }, [sdJwtCredential])
    expect(result.submission_requirements?.[0]?.needs_count).toBe(1)
  })

  it('rule pick fails when fewer than min are satisfiable', () => {
    const result = query({ ...definition, submission_requirements: [{ rule: 'pick', from: 'A', min: 3 }] }, [
      sdJwtCredential,
    ])
    expect(result.can_be_satisfied).toBe(false)
  })

  it('mirrors from_nested as a tree', () => {
    const result = query(
      {
        ...definition,
        submission_requirements: [
          {
            rule: 'pick',
            count: 1,
            from_nested: [
              { rule: 'all', from: 'A' },
              { rule: 'all', from: 'B' },
            ],
          },
        ],
      },
      [sdJwtCredential]
    )

    const requirement = result.submission_requirements?.[0]
    expect(requirement?.needs_count).toBe(1)
    expect(requirement?.satisfied).toBe(true)
    expect(requirement?.from_nested?.map((child) => child.satisfied)).toEqual([true, false])
    expect(result.can_be_satisfied).toBe(true)
  })

  it('ignores descriptors outside the group', () => {
    const result = query({ ...definition, submission_requirements: [{ rule: 'all', from: 'A' }] }, [sdJwtCredential])
    // 'c' is unsatisfied but belongs to group B, so it does not affect this requirement.
    expect(result.input_descriptors[2]?.satisfied).toBe(false)
    expect(result.can_be_satisfied).toBe(true)
  })

  it('requires every input descriptor when there are no submission requirements', () => {
    const result = query(definition, [sdJwtCredential])
    expect(result.submission_requirements).toBeUndefined()
    expect(result.can_be_satisfied).toBe(false)
  })
})

describe('runPexQuery', () => {
  it('accepts an already parsed definition', () => {
    const parsed = parsePresentationDefinition({
      id: 'd',
      input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.vct'] }] } }],
    })

    expect(runPexQuery(parsed, { credentials: [sdJwtCredential] }).can_be_satisfied).toBe(true)
  })

  it('is vacuously satisfiable when the definition asks for nothing', () => {
    expect(query({ id: 'd', input_descriptors: [] }, []).can_be_satisfied).toBe(true)
  })

  it('reports every candidate credential, matching or not', () => {
    const result = query(
      { id: 'd', input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.vct'] }] } }] },
      [sdJwtCredential, w3cCredential, mdocCredential]
    )

    expect(result.input_descriptors[0]?.matching_credentials.map((c) => c.credential_index)).toEqual([0])
    expect(result.input_descriptors[0]?.non_matching_credentials.map((c) => c.credential_index)).toEqual([1, 2])
  })
})
