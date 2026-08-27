import type { PathComponent } from '../json-path/m-json-path.js'
import { stringifyJsonPath } from '../json-path/stringify-json-path.js'
import { checkFormat, compareFormat, isComparableFormat } from './formats.js'
import type { Filter, FilterType } from './m-filter.js'

export interface FilterIssue {
  /** The keyword that failed. */
  keyword: string
  message: string
  /** Where inside the filtered value the failure is, for nested filters. Empty at the root. */
  path: PathComponent[]
}

export type FilterResult = { success: true } | { success: false; issues: FilterIssue[] }

const success: FilterResult = { success: true }

function describe(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === 'object') return 'an object'
  return String(value)
}

function typeOf(value: unknown): FilterType | undefined {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'object') return 'object'
  return undefined
}

function matchesType(value: unknown, expected: FilterType): boolean {
  const actual = typeOf(value)
  if (actual === undefined) return false
  // Every integer is also a number; the converse does not hold.
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  return actual === expected
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
  }
  if (typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const a = left as Record<string, unknown>
    const b = right as Record<string, unknown>
    const aKeys = Object.keys(a)
    return aKeys.length === Object.keys(b).length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

/**
 * Compare an instance against a numeric bound.
 *
 * JSON Schema applies `minimum` and friends to numbers only, so a string bound is silently
 * ignored by a conformant validator — which is what the old ajv-based implementation did, making
 * `{"type": "string", "format": "date", "minimum": "1999-05-16"}` (a shape the spec's own
 * examples use, and one `pex-models` types for) assert nothing at all.
 *
 * Rather than drop the assertion, a string bound is compared against a string instance: through
 * the declared `format` when it is an ordered one, and lexically otherwise, which is the correct
 * ordering for ISO 8601. A bound whose type does not match the instance's is not applicable and
 * is ignored, the same way `minLength` is ignored for a number.
 */
function compareToBound(value: unknown, bound: number | string, format: string | undefined): number | undefined {
  if (typeof value === 'number' && typeof bound === 'number') return value - bound

  if (typeof value === 'string' && typeof bound === 'string') {
    if (format !== undefined && isComparableFormat(format)) {
      return compareFormat(format, value, bound)
    }
    return value === bound ? 0 : value < bound ? -1 : 1
  }

  return undefined
}

/**
 * Evaluate a filter against a value.
 *
 * Every failing keyword is reported, not just the first, so a wallet can explain everything a
 * credential got wrong in one pass.
 */
export function runFilter(value: unknown, filter: Filter, path: PathComponent[] = []): FilterResult {
  const issues: FilterIssue[] = []
  const at = path.length === 0 ? '' : ` at ${stringifyJsonPath(path)}`

  const fail = (keyword: string, message: string) => {
    issues.push({ keyword, message: `${message}${at}`, path })
  }

  if (filter.type !== undefined) {
    const expected = Array.isArray(filter.type) ? filter.type : [filter.type]
    if (!expected.some((type) => matchesType(value, type))) {
      fail('type', `Expected ${expected.join(' or ')}, got ${describe(value)}`)
      // Every remaining keyword is type-scoped, so reporting them on a value of the wrong type
      // would only add noise.
      return { success: false, issues }
    }
  }

  if (filter.const !== undefined && !deepEqual(value, filter.const)) {
    fail('const', `Expected ${describe(filter.const)}, got ${describe(value)}`)
  }

  if (filter.enum !== undefined && !filter.enum.some((candidate) => deepEqual(value, candidate))) {
    fail('enum', `Expected one of ${filter.enum.map(describe).join(', ')}, got ${describe(value)}`)
  }

  if (typeof value === 'string') {
    if (filter.pattern !== undefined && !new RegExp(filter.pattern).test(value)) {
      fail('pattern', `Expected ${describe(value)} to match /${filter.pattern}/`)
    }

    if (filter.format !== undefined) {
      // `undefined` means the format is not one we check, which asserts nothing.
      if (checkFormat(filter.format, value) === false) {
        fail('format', `Expected ${describe(value)} to be a valid ${filter.format}`)
      }
    }

    // Code points, not UTF-16 code units, per JSON Schema.
    const length = [...value].length
    if (filter.minLength !== undefined && length < filter.minLength) {
      fail('minLength', `Expected at least ${filter.minLength} characters, got ${length}`)
    }
    if (filter.maxLength !== undefined && length > filter.maxLength) {
      fail('maxLength', `Expected at most ${filter.maxLength} characters, got ${length}`)
    }

    for (const [keyword, bound, test, description] of [
      ['formatMinimum', filter.formatMinimum, (c: number) => c >= 0, 'at or after'],
      ['formatMaximum', filter.formatMaximum, (c: number) => c <= 0, 'at or before'],
      ['formatExclusiveMinimum', filter.formatExclusiveMinimum, (c: number) => c > 0, 'after'],
      ['formatExclusiveMaximum', filter.formatExclusiveMaximum, (c: number) => c < 0, 'before'],
    ] as const) {
      if (bound === undefined) continue
      if (filter.format === undefined) {
        fail(keyword, `'${keyword}' requires 'format' to be declared`)
        continue
      }
      const comparison = compareFormat(filter.format, value, bound)
      if (comparison === undefined) {
        fail(keyword, `Cannot compare ${describe(value)} to ${describe(bound)} as a ${filter.format}`)
        continue
      }
      if (!test(comparison)) {
        fail(keyword, `Expected ${describe(value)} to be ${description} ${describe(bound)}`)
      }
    }
  }

  for (const [keyword, bound, test, description] of [
    ['minimum', filter.minimum, (c: number) => c >= 0, 'at least'],
    ['maximum', filter.maximum, (c: number) => c <= 0, 'at most'],
    ['exclusiveMinimum', filter.exclusiveMinimum, (c: number) => c > 0, 'greater than'],
    ['exclusiveMaximum', filter.exclusiveMaximum, (c: number) => c < 0, 'less than'],
  ] as const) {
    if (bound === undefined) continue
    const comparison = compareToBound(value, bound, filter.format)
    if (comparison === undefined) continue
    if (!test(comparison)) {
      fail(keyword, `Expected ${describe(value)} to be ${description} ${describe(bound)}`)
    }
  }

  if (Array.isArray(value)) {
    if (filter.minItems !== undefined && value.length < filter.minItems) {
      fail('minItems', `Expected at least ${filter.minItems} items, got ${value.length}`)
    }
    if (filter.maxItems !== undefined && value.length > filter.maxItems) {
      fail('maxItems', `Expected at most ${filter.maxItems} items, got ${value.length}`)
    }

    if (filter.uniqueItems === true) {
      const duplicated = value.some((item, index) => value.slice(index + 1).some((other) => deepEqual(item, other)))
      if (duplicated) fail('uniqueItems', 'Expected all items to be unique')
    }

    if (filter.contains !== undefined) {
      const contains = filter.contains
      if (!value.some((item, index) => runFilter(item, contains, [...path, index]).success)) {
        fail('contains', 'Expected at least one item to match')
      }
    }

    if (filter.items !== undefined) {
      if (Array.isArray(filter.items)) {
        // Tuple form: each schema applies to the item at the same position.
        filter.items.forEach((itemFilter, index) => {
          if (index >= value.length) return
          const result = runFilter(value[index], itemFilter, [...path, index])
          if (!result.success) issues.push(...result.issues)
        })
      } else {
        const itemFilter = filter.items
        value.forEach((item, index) => {
          const result = runFilter(item, itemFilter, [...path, index])
          if (!result.success) issues.push(...result.issues)
        })
      }
    }
  }

  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>

    if (filter.required !== undefined) {
      const missing = filter.required.filter((key) => !Object.hasOwn(object, key))
      if (missing.length > 0) {
        fail('required', `Missing required propert${missing.length === 1 ? 'y' : 'ies'} '${missing.join("', '")}'`)
      }
    }

    if (filter.properties !== undefined) {
      for (const [key, propertyFilter] of Object.entries(filter.properties)) {
        if (!Object.hasOwn(object, key)) continue
        const result = runFilter(object[key], propertyFilter, [...path, key])
        if (!result.success) issues.push(...result.issues)
      }
    }

    if (filter.additionalProperties !== undefined) {
      const declared = new Set(Object.keys(filter.properties ?? {}))
      const additional = Object.keys(object).filter((key) => !declared.has(key))

      if (filter.additionalProperties === false) {
        if (additional.length > 0) {
          fail(
            'additionalProperties',
            `Unexpected propert${additional.length === 1 ? 'y' : 'ies'} '${additional.join("', '")}'`
          )
        }
      } else if (typeof filter.additionalProperties === 'object') {
        const additionalFilter = filter.additionalProperties
        for (const key of additional) {
          const result = runFilter(object[key], additionalFilter, [...path, key])
          if (!result.success) issues.push(...result.issues)
        }
      }
    }
  }

  if (filter.not !== undefined && runFilter(value, filter.not, path).success) {
    fail('not', `Expected ${describe(value)} not to match`)
  }

  if (filter.allOf !== undefined) {
    for (const subFilter of filter.allOf) {
      const result = runFilter(value, subFilter, path)
      if (!result.success) issues.push(...result.issues)
    }
  }

  if (filter.anyOf !== undefined && !filter.anyOf.some((subFilter) => runFilter(value, subFilter, path).success)) {
    fail('anyOf', `Expected ${describe(value)} to match at least one of ${filter.anyOf.length} schemas`)
  }

  if (filter.oneOf !== undefined) {
    const matched = filter.oneOf.filter((subFilter) => runFilter(value, subFilter, path).success).length
    if (matched !== 1) {
      fail(
        'oneOf',
        `Expected ${describe(value)} to match exactly one of ${filter.oneOf.length} schemas, matched ${matched}`
      )
    }
  }

  return issues.length === 0 ? success : { success: false, issues }
}
