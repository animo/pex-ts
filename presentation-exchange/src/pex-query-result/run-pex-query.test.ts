import { describe, expect, it } from 'vitest'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import { parsePresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import type { JsonValue } from '../u-pex.js'
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
    expect(result.input_descriptors[0]?.matching_credentials[0]?.fields.map((f) => f.nodes[0]?.value)).toEqual([
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
    expect(match?.nodes).toEqual([{ path: ['given_name'], value: 'Erika' }])
  })

  it('tries the next path when a path resolves to a value failing the filter', () => {
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

    expect(result.can_be_satisfied).toBe(true)
    const match = result.input_descriptors[0]?.matching_credentials[0]?.fields[0]
    expect(match?.matched_path).toBe('$.family_name')
    expect(match?.nodes).toEqual([{ path: ['family_name'], value: 'Mustermann' }])
  })

  it('reports the first path that failed the filter when no path matches', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              fields: [{ path: ['$.missing', '$.given_name', '$.family_name'], filter: { const: 'Musterfrau' } }],
            },
          },
        ],
      },
      [sdJwtCredential]
    )

    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons).toEqual([
      expect.objectContaining({
        type: 'field',
        cause: 'filter_failed',
        message: expect.stringContaining("'$.given_name'"),
      }),
    ])
  })

  it('fails an optional field whose path resolves to a value failing the filter', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              fields: [{ path: ['$.missing', '$.given_name'], optional: true, filter: { const: 'Max' } }],
            },
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
    expect(result.input_descriptors[0]?.matching_credentials[0]?.fields[0]?.nodes).toEqual([])
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

    const match = result.input_descriptors[0]?.matching_credentials[0]
    expect(match?.fields[0]?.nodes).toEqual([{ path: ['age_equal_or_over', '18'], value: true }])
    expect(match?.disclosure.output).toEqual({ age_equal_or_over: { 18: true } })
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
    const result = query(definition({ jwt_vc_json: { alg: ['ES256'] } }), [sdJwtCredential])
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

  const formatReason = (format: unknown, credential: PexCredential) =>
    query(definition(format), [credential]).input_descriptors[0]?.non_matching_credentials[0]?.reasons.find(
      (reason) => reason.type === 'format'
    )

  it('admits through a presentation designation the credentials such a presentation carries', () => {
    // A definition-level `format` of `{ldp_vp: ...}` states which presentation encodings the verifier
    // accepts. A credential is never `ldp_vp`, but a Linked Data presentation carries Linked Data
    // credentials, so that admits an `ldp_vc` — and not an SD-JWT VC, which is presented as itself.
    const ldpVp = { ldp_vp: { proof_type: ['Ed25519Signature2018'] } }
    const ldpVc: PexCredential = { ...w3cCredential, claims: { ...w3cCredential.claims, vct: 'x' } }
    expect(query(definition(ldpVp), [ldpVc]).can_be_satisfied).toBe(true)
    expect(formatReason(ldpVp, sdJwtCredential)).toMatchObject({ allowed: ['ldp', 'ldp_vc'] })

    // A JWT presentation carries JWT credentials, under either of their designations
    const jwtVc: PexCredential = { credential_format: 'jwt_vc', claims: { vct: 'x' } }
    expect(query(definition({ jwt_vp_json: { alg: ['ES256'] } }), [jwtVc]).can_be_satisfied).toBe(true)
    expect(
      query(definition({ jwt_vp: { alg: ['ES256'] } }), [{ ...jwtVc, credential_format: 'jwt_vc_json' }])
        .can_be_satisfied
    ).toBe(true)
    expect(formatReason({ jwt_vp: { alg: ['ES256'] } }, mdocCredential)).toMatchObject({ type: 'format' })
  })

  it("does not apply a presentation designation's restriction to the credentials it admits", () => {
    // The `alg` of a `jwt_vp` is about the presentation, which this library never sees
    const jwtVc: PexCredential = { credential_format: 'jwt_vc', claims: { vct: 'x' }, algorithms: ['EdDSA'] }
    expect(query(definition({ jwt_vp: { alg: ['ES256'] } }), [jwtVc]).can_be_satisfied).toBe(true)
  })

  it('admits what either designation of a mixed format admits', () => {
    const format = { jwt_vp_json: { alg: ['ES256'] }, 'dc+sd-jwt': { 'sd-jwt_alg_values': ['ES256'] } }
    const jwtVc: PexCredential = { credential_format: 'jwt_vc_json', claims: { vct: 'x' } }
    expect(query(definition(format), [jwtVc]).can_be_satisfied).toBe(true)
    expect(query(definition(format), [sdJwtCredential]).can_be_satisfied).toBe(true)
    expect(formatReason(format, mdocCredential)).toMatchObject({ type: 'format' })
  })

  it.each([
    ['proof type', { ldp_vc: { proof_type: ['BbsBlsSignature2020'] } }, { proof_types: ['Ed25519Signature2020'] }],
    [
      'cryptosuite',
      { di_vc: { proof_type: ['DataIntegrityProof'], cryptosuite: ['bbs-2023'] } },
      { proof_types: ['DataIntegrityProof'], cryptosuites: ['eddsa-rdfc-2022'] },
    ],
  ])('rejects a credential whose %s is not allowed', (label, format, declared) => {
    const designation = Object.keys(format)[0] as 'ldp_vc' | 'di_vc'
    const credential: PexCredential = { ...w3cCredential, credential_format: designation, ...declared }

    expect(formatReason(format, { ...credential, claims: { ...credential.claims, vct: 'x' } })?.message).toContain(
      `Credential ${label}`
    )
  })

  it('rejects an SD-JWT whose key binding algorithm is not allowed', () => {
    const format = { 'dc+sd-jwt': { 'kb-jwt_alg_values': ['ES256'] } }
    expect(formatReason(format, { ...sdJwtCredential, key_binding_algorithms: ['EdDSA'] })?.message).toContain(
      "Credential key binding algorithm 'EdDSA' is not among those allowed"
    )
    expect(
      query(definition(format), [{ ...sdJwtCredential, key_binding_algorithms: ['ES256'] }]).can_be_satisfied
    ).toBe(true)
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

  it('matches on a credentialSchema id, as an object or in an array', () => {
    const schema = definition([{ uri: 'https://example.com/schema/1' }])
    const withSchema = (credentialSchema: JsonValue): PexCredential => ({
      credential_format: 'ldp_vc',
      claims: { type: ['VerifiableCredential'], credentialSchema },
    })

    expect(query(schema, [withSchema({ id: 'https://example.com/schema/1' })]).can_be_satisfied).toBe(true)
    expect(query(schema, [withSchema([{ id: 'https://example.com/schema/1' }])]).can_be_satisfied).toBe(true)
    expect(query(schema, [withSchema({ id: 'https://example.com/schema/2' })]).can_be_satisfied).toBe(false)
    expect(
      query(schema, [withSchema([{ id: 'https://example.com/schema/2' }, 'https://example.com/schema/1'])])
        .can_be_satisfied
    ).toBe(false)
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

  it('only matches an input descriptor whose format names mso_mdoc, per ISO 18013-7', () => {
    const { format: _format, ...inputDescriptor } = definition
      .input_descriptors[0] as (typeof definition.input_descriptors)[0]
    const result = query({ ...definition, input_descriptors: [inputDescriptor] }, [mdocCredential])

    expect(result.can_be_satisfied).toBe(false)
    expect(result.input_descriptors[0]?.non_matching_credentials[0]?.reasons).toEqual([
      expect.objectContaining({ type: 'format', message: expect.stringContaining("names 'mso_mdoc'") }),
    ])

    // A definition-level format applies too
    expect(
      query({ ...definition, format: { mso_mdoc: { alg: ['ES256'] } }, input_descriptors: [inputDescriptor] }, [
        mdocCredential,
      ]).can_be_satisfied
    ).toBe(true)
  })

  it.each([
    ['a path into the value of a data element', "$['org.iso.18013.5.1']['driving_privileges'][0]"],
    ['a path that names a namespace', "$['org.iso.18013.5.1']"],
  ])('rejects %s, per ISO 18013-7', (_label, path) => {
    const fields = [{ path: [path], intent_to_retain: false }]
    const invalid = {
      ...definition,
      input_descriptors: [
        { ...definition.input_descriptors[0], constraints: { limit_disclosure: 'required', fields } },
      ],
    }

    expect(() => query(invalid, [mdocCredential])).toThrow(
      `$.input_descriptors[0].constraints.fields[0].path[0]: An mdoc path names one data element, $['<namespace>']['<data element identifier>'] (ISO 18013-7), not '${path}'`
    )
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
  it('prunes claims to the matched paths and lists the paths', () => {
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
    expect(disclosure?.paths).toEqual([['given_name'], ['address', 'locality']])
    // family_name and street_address were not requested.
    expect(JSON.stringify(disclosure)).not.toContain('Mustermann')
    expect(JSON.stringify(disclosure)).not.toContain('Heidestraße')
  })

  it('keeps a disclosed null as it is when a predicate field also matches it', () => {
    const credential: PexCredential = { credential_format: 'dc+sd-jwt', claims: { values: ['x', null] } }
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              fields: [
                { path: ['$.values'] },
                { path: ['$.values[1]'], predicate: 'required', filter: { type: 'null' } },
              ],
            },
          },
        ],
      },
      [credential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure.output).toEqual({ values: ['x', null] })
  })

  it('gives a predicate claim with another predicate claim below it as true, whatever the field order', () => {
    const credential: PexCredential = { credential_format: 'dc+sd-jwt', claims: { address: { country: 'NL' } } }
    const outer = { path: ['$.address'], predicate: 'required', filter: { type: 'object' } }
    const inner = { path: ['$.address.country'], predicate: 'required', filter: { const: 'NL' } }
    const outputFor = (fields: unknown[]) =>
      query({ id: 'd', input_descriptors: [{ id: 'x', constraints: { fields } }] }, [credential]).input_descriptors[0]
        ?.matching_credentials[0]?.disclosure.output

    expect(outputFor([outer, inner])).toEqual({ address: true })
    expect(outputFor([inner, outer])).toEqual({ address: true })
  })

  it('lists a disclosed object once, leaving out paths below it', () => {
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'x',
            constraints: {
              limit_disclosure: 'required',
              fields: [{ path: ['$.address.locality'] }, { path: ['$.address'] }],
            },
          },
        ],
      },
      [sdJwtCredential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure?.paths).toEqual([['address']])
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

  it('is returned when the descriptor does not ask to limit disclosure', () => {
    const result = query(
      { id: 'd', input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.given_name'] }] } }] },
      [sdJwtCredential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure.output).toEqual({ given_name: 'Erika' })
  })

  it('reports the nodes that matched a wildcard, not merely the first', () => {
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
    expect(field?.nodes).toEqual([{ path: ['accounts', 1, 'id'], value: 'right' }])
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
  it('treats an empty submission_requirements array as declaring none', () => {
    const withFields = (fields: unknown[]) => ({
      id: 'd',
      submission_requirements: [],
      input_descriptors: [{ id: 'x', constraints: { fields } }],
    })

    const result = query(withFields([{ path: ['$.vct'] }]), [sdJwtCredential])
    expect(result.submission_requirements).toBeUndefined()
    expect(result.can_be_satisfied).toBe(true)
    // Every input descriptor counts, as when none are declared
    expect(query(withFields([{ path: ['$.missing'] }]), [sdJwtCredential]).can_be_satisfied).toBe(false)
  })

  it('accepts an empty group, is_holder and same_subject, as the spec schema does', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        { id: 'x', group: [], constraints: { is_holder: [], same_subject: [], fields: [{ path: ['$.vct'] }] } },
      ],
    }
    expect(query(definition, [sdJwtCredential]).can_be_satisfied).toBe(true)
  })

  it('does not satisfy a requirement over a group nothing declares', () => {
    const parsed = parsePresentationDefinition({
      id: 'd',
      submission_requirements: [{ rule: 'all', from: 'typo' }],
      input_descriptors: [{ id: 'x', group: ['A'], constraints: { fields: [{ path: ['$.vct'] }] } }],
    })

    const result = runPexQuery(parsed, { credentials: [sdJwtCredential] })
    expect(result.can_be_satisfied).toBe(false)
    expect(result.submission_requirements?.[0]).toMatchObject({ satisfied: false, needs_count: 0 })
  })

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

describe('disclosure safety', () => {
  const limited = (fields: unknown[]) => ({
    id: 'd',
    input_descriptors: [{ id: 'x', constraints: { limit_disclosure: 'required', fields } }],
  })

  it('does not write through a __proto__ key in the credential', () => {
    // JSON.parse makes `__proto__` an own property, which a path can then reach
    const claims = JSON.parse('{"vct": "x", "__proto__": {"polluted": "yes"}}')
    const result = query(limited([{ path: ["$['__proto__'].polluted"] }]), [{ credential_format: 'dc+sd-jwt', claims }])

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const output = result.input_descriptors[0]?.matching_credentials[0]?.disclosure.output
    expect(Object.getOwnPropertyDescriptor(output, '__proto__')?.value).toEqual({ polluted: 'yes' })
  })

  it('does not change the credential or share objects with it', () => {
    const claims = { vct: 'x', address: { street: 'Heidestraße 17', locality: 'Köln' } }
    const credential: PexCredential = { credential_format: 'dc+sd-jwt', claims: structuredClone(claims) }

    const result = query(
      limited([
        { path: ['$.address'] },
        { path: ['$.address.street'], filter: { type: 'string' }, predicate: 'required' },
      ]),
      [credential]
    )

    expect(credential.claims).toEqual(claims)
    const output = result.input_descriptors[0]?.matching_credentials[0]?.disclosure.output
    expect(output).toEqual({ address: claims.address })
    expect(output?.address).not.toBe(credential.claims.address)
  })

  it('discloses the same whatever the order of the fields', () => {
    const fields = [
      { path: ['$.address'], filter: { type: 'object' }, predicate: 'required' },
      { path: ['$.address.locality'] },
    ]
    const disclosure = (ordered: unknown[]) =>
      query(limited(ordered), [sdJwtCredential]).input_descriptors[0]?.matching_credentials[0]?.disclosure

    expect(disclosure(fields)).toEqual(disclosure([...fields].reverse()))
    expect(disclosure(fields)?.output).toEqual({ address: { locality: 'Köln' } })
    // The predicate's claim is disclosed in full, so a verifier can check it
    expect(disclosure(fields)?.paths).toEqual([['address']])
  })

  it('discloses every element a wildcard path matches', () => {
    const credential: PexCredential = { credential_format: 'dc+sd-jwt', claims: { nationalities: ['DE', 'NL'] } }
    const result = query(limited([{ path: ['$.nationalities[*]'] }]), [credential])

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure.paths).toEqual([
      ['nationalities', 0],
      ['nationalities', 1],
    ])
  })

  it('lists the paths in the order of the claims', () => {
    const credential: PexCredential = {
      credential_format: 'dc+sd-jwt',
      claims: { nationalities: ['DE', 'NL', 'FR'], given_name: 'Erika' },
    }
    const result = query(
      limited([{ path: ['$.given_name'] }, { path: ['$.nationalities[2]'] }, { path: ['$.nationalities[0]'] }]),
      [credential]
    )

    expect(result.input_descriptors[0]?.matching_credentials[0]?.disclosure.paths).toEqual([
      ['nationalities', 0],
      ['nationalities', 2],
      ['given_name'],
    ])
  })

  it('discloses a credential nested deeper than the call stack allows', () => {
    // A JSON document of a few hundred kilobytes nests this deep, and JSON.parse reads it without recursing
    let deep: unknown = 'leaf'
    for (let depth = 0; depth < 100_000; depth++) deep = depth % 2 === 0 ? [deep] : { down: deep }
    const credential: PexCredential = { credential_format: 'dc+sd-jwt', claims: { deep } as never }

    const result = query(limited([{ path: ['$.deep'] }]), [credential])

    const disclosure = result.input_descriptors[0]?.matching_credentials[0]?.disclosure
    // Shallow checks only: a matcher that walks the value would overflow the stack itself
    const output = disclosure?.output.deep as Record<string, unknown>
    expect(Object.keys(output)).toEqual(['down'])
    expect(output === deep).toBe(false)
    expect(disclosure?.paths).toEqual([['deep']])
  })

  it("copies an mdoc's byte strings and dates rather than sharing them", () => {
    const portrait = new Uint8Array([1, 2, 3])
    const birthDate = new Date('1963-08-12T00:00:00Z')
    const credential: PexCredential = {
      credential_format: 'mso_mdoc',
      doctype: 'org.iso.18013.5.1.mDL',
      namespaces: { 'org.iso.18013.5.1': { portrait, birth_date: birthDate } },
    }
    const result = query(
      {
        id: 'd',
        input_descriptors: [
          {
            id: 'org.iso.18013.5.1.mDL',
            format: { mso_mdoc: { alg: ['ES256'] } },
            constraints: {
              limit_disclosure: 'required',
              fields: [
                { path: ["$['org.iso.18013.5.1']['portrait']"] },
                { path: ["$['org.iso.18013.5.1']['birth_date']"] },
              ],
            },
          },
        ],
      },
      [credential]
    )

    const output = result.input_descriptors[0]?.matching_credentials[0]?.disclosure.output[
      'org.iso.18013.5.1'
    ] as Record<string, unknown>
    expect(output.portrait).toEqual(portrait)
    expect(output.portrait).not.toBe(portrait)
    expect(output.birth_date).toEqual(birthDate)
    expect(output.birth_date).not.toBe(birthDate)
  })
})

describe('constraints the credential must be able to honour', () => {
  const jwtVc: PexCredential = { credential_format: 'jwt_vc', claims: { vc: { type: ['VerifiableCredential'] } } }

  it('fails limit_disclosure: required for a credential that cannot disclose selectively', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        { id: 'x', constraints: { limit_disclosure: 'required', fields: [{ path: ['$.vc.type'] }] } },
      ],
    }

    expect(query(definition, [jwtVc]).input_descriptors[0]?.non_matching_credentials[0]?.reasons).toEqual([
      expect.objectContaining({ type: 'limit_disclosure' }),
    ])
    expect(query(definition, [{ ...jwtVc, credential_format: 'ldp_vc' }]).can_be_satisfied).toBe(false)
    expect(
      query(definition, [{ ...jwtVc, credential_format: 'ldp_vc', selectively_disclosable: true }]).can_be_satisfied
    ).toBe(true)
    expect(query(definition, [{ credential_format: 'dc+sd-jwt', claims: jwtVc.claims }]).can_be_satisfied).toBe(true)
  })

  it('fails a status marked disallowed, which asserts as much as required does', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        { id: 'x', constraints: { statuses: { revoked: { directive: 'disallowed' } }, fields: [{ path: ['$.vct'] }] } },
      ],
    }

    expect(query(definition, [sdJwtCredential]).input_descriptors[0]?.non_matching_credentials[0]?.reasons).toEqual([
      expect.objectContaining({ type: 'unsupported_constraint', constraint: 'statuses' }),
    ])
  })

  it('passes a constraint the caller declares it evaluates', () => {
    const definition = {
      id: 'd',
      input_descriptors: [
        { id: 'x', constraints: { statuses: { active: { directive: 'required' } }, fields: [{ path: ['$.vct'] }] } },
      ],
    }

    expect(query(definition, [sdJwtCredential]).can_be_satisfied).toBe(false)
    expect(query(definition, [{ ...sdJwtCredential, evaluated_constraints: ['statuses'] }]).can_be_satisfied).toBe(true)
  })
})
