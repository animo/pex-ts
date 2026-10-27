import { z } from 'zod'
import { zFilter } from '../filter/m-filter.js'
import { parseJsonPath } from '../json-path/parse-json-path.js'
import { PexJsonPathError } from '../pex-error/e-pex.js'

export const zOptionality = z.enum(['required', 'preferred'])
export type Optionality = z.output<typeof zOptionality>

/**
 * A JSONPath restricted to the subset this library supports.
 *
 * Validated when the definition is parsed rather than when a query runs, so a definition using
 * an unsupported construct fails loudly and immediately instead of silently matching nothing.
 */
export const zJsonPathString = z.string().check((ctx) => {
  try {
    parseJsonPath(ctx.value)
  } catch (error) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: error instanceof PexJsonPathError ? error.message : `Invalid path '${ctx.value}'`,
    })
  }
})

/**
 * A field path, which points below the root. `$` would disclose the whole credential, and a DCQL claims
 * path can't be empty either.
 */
const zFieldPath = zJsonPathString.check((ctx) => {
  if (ctx.value === '$') {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: "A field path must point to a claim, not the whole credential ('$')",
    })
  }
})

const fieldBase = {
  id: z.string().optional(),
  /**
   * Candidate paths, tried in order. The first that resolves to at least one node is the one
   * evaluated; the rest are not consulted. This is how a definition expresses the same claim
   * across credential shapes, e.g. `["$.issuer", "$.vc.issuer", "$.iss"]`.
   */
  path: z.array(zFieldPath).nonempty(),
  purpose: z.string().optional(),
  filter: zFilter.optional(),
  predicate: zOptionality.optional(),
}

/**
 * Both spec versions require that `predicate` is accompanied by `filter` — a predicate asks
 * "does this value satisfy the filter" and is meaningless without one.
 */
const requirePredicateFilter = <T extends { predicate?: Optionality; filter?: unknown }>(
  field: T,
  ctx: z.RefinementCtx<T>
) => {
  if (field.predicate !== undefined && field.filter === undefined) {
    ctx.issues.push({
      code: 'custom',
      input: field,
      path: ['filter'],
      message: "A field using 'predicate' must also define 'filter'",
    })
  }
}

export const zFieldV1 = z.strictObject(fieldBase).superRefine(requirePredicateFilter)
export type FieldV1 = z.output<typeof zFieldV1>

export const zFieldV2 = z
  .strictObject({
    ...fieldBase,
    name: z.string().optional(),
    /**
     * When true the field is satisfied even if no path resolves. Introduced in v2.
     */
    optional: z.boolean().optional(),
    /**
     * Signals the verifier intends to retain the claim. Carried through to the caller (mdoc
     * device requests need it) but never asserted against a credential.
     */
    intent_to_retain: z.boolean().optional(),
  })
  .superRefine(requirePredicateFilter)
export type FieldV2 = z.output<typeof zFieldV2>

/**
 * The union of both field shapes. v2 is a superset of v1, so evaluation only ever needs this.
 */
export type Field = FieldV1 | FieldV2
