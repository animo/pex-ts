import { z } from 'zod'
import type { InferModelTypes } from '../u-model.js'
import { ModelDefinition } from '../u-model.js'
import { zFilterScalar, zNumberOrString } from '../u-pex.js'

/**
 * The JSON Schema types a filter can assert.
 */
export const zFilterType = z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
export type FilterType = z.output<typeof zFilterType>

/**
 * A regex that compiles. Verifier-supplied patterns are validated when the definition is parsed,
 * so a malformed one is reported against the definition rather than blowing up mid-evaluation.
 *
 * Note that a pattern is still attacker-controlled input evaluated against holder data, so
 * catastrophic backtracking remains possible — the same exposure the ajv-based implementation
 * had. JavaScript offers no way to time-bound a `RegExp`, so this is documented rather than
 * defended against.
 */
const zPattern = z.string().refine(
  (pattern) => {
    try {
      new RegExp(pattern)
      return true
    } catch {
      return false
    }
  },
  { error: 'Invalid regular expression' }
)

/**
 * The filter applied to the value a field's path resolves to.
 *
 * Presentation Exchange defines this as arbitrary JSON Schema (v2 literally `$ref`s
 * `http://json-schema.org/schema#`). This library instead supports a **bounded, closed** set of
 * keywords, and **rejects unknown ones when the definition is parsed**.
 *
 * That is a deliberate narrowing, and a deliberate difference from a real JSON Schema validator,
 * which ignores keywords it does not recognise. Ignoring an assertion silently widens what
 * matches — a verifier writing a constraint we quietly drop gets credentials it did not ask for
 * — so an unsupported keyword is reported instead. Annotation keywords carry no assertion and
 * are accepted and ignored.
 *
 * One model covers both v1 and v2. `pex-models` types a narrower `FilterV1` (no `contains`,
 * `items` or `format*` bounds), but that reflects how those types were generated rather than
 * anything in the v1 spec, which permits full JSON Schema just as v2 does.
 */
export const zFilter: z.ZodType<Filter> = z.lazy(() =>
  z.strictObject({
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
    pattern: zPattern.optional(),
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

    // Arrays
    minItems: z.int().nonnegative().optional(),
    maxItems: z.int().nonnegative().optional(),
    uniqueItems: z.boolean().optional(),
    get items() {
      return z.union([zFilter, z.array(zFilter).nonempty()]).optional()
    },
    get contains() {
      return zFilter.optional()
    },

    // Objects
    required: z.array(z.string()).optional(),
    get properties() {
      return z.record(z.string(), zFilter).optional()
    },
    get additionalProperties() {
      return z.union([z.boolean(), zFilter]).optional()
    },

    // Composition
    get not() {
      return zFilter.optional()
    },
    get allOf() {
      return z.array(zFilter).nonempty().optional()
    },
    get anyOf() {
      return z.array(zFilter).nonempty().optional()
    },
    get oneOf() {
      return z.array(zFilter).nonempty().optional()
    },
  })
)

export interface Filter {
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

  pattern?: string
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

  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  items?: Filter | Filter[]
  contains?: Filter

  required?: string[]
  properties?: Record<string, Filter>
  additionalProperties?: boolean | Filter

  not?: Filter
  allOf?: Filter[]
  anyOf?: Filter[]
  oneOf?: Filter[]
}

export const filterModel = new ModelDefinition({ zModel: zFilter })
export type FilterModel = InferModelTypes<typeof filterModel>
