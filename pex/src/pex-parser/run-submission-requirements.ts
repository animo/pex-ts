import type { InputDescriptorResult, SubmissionRequirementResult } from '../pex-query-result/m-pex-query-result.js'
import type { PresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { getNeededCount, type SubmissionRequirement } from '../presentation-definition/m-submission-requirement.js'

/**
 * Evaluate one submission requirement, and its children, against the input descriptor results.
 *
 * The result mirrors the definition's own tree rather than flattening it into a list of
 * satisfying combinations. Enumerating combinations is how DCQL models `credential_sets`, but it
 * is foreign to Presentation Exchange — and under `from_nested` the number of subsets is
 * unbounded. Reporting which members are available and how many are needed lets the wallet
 * choose, which is both what the spec describes and what callers already do.
 */
export interface RunSubmissionRequirementsOptions {
  /**
   * Evaluate a submission rather than a query. A satisfied member is then one that was submitted, so a
   * `pick` needs exactly `count` of them, or between `min` and `max`. For a query a satisfied member is one
   * that is available, and a holder can always submit fewer than are available, so only the lower bound
   * applies.
   */
  submission?: boolean
}

function runSubmissionRequirement(
  requirement: SubmissionRequirement,
  index: number,
  inputDescriptors: InputDescriptorResult[],
  options: RunSubmissionRequirementsOptions
): SubmissionRequirementResult {
  const shared = {
    submission_requirement_index: index,
    name: requirement.name,
    purpose: requirement.purpose,
    rule: requirement.rule,
    count: requirement.count,
    min: requirement.min,
    max: requirement.max,
  }

  if (requirement.from !== undefined) {
    const group = requirement.from
    const members = inputDescriptors
      .filter((result) => result.group?.includes(group))
      .map((result) => ({ input_descriptor_id: result.input_descriptor_id, satisfied: result.satisfied }))

    const satisfiedCount = members.filter((member) => member.satisfied).length
    const neededCount = getNeededCount(requirement, members.length)

    return {
      ...shared,
      from: group,
      input_descriptors: members,
      needs_count: neededCount,
      satisfied: isSatisfied(requirement, satisfiedCount, neededCount, options),
    }
  }

  const nested = (requirement.from_nested ?? []).map((child, childIndex) =>
    runSubmissionRequirement(child, childIndex, inputDescriptors, options)
  )
  const satisfiedCount = nested.filter((child) => child.satisfied).length
  const neededCount = getNeededCount(requirement, nested.length)

  return {
    ...shared,
    from_nested: nested,
    needs_count: neededCount,
    satisfied: isSatisfied(requirement, satisfiedCount, neededCount, options),
  }
}

/**
 * `all` needs every member, and at least one: a group no input descriptor declares is not satisfied by
 * nothing. `pick` needs at least `needs_count`, and with {@link RunSubmissionRequirementsOptions.submission}
 * exactly `count`, or no more than `max`.
 */
function isSatisfied(
  requirement: SubmissionRequirement,
  satisfiedCount: number,
  neededCount: number,
  options: RunSubmissionRequirementsOptions
): boolean {
  if (requirement.rule === 'all') return neededCount > 0 && satisfiedCount === neededCount
  if (satisfiedCount < neededCount) return false
  if (!options.submission) return true
  if (requirement.count !== undefined) return satisfiedCount === requirement.count
  return requirement.max === undefined || satisfiedCount <= requirement.max
}

export function runSubmissionRequirements(
  definition: PresentationDefinition,
  inputDescriptors: InputDescriptorResult[],
  options: RunSubmissionRequirementsOptions = {}
): SubmissionRequirementResult[] | undefined {
  // An empty array declares no requirement, which is the same as declaring none: every input descriptor counts
  const requirements = definition.submission_requirements
  if (requirements === undefined || requirements.length === 0) return undefined

  return requirements.map((requirement, index) =>
    runSubmissionRequirement(requirement, index, inputDescriptors, options)
  )
}
