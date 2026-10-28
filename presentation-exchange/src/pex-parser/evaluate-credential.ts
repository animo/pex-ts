import {
  canWithholdArrayElements,
  getCredentialClaims,
  isSelectivelyDisclosable,
  type PexCredential,
} from '../pex-credential/u-pex-credential.js'
import type { FieldMatch, MismatchReason } from '../pex-query-result/m-pex-query-result.js'
import type { Constraints } from '../presentation-definition/m-constraints.js'
import { unevaluatedConstraints } from '../presentation-definition/m-constraints.js'
import type { InputDescriptor } from '../presentation-definition/m-input-descriptor.js'
import type { PresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { type CompiledField, runFieldsQuery } from './run-fields-query.js'
import { getEffectiveFormat, runFormatQuery } from './run-format-query.js'
import { runSchemaQuery } from './run-schema-query.js'

/**
 * Constraints this library cannot evaluate, checked against what the descriptor asks for.
 *
 * `is_holder`, `same_subject` and `statuses` need information the caller does not supply — holder
 * binding proofs, subject linkage across credentials, live status list lookups. The previous
 * implementation accepted them and returned success anyway, which is a silent false claim of
 * compliance. A descriptor that asserts one fails here instead, unless the caller declares it evaluates
 * the constraint itself (`PexCredential.evaluated_constraints`).
 *
 * `preferred` (and, for a status, `allowed`) asserts nothing, so it passes. A status marked
 * `disallowed` — "the credential must not be revoked" — is an assertion as much as `required` is.
 */
function checkUnsupportedConstraints(
  constraints: Constraints | undefined,
  credential: PexCredential
): MismatchReason[] {
  if (constraints === undefined) return []

  const reasons: MismatchReason[] = []

  for (const constraint of unevaluatedConstraints) {
    const value = constraints[constraint]
    if (value === undefined || credential.evaluated_constraints?.includes(constraint)) continue

    const asserted =
      constraint === 'statuses'
        ? Object.values(value).some((status) => status?.directive === 'required' || status?.directive === 'disallowed')
        : (value as Array<{ directive: string }>).some((entry) => entry.directive === 'required')

    if (!asserted) continue

    reasons.push({
      type: 'unsupported_constraint',
      constraint,
      message:
        `Input descriptor asserts '${constraint}', which this library does not evaluate. ` +
        `It must be checked by the caller, which declares so in the credential's 'evaluated_constraints'.`,
    })
  }

  return reasons
}

/**
 * `subject_is_issuer` is evaluated when the caller supplies both `issuer` and `subject` on the
 * credential. When it is required and either is missing, the credential fails rather than
 * passing on an unverified assumption.
 */
function checkSubjectIsIssuer(constraints: Constraints | undefined, credential: PexCredential): MismatchReason[] {
  if (constraints?.subject_is_issuer !== 'required') return []

  const { issuer, subject } = credential
  if (issuer === undefined || subject === undefined) {
    const missing = [issuer === undefined && "'issuer'", subject === undefined && "'subject'"].filter(Boolean)
    return [
      {
        type: 'subject_is_issuer',
        message: `Input descriptor requires 'subject_is_issuer', but the credential does not declare ${missing.join(' and ')}`,
      },
    ]
  }

  if (issuer !== subject) {
    return [
      {
        type: 'subject_is_issuer',
        message: `Input descriptor requires 'subject_is_issuer', but issuer '${issuer}' is not the subject '${subject}'`,
      },
    ]
  }

  return []
}

/**
 * ISO 18013-7 requires an mdoc input descriptor's id to be the doctype it requests.
 */
function checkMdocDoctype(inputDescriptor: InputDescriptor, credential: PexCredential): MismatchReason[] {
  if (credential.credential_format !== 'mso_mdoc') return []
  if (credential.doctype === inputDescriptor.id) return []

  return [
    {
      type: 'mdoc_doctype',
      message: `Credential doctype '${credential.doctype}' does not match the input descriptor id '${inputDescriptor.id}', which ISO 18013-7 requires`,
    },
  ]
}

/**
 * `limit_disclosure: required` can only be honoured by a credential that discloses selectively. Any other
 * credential would be presented in full.
 */
function checkLimitDisclosure(constraints: Constraints | undefined, credential: PexCredential): MismatchReason[] {
  if (constraints?.limit_disclosure !== 'required' || isSelectivelyDisclosable(credential)) return []

  return [
    {
      type: 'limit_disclosure',
      message: `Input descriptor requires limited disclosure, which a '${credential.credential_format}' credential cannot provide unless it declares 'selectively_disclosable'`,
    },
  ]
}

export interface EvaluateCredentialOptions {
  /**
   * Evaluate a credential as a verifier received it:
   * - an array index in a path matches any element of a credential that can withhold array elements (see
   *   `canWithholdArrayElements`), as the elements a holder withheld are absent
   * - an algorithm, proof type or cryptosuite restriction fails when the credential declares none,
   *   rather than being skipped as it is for a holder, who can't always know them in advance
   */
  presentation: boolean
}

/**
 * Evaluate one credential against one input descriptor: every check, with every failing one reported.
 * The holder-side query and the verifier-side submission check share this, so they cannot drift apart.
 */
export function evaluateCredential(
  definition: PresentationDefinition,
  inputDescriptor: InputDescriptor,
  compiledFields: CompiledField[],
  credential: PexCredential,
  options: EvaluateCredentialOptions
): { matches: FieldMatch[]; reasons: MismatchReason[] } {
  const { constraints } = inputDescriptor

  const reasons: MismatchReason[] = [
    ...checkUnsupportedConstraints(constraints, credential),
    ...checkSubjectIsIssuer(constraints, credential),
    ...checkMdocDoctype(inputDescriptor, credential),
    ...checkLimitDisclosure(constraints, credential),
  ]

  const formatResult = runFormatQuery(credential, getEffectiveFormat(definition, inputDescriptor), {
    requireDeclared: options.presentation,
  })
  if (!formatResult.success) reasons.push(formatResult.reason)

  if ('schema' in inputDescriptor) {
    const schemaResult = runSchemaQuery(credential, inputDescriptor.schema)
    if (!schemaResult.success) reasons.push(schemaResult.reason)
  }

  const fields = runFieldsQuery(compiledFields, getCredentialClaims(credential), {
    // A credential presented in full keeps the positions of its array elements, so its indexes are matched as they are
    presentation: options.presentation && canWithholdArrayElements(credential),
    predicateResults: credential.predicate_results === true,
  })
  reasons.push(...fields.reasons)

  return { matches: fields.matches, reasons }
}
