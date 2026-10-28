import { evaluateCredential } from '../pex-parser/evaluate-credential.js'
import { compileFields } from '../pex-parser/run-fields-query.js'
import { runSubmissionRequirements } from '../pex-parser/run-submission-requirements.js'
import type {
  FieldMatch,
  InputDescriptorResult,
  MismatchReason,
  SubmissionRequirementResult,
} from '../pex-query-result/m-pex-query-result.js'
import type { ParsedPresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { shorten } from '../u-pex.js'
import type { PresentationSubmission } from './m-presentation-submission.js'
import { type PexPresentation, resolveDescriptorCredential } from './resolve-descriptor.js'

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
 *
 * Every check the holder-side query runs is run here too, with these differences for presented
 * credentials: an array index in a path matches any element of a credential that can withhold array elements, such
 * as an SD-JWT VC (the elements a holder withheld are absent),
 * a format restriction on algorithms, proof types or cryptosuites fails when the credential declares none,
 * and a `pick` requirement needs exactly `count` of its members, or no more than `max`.
 *
 * The definition is expected to be valid, see `validatePresentationDefinition`. The strings a message
 * quotes from the submission are shortened, so a huge submission can't make a huge message.
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
      `Submission is for definition '${shorten(submission.definition_id)}', but was checked against '${definition.id}'`
    )
  }

  const descriptors: DescriptorResult[] = []
  const satisfiedInputDescriptorIds = new Set<string>()

  for (const [descriptorIndex, descriptor] of submission.descriptor_map.entries()) {
    const inputDescriptor = definition.input_descriptors.find((candidate) => candidate.id === descriptor.id)
    const label = `Descriptor ${descriptorIndex} ('${shorten(descriptor.id)}')`

    if (inputDescriptor === undefined) {
      issues.push(
        `Descriptor ${descriptorIndex} claims input descriptor '${shorten(descriptor.id)}', which the definition does not declare`
      )
      continue
    }

    const resolved = resolveDescriptorCredential(descriptor, presentations)
    if (!resolved.success) {
      issues.push(`${label}: ${resolved.message}`)
      continue
    }

    const { matches, reasons } = evaluateCredential(
      definition,
      inputDescriptor,
      compileFields(inputDescriptor.constraints?.fields),
      resolved.credential,
      { presentation: true }
    )

    const satisfied = reasons.length === 0
    if (satisfied) satisfiedInputDescriptorIds.add(descriptor.id)

    descriptors.push({
      descriptor_index: descriptorIndex,
      input_descriptor_id: descriptor.id,
      presentation_index: resolved.location.presentation_index,
      credential_index: resolved.location.credential_index,
      satisfied,
      fields: matches,
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

  const submissionRequirements = runSubmissionRequirements(definition, inputDescriptorResults, { submission: true })

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
