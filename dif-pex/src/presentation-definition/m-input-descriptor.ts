import { z } from 'zod'
import { zConstraintsV1, zConstraintsV2 } from './m-constraints.js'
import { zFormat } from './m-format.js'

export const zSchema = z.strictObject({
  uri: z.string(),
  required: z.boolean().optional(),
})
export type Schema = z.output<typeof zSchema>

/**
 * Deprecated in the spec and never evaluated; carried so definitions round-trip.
 */
export const zIssuance = z.looseObject({
  manifest: z.string().optional(),
})
export type Issuance = z.output<typeof zIssuance>

const inputDescriptorBase = {
  id: z.string(),
  name: z.string().optional(),
  purpose: z.string().optional(),
  /**
   * Group names this descriptor belongs to. Submission requirements select descriptors by
   * referencing these — the linkage has no analogue in DCQL.
   */
  group: z.array(z.string()).nonempty().optional(),
  issuance: z.array(zIssuance).nonempty().optional(),
}

/**
 * v1 identifies acceptable credentials by schema URI, and makes `constraints` optional.
 */
export const zInputDescriptorV1 = z.strictObject({
  ...inputDescriptorBase,
  schema: z.array(zSchema).nonempty(),
  constraints: zConstraintsV1.optional(),
})
export type InputDescriptorV1 = z.output<typeof zInputDescriptorV1>

/**
 * v2 drops `schema` in favour of expressing everything through `constraints.fields`, makes
 * `constraints` required, and allows a per-descriptor `format`.
 */
export const zInputDescriptorV2 = z.strictObject({
  ...inputDescriptorBase,
  format: zFormat.optional(),
  constraints: zConstraintsV2,
})
export type InputDescriptorV2 = z.output<typeof zInputDescriptorV2>

export type InputDescriptor = InputDescriptorV1 | InputDescriptorV2
