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
function runSubmissionRequirement(
  requirement: SubmissionRequirement,
  index: number,
  inputDescriptors: InputDescriptorResult[]
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
      satisfied: isSatisfied(requirement, satisfiedCount, neededCount),
    }
  }

  const nested = (requirement.from_nested ?? []).map((child, childIndex) =>
    runSubmissionRequirement(child, childIndex, inputDescriptors)
  )
  const satisfiedCount = nested.filter((child) => child.satisfied).length
  const neededCount = getNeededCount(requirement, nested.length)

  return {
    ...shared,
    from_nested: nested,
    needs_count: neededCount,
    satisfied: isSatisfied(requirement, satisfiedCount, neededCount),
  }
}

/**
 * `all` needs every member. `pick` needs at least `needs_count`, and no more than `max` may be
 * *available* to choose from — `max` bounds what the holder may disclose, and a holder can always
 * disclose fewer than are available, so exceeding it is not a failure.
 */
function isSatisfied(requirement: SubmissionRequirement, satisfiedCount: number, neededCount: number): boolean {
  if (requirement.rule === 'all') return satisfiedCount === neededCount
  return satisfiedCount >= neededCount
}

export function runSubmissionRequirements(
  definition: PresentationDefinition,
  inputDescriptors: InputDescriptorResult[]
): SubmissionRequirementResult[] | undefined {
  if (definition.submission_requirements === undefined) return undefined

  return definition.submission_requirements.map((requirement, index) =>
    runSubmissionRequirement(requirement, index, inputDescriptors)
  )
}
