import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import { runInputDescriptorQuery } from '../pex-parser/run-input-descriptor-query.js'
import { runSubmissionRequirements } from '../pex-parser/run-submission-requirements.js'
import type { ParsedPresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { parsePresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { validatePresentationDefinition } from '../presentation-definition/validate-definition.js'
import type { PexQueryResult } from './m-pex-query-result.js'

export interface RunPexQueryOptions {
  credentials: PexCredential[]
}

/**
 * Evaluate a presentation definition against a set of credentials.
 *
 * The definition must already be parsed — use {@link parsePresentationDefinition}, which also
 * tells you which version it is. Nothing here throws for a credential that does not match; that
 * is reported in the result, with the reasons.
 */
export function runPexQuery(parsed: ParsedPresentationDefinition, options: RunPexQueryOptions): PexQueryResult {
  const { definition, version } = parsed
  const { credentials } = options

  const inputDescriptors = definition.input_descriptors.map((inputDescriptor, index) =>
    runInputDescriptorQuery(definition, inputDescriptor, index, credentials)
  )

  const submissionRequirements = runSubmissionRequirements(definition, inputDescriptors)

  // With submission requirements, they decide. Without them, every input descriptor must be
  // satisfied — which is vacuously true for a definition that declares none.
  const canBeSatisfied =
    submissionRequirements !== undefined
      ? submissionRequirements.every((requirement) => requirement.satisfied)
      : inputDescriptors.every((result) => result.satisfied)

  return {
    definition_id: definition.id,
    name: definition.name,
    purpose: definition.purpose,
    version,
    can_be_satisfied: canBeSatisfied,
    input_descriptors: inputDescriptors,
    submission_requirements: submissionRequirements,
  }
}

/**
 * Parse, validate and evaluate a definition in one call.
 *
 * Throws `PexParseError` if the definition matches neither version, and
 * `PexInvalidDefinitionError` if it has semantic problems.
 */
export function queryPresentationDefinition(definition: unknown, options: RunPexQueryOptions): PexQueryResult {
  const parsed = parsePresentationDefinition(definition)
  validatePresentationDefinition(parsed.definition)
  return runPexQuery(parsed, options)
}
