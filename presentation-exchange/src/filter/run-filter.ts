import type { PathComponent } from '../json-path/m-json-path.js'
import { isPlainObject } from '../json-path/query-json-path.js'
import { stringifyJsonPath } from '../json-path/stringify-json-path.js'
import { checkFormat, compareFormat, isComparableFormat } from './formats.js'
import type { Filter, FilterType, ValueFilter } from './m-filter.js'

export interface FilterIssue {
  /** The keyword that failed. */
  keyword: string
  message: string
  /** Where inside the filtered value the failure is: the index of an element for `items` and `contains`. Empty at the root. */
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

/**
 * The JSON type of a value. Values that are not JSON — an mdoc's byte strings and dates, `NaN` — have no
 * type, so no `type` keyword admits them.
 */
function typeOf(value: unknown): FilterType | undefined {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return Number.isInteger(value) ? 'integer' : 'number'
  }
  if (isPlainObject(value)) return 'object'
  return undefined
}

function matchesType(value: unknown, expected: FilterType): boolean {
  const actual = typeOf(value)
  if (actual === undefined) return false
  // Every integer is also a number; the converse does not hold.
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  return actual === expected
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
 * ordering for ISO 8601.
 *
 * Returns `'not-applicable'` for a numeric bound and a non-number, which JSON Schema ignores the same
 * way it ignores `minLength` for a number. A string bound that can't be compared with the value — a
 * number, or a string that is not valid for the ordered format — returns `'incomparable'`, which fails:
 * ignoring the bound would widen what matches.
 */
function compareToBound(
  value: unknown,
  bound: number | string,
  format: string | undefined
): number | 'not-applicable' | 'incomparable' {
  if (typeof bound === 'number') return typeof value === 'number' ? value - bound : 'not-applicable'
  if (typeof value !== 'string') return 'incomparable'

  if (format !== undefined && isComparableFormat(format)) {
    return compareFormat(format, value, bound) ?? 'incomparable'
  }
  return value === bound ? 0 : value < bound ? -1 : 1
}

/**
 * Evaluate the value keywords of a filter against a value. Every failing keyword is reported, not just
 * the first, so a wallet can explain everything a credential got wrong in one pass — except after a
 * `type` failure, as every other keyword is type-scoped and reporting them would only add noise.
 */
function runValueFilter(value: unknown, filter: ValueFilter, path: PathComponent[]): FilterIssue[] {
  const issues: FilterIssue[] = []
  const at = path.length === 0 ? '' : ` at ${stringifyJsonPath(path)}`

  const fail = (keyword: string, message: string) => {
    issues.push({ keyword, message: `${message}${at}`, path })
  }

  if (filter.type !== undefined) {
    const expected = Array.isArray(filter.type) ? filter.type : [filter.type]
    if (!expected.some((type) => matchesType(value, type))) {
      fail('type', `Expected ${expected.join(' or ')}, got ${describe(value)}`)
      return issues
    }
  }

  // `const` and `enum` are scalars, so nothing that is not a primitive ever equals them
  if (filter.const !== undefined && value !== filter.const) {
    fail('const', `Expected ${describe(filter.const)}, got ${describe(value)}`)
  }

  if (filter.enum !== undefined && !filter.enum.some((candidate) => value === candidate)) {
    fail('enum', `Expected one of ${filter.enum.map(describe).join(', ')}, got ${describe(value)}`)
  }

  if (typeof value === 'string') {
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
  }

  // A `format*` bound is a bound like `minimum`: one the value can't be compared with — a value that is not a
  // string, or not valid for the format — fails rather than being skipped, which would widen what matches.
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
    const comparison = typeof value === 'string' ? compareFormat(filter.format, value, bound) : undefined
    if (comparison === undefined) {
      fail(keyword, `Cannot compare ${describe(value)} to ${describe(bound)} as a ${filter.format}`)
      continue
    }
    if (!test(comparison)) {
      fail(keyword, `Expected ${describe(value)} to be ${description} ${describe(bound)}`)
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
    if (comparison === 'not-applicable') continue
    if (comparison === 'incomparable') {
      fail(
        keyword,
        `Cannot compare ${describe(value)} to ${describe(bound)}${filter.format ? ` as a ${filter.format}` : ''}`
      )
      continue
    }
    if (!test(comparison)) {
      fail(keyword, `Expected ${describe(value)} to be ${description} ${describe(bound)}`)
    }
  }

  return issues
}

/**
 * Evaluate a filter against a value.
 *
 * The value keywords are evaluated on the value itself, `not` negates a sub-filter on it, and for an array
 * `items` applies a sub-filter to every element and `contains` to at least one. A sub-filter is made of the
 * value keywords, so recursion ends there, and the cost is bounded by the size of the value.
 */
export function runFilter(value: unknown, filter: Filter, path: PathComponent[] = []): FilterResult {
  const issues = runValueFilter(value, filter, path)
  // The remaining keywords are scoped to the type too
  if (issues.some((issue) => issue.keyword === 'type')) return { success: false, issues }

  const at = path.length === 0 ? '' : ` at ${stringifyJsonPath(path)}`

  if (filter.not !== undefined && runValueFilter(value, filter.not, path).length === 0) {
    issues.push({ keyword: 'not', message: `Expected ${describe(value)} not to match${at}`, path })
  }

  if (Array.isArray(value)) {
    const { items, contains } = filter

    if (items !== undefined) {
      for (const [index, element] of value.entries()) issues.push(...runValueFilter(element, items, [...path, index]))
    }

    if (
      contains !== undefined &&
      !value.some((element, index) => runValueFilter(element, contains, [...path, index]).length === 0)
    ) {
      issues.push({ keyword: 'contains', message: `Expected at least one element to match${at}`, path })
    }
  }

  return issues.length === 0 ? success : { success: false, issues }
}
