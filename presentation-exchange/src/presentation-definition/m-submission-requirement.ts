import { z } from 'zod'

export const zRules = z.enum(['all', 'pick'])
export type Rules = z.output<typeof zRules>

/**
 * Selects which input descriptors must be satisfied, by referencing the `group` they declare.
 *
 * Exactly one of `from` (a group name) or `from_nested` (child requirements) must be present —
 * both spec versions express this as a `oneOf`.
 *
 * `count` / `min` / `max` only carry meaning under `rule: 'pick'`. Under `rule: 'all'` every
 * member must be satisfied, so the bounds are redundant; they are accepted and ignored, which is
 * what both the spec schemas and the previous implementation do.
 *
 * `from_nested` refers back to this schema through a getter, which is how zod 4 defines a recursive
 * type: the getter runs when the shape is first read, after the constant is initialised.
 */
export const zSubmissionRequirement: z.ZodType<SubmissionRequirement> = z
  .strictObject({
    name: z.string().optional(),
    purpose: z.string().optional(),
    rule: zRules,
    count: z.int().min(1).optional(),
    min: z.int().nonnegative().optional(),
    max: z.int().nonnegative().optional(),
    from: z.string().optional(),
    get from_nested() {
      return z.array(zSubmissionRequirement).nonempty().optional()
    },
  })
  .superRefine((requirement, ctx) => {
    if (requirement.from === undefined && requirement.from_nested === undefined) {
      ctx.issues.push({
        code: 'custom',
        input: requirement,
        message: "A submission requirement must define either 'from' or 'from_nested'",
      })
    }

    if (requirement.from !== undefined && requirement.from_nested !== undefined) {
      ctx.issues.push({
        code: 'custom',
        input: requirement,
        message: "A submission requirement must not define both 'from' and 'from_nested'",
      })
    }

    // `count` alongside `min`/`max` is permitted — both spec schemas allow all three, and real
    // definitions in the wild set `count: 4, min: 4, max: 4`. Combinations that contradict each
    // other are reported by `validatePresentationDefinition` rather than rejected here, so that
    // parsing accepts exactly what the spec's own JSON Schema accepts.
  })

export interface SubmissionRequirement {
  name?: string
  purpose?: string
  rule: Rules
  count?: number
  min?: number
  max?: number
  from?: string
  from_nested?: SubmissionRequirement[]
}

/**
 * How many members of a requirement must be satisfied for it to hold.
 *
 * Under `all` that is every member. Under `pick` it is `count`, else `min`, else one — the spec
 * does not define the bare `pick` case, and one is the reading every implementation has taken.
 */
export function getNeededCount(requirement: SubmissionRequirement, memberCount: number): number {
  if (requirement.rule === 'all') return memberCount
  return requirement.count ?? requirement.min ?? 1
}
