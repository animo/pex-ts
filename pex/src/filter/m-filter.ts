import { z } from 'zod'
import type { InferModelTypes } from '../u-model.js'
import { ModelDefinition } from '../u-model.js'
import { zFilterScalar, zNumberOrString } from '../u-pex.js'
import { checkFormat, isComparableFormat } from './formats.js'

/**
 * The JSON Schema types a filter can assert. A field whose path names an object or an array can assert
 * that and disclose it whole; what is inside it is addressed with a deeper path, not a nested filter.
 */
export const zFilterType = z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
export type FilterType = z.output<typeof zFilterType>

const numericBoundKeywords = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const
const formatBoundKeywords = [
  'formatMinimum',
  'formatMaximum',
  'formatExclusiveMinimum',
  'formatExclusiveMaximum',
] as const

/**
 * The keywords that assert something about one value: its type, and for a primitive its exact value,
 * format, length and bounds. This is the whole vocabulary, and the sub-filters of `not`, `contains` and
 * `items` are made of it too, so a filter never nests more than one level.
 *
 * Presentation Exchange defines a filter as arbitrary JSON Schema (v2 literally `$ref`s
 * `http://json-schema.org/schema#`). This library supports this **bounded, closed** set instead, and
 * **rejects everything else when the definition is parsed**. That is a deliberate narrowing, and a deliberate
 * difference from a real JSON Schema validator, which ignores keywords it does not recognise: ignoring an
 * assertion silently widens what matches — a verifier writing a constraint we quietly drop gets credentials
 * it did not ask for. Annotation keywords carry no assertion and are accepted and ignored.
 *
 * Not supported, by design: the structural keywords (`properties`, `required`, `additionalProperties`,
 * `minItems`, `maxItems`, `uniqueItems`, `allOf`, `anyOf`, `oneOf`), as a constraint on something inside an
 * object is written as a deeper path, and `pattern`, as a verifier-controlled regular expression run against
 * the holder's claims can make `RegExp` backtrack for years. See the README.
 */
const valueKeywords = {
  // Annotations — accepted, never asserted.
  $schema: z.string().optional(),
  $id: z.string().optional(),
  $comment: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  examples: z.array(z.unknown()).optional(),

  // Any instance type
  type: z.union([zFilterType, z.array(zFilterType).nonempty()]).optional(),
  const: zFilterScalar.optional(),
  enum: z.array(zFilterScalar).nonempty().optional(),

  // Strings
  format: z.string().optional(),
  minLength: z.int().nonnegative().optional(),
  maxLength: z.int().nonnegative().optional(),

  // Numbers. Strings are permitted so that dates can be bounded.
  minimum: zNumberOrString.optional(),
  maximum: zNumberOrString.optional(),
  exclusiveMinimum: zNumberOrString.optional(),
  exclusiveMaximum: zNumberOrString.optional(),

  // Formatted values (ajv-formats' comparison keywords), used to bound dates and times.
  formatMinimum: z.string().optional(),
  formatMaximum: z.string().optional(),
  formatExclusiveMinimum: z.string().optional(),
  formatExclusiveMaximum: z.string().optional(),
}

/**
 * Bounds that can never be applied are rejected rather than ignored, because ignoring an assertion widens
 * what matches:
 * - a string `minimum` / `maximum` bound on a filter that only admits non-strings, or one that is not valid
 *   for the declared ordered `format`
 * - a `format*` comparison keyword without an ordered `format`, or with a bound not valid for it
 */
