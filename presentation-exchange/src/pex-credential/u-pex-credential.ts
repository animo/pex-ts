import { z } from 'zod'
import { unevaluatedConstraints } from '../presentation-definition/m-constraints.js'
import { type JsonObject, zJsonObject } from '../u-pex.js'

/**
 * Properties every credential may carry, none of which this library can derive for itself.
 *
 * They are optional because most definitions never ask for them: a constraint that needs one and
 * does not get it fails explicitly rather than silently passing.
 */
const credentialBase = {
  /** Needed only by `constraints.subject_is_issuer`. */
  issuer: z.string().optional(),
  /** Needed only by `constraints.subject_is_issuer`. */
  subject: z.string().optional(),
  /** Signature algorithms, checked against a `format` restriction's `alg`. */
  algorithms: z.array(z.string()).nonempty().optional(),
  /** Proof types, checked against a `format` restriction's `proof_type`. */
  proof_types: z.array(z.string()).nonempty().optional(),
  /** Cryptosuites, checked against a `di*` format restriction's `cryptosuite`. */
  cryptosuites: z.array(z.string()).nonempty().optional(),
  /**
   * Key binding JWT algorithms, checked against a `vc+sd-jwt` / `dc+sd-jwt` restriction's
   * `kb-jwt_alg_values`. Only known for a presentation.
   */
  key_binding_algorithms: z.array(z.string()).nonempty().optional(),

  /**
   * Whether the credential can disclose its claims selectively, which `limit_disclosure: required` needs.
   * Defaults to `true` for SD-JWT VCs and mdocs, and to `false` for W3C credentials: a JWT VC never can,
   * and a Linked Data or Data Integrity credential only with a suite like BBS or AnonCreds, which the caller
   * knows and this library does not.
   */
  selectively_disclosable: z.boolean().optional(),

  /**
   * The credential is a presentation in which a field with a `predicate` holds `true` rather than the
   * value, as zero-knowledge formats like AnonCreds present it. Such a field then also accepts `true`.
   * The caller must verify the predicate proof itself.
   */
  predicate_results: z.boolean().optional(),

  /**
   * Constraints the caller checks itself for this credential — for example `statuses`, when it verifies a
   * non-revocation proof. A required constraint in this list is not reported as unsupported.
   */
  evaluated_constraints: z.array(z.enum(unevaluatedConstraints)).optional(),
}

/**
 * An ISO mdoc. Paths resolve against `namespaces`, so the conventional mdoc path form
 * `$['org.iso.18013.5.1']['family_name']` works without special-casing.
 */
export const zPexMdocCredential = z.object({
  ...credentialBase,
  credential_format: z.literal('mso_mdoc'),
  doctype: z.string(),
  namespaces: z.record(z.string(), z.record(z.string(), z.unknown())),
})
export type PexMdocCredential = z.output<typeof zPexMdocCredential>

/**
 * An SD-JWT VC. `claims` must be the fully disclosed ("pretty") payload — this library works out
 * which claims to disclose, and cannot un-hide one the caller withheld.
 */
export const zPexSdJwtVcCredential = z.object({
  ...credentialBase,
  credential_format: z.union([z.literal('vc+sd-jwt'), z.literal('dc+sd-jwt')]),
  claims: zJsonObject,
})
export type PexSdJwtVcCredential = z.output<typeof zPexSdJwtVcCredential>

/**
 * A W3C verifiable credential.
 *
 * `claims` is whatever shape the caller intends to present against. For a JWT VC that means the
 * JWT payload, with the credential under `vc` — matching what the previous implementation
 * produced internally, and what definitions expect when they list
 * `["$.issuer", "$.vc.issuer", "$.iss"]`.
 */
export const zPexW3cVcCredential = z.object({
  ...credentialBase,
  credential_format: z.enum(['jwt', 'jwt_vc', 'jwt_vc_json', 'ldp', 'ldp_vc', 'di', 'di_vc']),
  claims: zJsonObject,
})
export type PexW3cVcCredential = z.output<typeof zPexW3cVcCredential>

export const zPexCredential = z.discriminatedUnion('credential_format', [
  zPexMdocCredential,
  zPexSdJwtVcCredential,
  zPexW3cVcCredential,
])
export type PexCredential = z.output<typeof zPexCredential>

/** Every credential format designation this library accepts as input. */
export type PexCredentialFormat = PexCredential['credential_format']

/**
 * Whether a credential can disclose selectively, see `selectively_disclosable`.
 */
export function isSelectivelyDisclosable(credential: PexCredential): boolean {
  if (credential.selectively_disclosable !== undefined) return credential.selectively_disclosable
  return (
    credential.credential_format === 'mso_mdoc' ||
    credential.credential_format === 'vc+sd-jwt' ||
    credential.credential_format === 'dc+sd-jwt'
  )
}

/**
 * The value a field's paths resolve against: an mdoc's namespaces, or a credential's claims.
 */
export function getCredentialClaims(credential: PexCredential): JsonObject {
  return credential.credential_format === 'mso_mdoc'
    ? (credential.namespaces as JsonObject)
    : (credential.claims as JsonObject)
}
