import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import type { MismatchReason } from '../pex-query-result/m-pex-query-result.js'
import type { Schema } from '../presentation-definition/m-input-descriptor.js'

function pushStrings(target: string[], value: unknown) {
  if (typeof value === 'string') target.push(value)
  else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') target.push(item)
}

/**
 * The URIs a credential offers for matching against a v1 input descriptor's `schema`.
 *
 * Derived exactly as the previous implementation did: `@context` entries, `credentialSchema`
 * ids, the credential's `type` entries, and an SD-JWT's `vct`. Including `type` is what lets the
 * JWT VC Profile and MS Entra style of v1 definition work; including `vct` is what lets SD-JWT
 * VCs be used with v1 at all.
 *
 * Both the claims root and a nested `vc` object are inspected, because a JWT VC is presented as
 * a JWT payload with the credential under `vc`.
 */
export function getCredentialSchemaUris(credential: PexCredential): string[] {
  if (credential.credential_format === 'mso_mdoc') return [credential.doctype]

  const uris: string[] = []
  const roots = [credential.claims]

  const nested = credential.claims.vc
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) roots.push(nested)

  for (const root of roots) {
    pushStrings(uris, root['@context'])
    pushStrings(uris, root.type)

    const credentialSchema = root.credentialSchema
    if (Array.isArray(credentialSchema)) {
      for (const entry of credentialSchema) {
        if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) pushStrings(uris, entry.id)
      }
    } else if (credentialSchema !== null && typeof credentialSchema === 'object') {
      pushStrings(uris, (credentialSchema as Record<string, unknown>).id)
    }
  }

  if (credential.credential_format === 'vc+sd-jwt' || credential.credential_format === 'dc+sd-jwt') {
    pushStrings(uris, credential.claims.vct)
  }

  return [...new Set(uris)]
}

/**
 * Match a credential against a v1 input descriptor's `schema` array.
 *
 * A schema entry marked `required: true` must match, and at least one entry must match overall.
 * The previous implementation ignored `required` entirely and asked only for any match; honouring
 * it is stricter, and is what the v1 spec says the property means.
 */
export function runSchemaQuery(
  credential: PexCredential,
  schema: Schema[]
): { success: true } | { success: false; reason: MismatchReason } {
  const credentialUris = getCredentialSchemaUris(credential)
  const expectedUris = schema.map((entry) => entry.uri)

  const unmetRequired = schema
    .filter((entry) => entry.required === true)
    .map((entry) => entry.uri)
    .filter((uri) => !credentialUris.includes(uri))

  if (unmetRequired.length > 0) {
    return {
      success: false,
      reason: {
        type: 'schema',
        expected_uris: expectedUris,
        credential_uris: credentialUris,
        message: `Credential does not declare required schema URI${unmetRequired.length === 1 ? '' : 's'} '${unmetRequired.join("', '")}'`,
      },
    }
  }

  if (!expectedUris.some((uri) => credentialUris.includes(uri))) {
    return {
      success: false,
      reason: {
        type: 'schema',
        expected_uris: expectedUris,
        credential_uris: credentialUris,
        message: `Credential declares none of the schema URIs '${expectedUris.join("', '")}'`,
      },
    }
  }

  return { success: true }
}
