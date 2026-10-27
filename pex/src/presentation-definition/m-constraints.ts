import { z } from 'zod'
import { zFieldV1, zFieldV2, zOptionality } from './m-field.js'

export const zDirectives = z.enum(['required', 'allowed', 'disallowed'])
export type Directives = z.output<typeof zDirectives>

export const zHolderSubject = z.strictObject({
  field_id: z.array(z.string()).nonempty(),
  directive: zOptionality,
})
export type HolderSubject = z.output<typeof zHolderSubject>

export const zPdStatus = z.strictObject({
  directive: zDirectives,
  type: z.array(z.string()).nonempty().optional(),
})
export type PdStatus = z.output<typeof zPdStatus>

export const zStatuses = z.strictObject({
  active: zPdStatus.optional(),
  suspended: zPdStatus.optional(),
  revoked: zPdStatus.optional(),
})
export type Statuses = z.output<typeof zStatuses>

/**
 * Constraints this library models but does not evaluate.
 *
 * `is_holder`, `same_subject` and `statuses` require information the caller does not hand us —
 * holder binding proofs, subject linkage across credentials, live status list lookups. The
 * previous implementation accepted them and returned success regardless, which is a silent
 * false claim of compliance. Here they are parsed and carried, and an input descriptor that
 * marks one as `required` fails with an explicit `unsupported_constraint` reason.
 */
export const unevaluatedConstraints = ['is_holder', 'same_subject', 'statuses'] as const
export type UnevaluatedConstraint = (typeof unevaluatedConstraints)[number]

const constraintsBase = {
  limit_disclosure: zOptionality.optional(),
  statuses: zStatuses.optional(),
  subject_is_issuer: zOptionality.optional(),
  is_holder: z.array(zHolderSubject).optional(),
  same_subject: z.array(zHolderSubject).optional(),
}

export const zConstraintsV1 = z.strictObject({
  ...constraintsBase,
  fields: z.array(zFieldV1).optional(),
})
export type ConstraintsV1 = z.output<typeof zConstraintsV1>

export const zConstraintsV2 = z.strictObject({
  ...constraintsBase,
  fields: z.array(zFieldV2).optional(),
})
export type ConstraintsV2 = z.output<typeof zConstraintsV2>

export type Constraints = ConstraintsV1 | ConstraintsV2