function boundIssues(filter: ValueFilter): Array<{ keyword: string; message: string }> {
  const issues: Array<{ keyword: string; message: string }> = []
  const format = filter.format
  const isOrdered = format !== undefined && isComparableFormat(format)
  const types = filter.type === undefined ? undefined : Array.isArray(filter.type) ? filter.type : [filter.type]

  for (const keyword of numericBoundKeywords) {
    const bound = filter[keyword]
    if (typeof bound !== 'string') continue

    if (types !== undefined && !types.includes('string')) {
      issues.push({
        keyword,
        message: `A string bound can only apply to a string, but the filter only admits ${types.join(' or ')}`,
      })
    } else if (isOrdered && checkFormat(format, bound) !== true) {
      issues.push({ keyword, message: `'${bound}' is not a valid ${format}` })
    }
  }

  for (const keyword of formatBoundKeywords) {
    const bound = filter[keyword]
    if (bound === undefined) continue

    if (format === undefined) issues.push({ keyword, message: `'${keyword}' requires 'format' to be declared` })
    else if (!isOrdered) {
      issues.push({
        keyword,
        message: `'${keyword}' requires an ordered format (date, date-time or time), got '${format}'`,
      })
    } else if (checkFormat(format, bound) !== true)
      issues.push({ keyword, message: `'${bound}' is not a valid ${format}` })
  }

  return issues
}

function refineBounds(filter: ValueFilter, ctx: { issues: z.core.$ZodRawIssue[] }) {
  for (const { keyword, message } of boundIssues(filter)) {
    ctx.issues.push({ code: 'custom', input: filter, path: [keyword], message })
  }
}

/** A filter made of the value keywords only: what `not`, `contains` and `items` take. */
export const zValueFilter: z.ZodType<ValueFilter> = z.strictObject(valueKeywords).superRefine(refineBounds)

/**
 * Declared as an interface rather than inferred, so that a consumer's `Object.entries(filter)` keeps the loose
 * typing an interface gets, and the model reads as a whole.
 */
export interface ValueFilter {
  $schema?: string
  $id?: string
  $comment?: string
  title?: string
  description?: string
  default?: unknown
  examples?: unknown[]

  type?: FilterType | FilterType[]
  const?: string | number | boolean | null
  enum?: (string | number | boolean | null)[]

  format?: string
  minLength?: number
  maxLength?: number

  minimum?: number | string
  maximum?: number | string
  exclusiveMinimum?: number | string
  exclusiveMaximum?: number | string

  formatMinimum?: string
  formatMaximum?: string
  formatExclusiveMinimum?: string
  formatExclusiveMaximum?: string
}

/**
 * The filter applied to the value a field's path resolves to: the value keywords, and three that take a
 * sub-filter made of them. One model covers both v1 and v2: `pex-models` types a narrower `FilterV1`, but
 * that reflects how those types were generated rather than anything in the v1 spec.
 */
export const zFilter: z.ZodType<Filter> = z
  .strictObject({
    ...valueKeywords,
    /** The value must not satisfy this. */
    not: zValueFilter.optional(),
    /** Every element of the array must satisfy this. Only with `type: 'array'`. */
    items: zValueFilter.optional(),
    /** At least one element of the array must satisfy this. Only with `type: 'array'`. */
    contains: zValueFilter.optional(),
  })
  .superRefine((filter, ctx) => {
    refineBounds(filter, ctx)

    // An array keyword on a filter that doesn't say it describes an array asserts nothing for any other
    // value, which JSON Schema accepts and this library doesn't: the filter has to say what it describes.
    for (const keyword of ['items', 'contains'] as const) {
      if (filter[keyword] !== undefined && filter.type !== 'array') {
        ctx.issues.push({
          code: 'custom',
          input: filter,
          path: [keyword],
          message: `'${keyword}' requires 'type' to be 'array'`,
        })
      }
    }
  })
export interface Filter extends ValueFilter {
  /** The value must not satisfy this. */
  not?: ValueFilter
  /** Every element of the array must satisfy this. Only with `type: 'array'`. */
  items?: ValueFilter
  /** At least one element of the array must satisfy this. Only with `type: 'array'`. */
  contains?: ValueFilter
}

export const filterModel = new ModelDefinition({ zModel: zFilter })
export type FilterModel = InferModelTypes<typeof filterModel>
