import { getCredentialClaims, type PexCredential } from '../pex-credential/u-pex-credential.js'
import { compileFields, runFieldsQuery } from '../pex-parser/run-fields-query.js'
import { getEffectiveFormat, runFormatQuery } from '../pex-parser/run-format-query.js'
import { runSchemaQuery } from '../pex-parser/run-schema-query.js'
import { runSubmissionRequirements } from '../pex-parser/run-submission-requirements.js'
import type {
  FieldMatch,
  InputDescriptorResult,
  MismatchReason,
  SubmissionRequirementResult,
} from '../pex-query-result/m-pex-query-result.js'
import type { ParsedPresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import type { PresentationSubmission } from './m-presentation-submission.js'
import { resolveDescriptorLocation } from './resolve-descriptor.js'

/**
 * A presentation, as far as this library needs to understand one: the credentials it carries, in
 * the order a `descriptor_map` path would address them.
 *
 * Verifying the presentation itself — signatures, holder binding, key binding JWTs, device
 * signatures — is the caller's job. This library only checks that what was presented answers
 * what was asked.
 */
export interface PexPresentation {
  credentials: PexCredential[]
}

export interface DescriptorResult {
  descriptor_index: number
  input_descriptor_id: string
  presentation_index: number
  credential_index: number
  satisfied: boolean
  fields: FieldMatch[]
  reasons: MismatchReason[]
}

export interface PexPresentationSubmissionResult {
  definition_id: string
  submission_id: string
  valid: boolean
  descriptors: DescriptorResult[]
  submission_requirements?: SubmissionRequirementResult[]
  /** Problems with the submission as a whole, rather than with one descriptor. */
  issues: string[]
}

export interface RunPresentationSubmissionOptions {
  presentations: PexPresentation[]
}

/**
 * Check that a presentation submission answers a presentation definition.
 *
 * Each `descriptor_map` entry is resolved to the credential it points at, that credential is
 * re-evaluated against the input descriptor it claims to satisfy, and the satisfied descriptors
 * are checked against the definition's submission requirements. A verifier must not take the
 * submission's word for what it contains, so nothing here trusts the descriptor's own `format`
 * or the holder's claim to have satisfied a descriptor.
 */
export function runPresentationSubmission(
  parsed: ParsedPresentationDefinition,
  submission: PresentationSubmission,
  options: RunPresentationSubmissionOptions
): PexPresentationSubmissionResult {
  const { definition } = parsed
  const { presentations } = options
  const issues: string[] = []

  if (submission.definition_id !== definition.id) {
    issues.push(
      `Submission is for definition '${submission.definition_id}', but was checked against '${definition.id}'`
    )
  }

  const descriptors: DescriptorResult[] = []
  const satisfiedInputDescriptorIds = new Set<string>()

  for (const [descriptorIndex, descriptor] of submission.descriptor_map.entries()) {
    const inputDescriptorIndex = definition.input_descriptors.findIndex((candidate) => candidate.id === descriptor.id)
    const inputDescriptor = definition.input_descriptors[inputDescriptorIndex]

    if (inputDescriptor === undefined) {
      issues.push(
        `Descriptor ${descriptorIndex} claims input descriptor '${descriptor.id}', which the definition does not declare`
      )
      continue
    }

    const resolved = resolveDescriptorLocation(descriptor)
    if (!resolved.success) {
      issues.push(`Descriptor ${descriptorIndex} ('${descriptor.id}'): ${resolved.message}`)
      continue
    }

    const { presentation_index: presentationIndex, credential_index: credentialIndex } = resolved.location
    const credential = presentations[presentationIndex]?.credentials[credentialIndex]

    if (credential === undefined) {
      issues.push(
        `Descriptor ${descriptorIndex} ('${descriptor.id}') points at presentation ${presentationIndex} credential ${credentialIndex}, which was not presented`
      )
      continue
    }

    const reasons: MismatchReason[] = []

    const formatResult = runFormatQuery(credential, getEffectiveFormat(definition, inputDescriptor))
    if (!formatResult.success) reasons.push(formatResult.reason)

    if ('schema' in inputDescriptor) {
      const schemaResult = runSchemaQuery(credential, inputDescriptor.schema)
      if (!schemaResult.success) reasons.push(schemaResult.reason)
    }

    const fields = runFieldsQuery(compileFields(inputDescriptor.constraints?.fields), getCredentialClaims(credential))
    reasons.push(...fields.reasons)

    const satisfied = reasons.length === 0
    if (satisfied) satisfiedInputDescriptorIds.add(descriptor.id)

    descriptors.push({
      descriptor_index: descriptorIndex,
      input_descriptor_id: descriptor.id,
      presentation_index: presentationIndex,
      credential_index: credentialIndex,
      satisfied,
      fields: fields.matches,
      reasons,
    })
  }

  // Reuse the requirement evaluator by describing what the submission actually satisfied in the
  // same shape the query produces.
  const inputDescriptorResults: InputDescriptorResult[] = definition.input_descriptors.map(
    (inputDescriptor, index) => ({
      input_descriptor_id: inputDescriptor.id,
      input_descriptor_index: index,
      name: inputDescriptor.name,
      purpose: inputDescriptor.purpose,
      group: inputDescriptor.group,
      satisfied: satisfiedInputDescriptorIds.has(inputDescriptor.id),
      matching_credentials: [],
      non_matching_credentials: [],
    })
  )

  const submissionRequirements = runSubmissionRequirements(definition, inputDescriptorResults)

  const requirementsMet =
    submissionRequirements !== undefined
      ? submissionRequirements.every((requirement) => requirement.satisfied)
      : inputDescriptorResults.every((result) => result.satisfied)

  return {
    definition_id: definition.id,
    submission_id: submission.id,
    valid: issues.length === 0 && descriptors.every((descriptor) => descriptor.satisfied) && requirementsMet,
    descriptors,
    submission_requirements: submissionRequirements,
    issues,
  }
}
