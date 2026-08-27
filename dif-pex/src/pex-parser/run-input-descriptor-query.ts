import { getCredentialClaims, type PexCredential } from '../pex-credential/u-pex-credential.js'
import type {
  CredentialMatch,
  CredentialMismatch,
  InputDescriptorResult,
  MismatchReason,
} from '../pex-query-result/m-pex-query-result.js'
import type { Constraints } from '../presentation-definition/m-constraints.js'
import { unevaluatedConstraints } from '../presentation-definition/m-constraints.js'
import type { InputDescriptor } from '../presentation-definition/m-input-descriptor.js'
import type { PresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { buildLimitDisclosure } from './limit-disclosure.js'
import { compileFields, runFieldsQuery } from './run-fields-query.js'
import { getEffectiveFormat, runFormatQuery } from './run-format-query.js'
import { runSchemaQuery } from './run-schema-query.js'

/**
 * Constraints this library cannot evaluate, checked against what the descriptor asks for.
 *
 * `is_holder`, `same_subject` and `statuses` need information the caller does not supply — holder
 * binding proofs, subject linkage across credentials, live status list lookups. The previous
 * implementation accepted them and returned success anyway, which is a silent false claim of
 * compliance. A descriptor that marks one `required` fails here instead.
 *
 * A `preferred` directive asserts nothing, so it passes.
 */
function checkUnsupportedConstraints(constraints: Constraints | undefined): MismatchReason[] {
  if (constraints === undefined) return []

  const reasons: MismatchReason[] = []

  for (const constraint of unevaluatedConstraints) {
    const value = constraints[constraint]
    if (value === undefined) continue

    const required =
      constraint === 'statuses'
        ? Object.values(value).some((status) => status?.directive === 'required')
        : (value as Array<{ directive: string }>).some((entry) => entry.directive === 'required')

    if (!required) continue

    reasons.push({
      type: 'unsupported_constraint',
      constraint,
      message:
        `Input descriptor requires '${constraint}', which this library does not evaluate. ` +
        'It must be checked by the caller, which has the information this library does not.',
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
    return [
      {
        type: 'subject_is_issuer',
        message:
          "Input descriptor requires 'subject_is_issuer', but the credential does not declare " +
          `${issuer === undefined ? "'issuer'" : ''}${issuer === undefined && subject === undefined ? ' and ' : ''}${subject === undefined ? "'subject'" : ''}`,
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
 * Evaluate one input descriptor against every candidate credential.
 */
export function runInputDescriptorQuery(
  definition: PresentationDefinition,
  inputDescriptor: InputDescriptor,
  inputDescriptorIndex: number,
  credentials: PexCredential[]
): InputDescriptorResult {
  const constraints = inputDescriptor.constraints
  const schema = 'schema' in inputDescriptor ? inputDescriptor.schema : undefined
  const format = getEffectiveFormat(definition, inputDescriptor)
  const limitDisclosure = constraints?.limit_disclosure !== undefined

  // Paths depend only on the definition, so they are parsed once for all credentials.
  const compiled = compileFields(constraints?.fields)
  const unsupported = checkUnsupportedConstraints(constraints)

  const matching: CredentialMatch[] = []
  const nonMatching: CredentialMismatch[] = []

  for (const [credentialIndex, credential] of credentials.entries()) {
    const reasons: MismatchReason[] = [
      ...unsupported,
      ...checkSubjectIsIssuer(constraints, credential),
      ...checkMdocDoctype(inputDescriptor, credential),
    ]

    const formatResult = runFormatQuery(credential, format)
    if (!formatResult.success) reasons.push(formatResult.reason)

    if (schema !== undefined) {
      const schemaResult = runSchemaQuery(credential, schema)
      if (!schemaResult.success) reasons.push(schemaResult.reason)
    }

    const fields = runFieldsQuery(compiled, getCredentialClaims(credential))
    reasons.push(...fields.reasons)

    if (reasons.length > 0) {
      nonMatching.push({ credential_index: credentialIndex, format: credential.credential_format, reasons })
      continue
    }

    matching.push({
      credential_index: credentialIndex,
      format: credential.credential_format,
      fields: fields.matches,
      disclosure: limitDisclosure ? buildLimitDisclosure(credential, fields.matches) : undefined,
    })
  }

  return {
    input_descriptor_id: inputDescriptor.id,
    input_descriptor_index: inputDescriptorIndex,
    name: inputDescriptor.name,
    purpose: inputDescriptor.purpose,
    group: inputDescriptor.group,
    satisfied: matching.length > 0,
    matching_credentials: matching,
    non_matching_credentials: nonMatching,
  }
}
