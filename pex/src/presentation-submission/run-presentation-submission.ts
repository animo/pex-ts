import type { PexCredential } from '../pex-credential/u-pex-credential.js'
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
import type { Descriptor, PresentationSubmission } from './m-presentation-submission.js'
import { resolveDescriptorLocation } from './resolve-descriptor.js'

/**
 * A presentation, as far as this library needs to understand one: the credentials it carries, in
 * the order a `descriptor_map` path would address them. For an mdoc device response, its documents.
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
 * The credential a resolved `descriptor_map` entry points at. A path that addresses a presentation as a
 * whole selects its only credential, or for an mdoc device response the document whose doctype is the
 * input descriptor's id, as ISO 18013-7 specifies.
 */
function selectCredential(
  descriptor: Descriptor,
  presentation: PexPresentation,
  credentialIndex: number | undefined
): { success: true; credentialIndex: number; credential: PexCredential } | { success: false; message: string } {
  if (credentialIndex !== undefined) {
    const credential = presentation.credentials[credentialIndex]
    if (credential) return { success: true, credentialIndex, credential }
    return { success: false, message: `points at credential ${credentialIndex}, which was not presented` }
  }

  const [onlyCredential, ...otherCredentials] = presentation.credentials
  if (onlyCredential && otherCredentials.length === 0) {
    return { success: true, credentialIndex: 0, credential: onlyCredential }
  }

  const documentIndexes = presentation.credentials
    .map((credential, index) =>
      credential.credential_format === 'mso_mdoc' && credential.doctype === descriptor.id ? index : undefined
    )
    .filter((index) => index !== undefined)
  const [documentIndex, ...otherDocumentIndexes] = documentIndexes
  const document = documentIndex === undefined ? undefined : presentation.credentials[documentIndex]
  if (documentIndex !== undefined && document && otherDocumentIndexes.length === 0) {
    return { success: true, credentialIndex: documentIndex, credential: document }
  }

  return {
    success: false,
    message:
      presentation.credentials.length === 0
        ? 'points at a presentation without credentials'
        : `points at a presentation of ${presentation.credentials.length} credentials without selecting one, and ${documentIndexes.length} mdoc documents have doctype '${shorten(descriptor.id)}'`,
  }
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
 * credentials: an array index in a path matches any element (the elements a holder withheld are absent),
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

    const resolved = resolveDescriptorLocation(descriptor, { presentationCount: presentations.length })
    if (!resolved.success) {
      issues.push(`${label}: ${resolved.message}`)
      continue
    }

    const { presentation_index: presentationIndex } = resolved.location
    const presentation = presentations[presentationIndex]
    if (presentation === undefined) {
      issues.push(`${label} points at presentation ${presentationIndex}, which was not presented`)
      continue
    }

    const selected = selectCredential(descriptor, presentation, resolved.location.credential_index)
    if (!selected.success) {
      issues.push(`${label} ${selected.message}`)
      continue
    }

    const { matches, reasons } = evaluateCredential(
      definition,
      inputDescriptor,
      compileFields(inputDescriptor.constraints?.fields),
      selected.credential,
      { presentation: true }
    )

    const satisfied = reasons.length === 0
    if (satisfied) satisfiedInputDescriptorIds.add(descriptor.id)

    descriptors.push({
      descriptor_index: descriptorIndex,
      input_descriptor_id: descriptor.id,
      presentation_index: presentationIndex,
      credential_index: selected.credentialIndex,
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
