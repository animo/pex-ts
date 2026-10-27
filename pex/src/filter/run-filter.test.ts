import { describe, expect, it } from 'vitest'
import type { Filter } from './m-filter.js'
import { runFilter } from './run-filter.js'

const passes = (value: unknown, filter: Filter) => runFilter(value, filter).success

function issueKeywords(value: unknown, filter: Filter): string[] {
  const result = runFilter(value, filter)
  return result.success ? [] : result.issues.map((issue) => issue.keyword)
}

describe('type', () => {
  it('checks each JSON type', () => {
    expect(passes('a', { type: 'string' })).toBe(true)
    expect(passes(1, { type: 'string' })).toBe(false)
    expect(passes(1, { type: 'number' })).toBe(true)
    expect(passes(1.5, { type: 'number' })).toBe(true)
    expect(passes(true, { type: 'boolean' })).toBe(true)
    expect(passes(null, { type: 'null' })).toBe(true)
    expect(passes([], { type: 'array' })).toBe(true)
    expect(passes({}, { type: 'object' })).toBe(true)
    expect(passes([], { type: 'object' })).toBe(false)
    expect(passes(null, { type: 'object' })).toBe(false)
  })

  it('treats every integer as a number but not the converse', () => {
    expect(passes(1, { type: 'integer' })).toBe(true)
    expect(passes(1.5, { type: 'integer' })).toBe(false)
    expect(passes(1, { type: 'number' })).toBe(true)
  })

  it('accepts a list of types', () => {
    expect(passes('a', { type: ['string', 'number'] })).toBe(true)
    expect(passes(1, { type: ['string', 'number'] })).toBe(true)
    expect(passes(true, { type: ['string', 'number'] })).toBe(false)
  })

  it('does not report type-scoped keywords once the type is already wrong', () => {
    expect(issueKeywords(42, { type: 'string', minLength: 5, not: { const: 42 } })).toEqual(['type'])
  })
})

describe('const and enum', () => {
  it('compares strictly', () => {
    expect(passes('a', { const: 'a' })).toBe(true)
    expect(passes('a', { const: 'b' })).toBe(false)
    expect(passes(true, { type: 'boolean', const: true })).toBe(true)
    expect(passes(1, { const: '1' })).toBe(false)
    expect(passes({ a: 1 }, { const: 'a' })).toBe(false)
  })

  it('accepts any enum member', () => {
    expect(passes('eu', { type: 'string', enum: ['eu', 'us', 'uk'] })).toBe(true)
    expect(passes('nl', { type: 'string', enum: ['eu', 'us', 'uk'] })).toBe(false)
  })
})

describe('string keywords', () => {
  it('measures length in code points, not UTF-16 units', () => {
    // '👩‍💻' is several code points but many more UTF-16 units.
    expect(passes('😀😀', { type: 'string', minLength: 2, maxLength: 2 })).toBe(true)
    expect(passes('abc', { type: 'string', maxLength: 2 })).toBe(false)
  })

  it('ignores string keywords for non-strings', () => {
    expect(passes(5, { minLength: 10 })).toBe(true)
  })
})

describe('format', () => {
  it('validates known formats', () => {
    expect(passes('1999-05-16', { type: 'string', format: 'date' })).toBe(true)
    expect(passes('1999-13-16', { type: 'string', format: 'date' })).toBe(false)
    expect(passes('1999-02-29', { type: 'string', format: 'date' })).toBe(false)
    expect(passes('2000-02-29', { type: 'string', format: 'date' })).toBe(true)
    expect(passes('2020-01-01T10:00:00Z', { type: 'string', format: 'date-time' })).toBe(true)
    expect(passes('a@b.com', { type: 'string', format: 'email' })).toBe(true)
    expect(passes('not-an-email', { type: 'string', format: 'email' })).toBe(false)
  })

  it('ignores unknown formats, as JSON Schema specifies', () => {
    expect(passes('anything', { type: 'string', format: 'some-future-format' })).toBe(true)
  })
})

describe('format comparison keywords', () => {
  const dateFilter = (extra: Partial<Filter>): Filter => ({ type: 'string', format: 'date', ...extra })

  it('bounds dates', () => {
    expect(passes('1998-01-01', dateFilter({ formatMaximum: '1999-05-16' }))).toBe(true)
    expect(passes('1999-05-16', dateFilter({ formatMaximum: '1999-05-16' }))).toBe(true)
    expect(passes('2000-01-01', dateFilter({ formatMaximum: '1999-05-16' }))).toBe(false)

    expect(passes('2000-01-01', dateFilter({ formatMinimum: '1999-05-16' }))).toBe(true)
    expect(passes('1998-01-01', dateFilter({ formatMinimum: '1999-05-16' }))).toBe(false)

    expect(passes('1999-05-16', dateFilter({ formatExclusiveMaximum: '1999-05-16' }))).toBe(false)
    expect(passes('1999-05-16', dateFilter({ formatExclusiveMinimum: '1999-05-16' }))).toBe(false)
  })

  it('reports a comparison keyword used without a format', () => {
    expect(issueKeywords('1999-05-16', { type: 'string', formatMaximum: '2000-01-01' })).toEqual(['formatMaximum'])
  })

  it('fails a value that is not a string, as a bound that cannot apply', () => {
    for (const value of [0, true, null, {}, []]) {
      expect(issueKeywords(value, { format: 'date', formatMaximum: '2008-01-01' })).toEqual(['formatMaximum'])
    }
  })

  it('compares date-times as instants, across timezone offsets', () => {
    const filter: Filter = { type: 'string', format: 'date-time', formatMaximum: '2020-01-01T12:00:00Z' }
    expect(passes('2020-01-01T13:00:00+02:00', filter)).toBe(true) // 11:00Z
    expect(passes('2020-01-01T13:00:00Z', filter)).toBe(false)
  })
})

describe('numeric bounds', () => {
  it('bounds numbers', () => {
    expect(passes(18, { type: 'integer', minimum: 18 })).toBe(true)
    expect(passes(17, { type: 'integer', minimum: 18 })).toBe(false)
    expect(passes(85, { type: 'number', exclusiveMaximum: 85 })).toBe(false)
    expect(passes(84, { type: 'number', exclusiveMaximum: 85 })).toBe(true)
    expect(passes(65536, { type: 'number', maximum: 65536 })).toBe(true)
    expect(passes(10001, { type: 'number', exclusiveMinimum: 10000 })).toBe(true)
  })

  it('applies a string bound to a string value rather than dropping the assertion', () => {
    // ajv ignores `minimum` for a string instance, so this shape — which the spec's own examples
    // use — asserted nothing at all in the previous implementation.
    const filter: Filter = { type: 'string', format: 'date', minimum: '1999-05-16' }
    expect(passes('2000-01-01', filter)).toBe(true)
    expect(passes('1998-01-01', filter)).toBe(false)
  })

  it('falls back to lexical ordering for strings without an ordered format', () => {
    expect(passes('b', { type: 'string', minimum: 'a' })).toBe(true)
    expect(passes('a', { type: 'string', exclusiveMinimum: 'a' })).toBe(false)
  })

  it('ignores a numeric bound for a non-number, as JSON Schema does', () => {
    expect(passes('abc', { minimum: 5 })).toBe(true)
  })

  it('fails a string bound it cannot compare, rather than dropping it', () => {
    expect(passes(16, { minimum: '18' })).toBe(false)
    expect(passes('not-a-date', { format: 'date', minimum: '2000-01-01' })).toBe(false)
  })
})

describe('array keywords', () => {
  it('applies contains to at least one element', () => {
    const filter: Filter = { type: 'array', contains: { const: 'PermanentResidentCard' } }
    expect(passes(['VerifiableCredential', 'PermanentResidentCard'], filter)).toBe(true)
    expect(passes(['VerifiableCredential'], filter)).toBe(false)
    expect(passes([], filter)).toBe(false)
  })

  it('applies items to every element', () => {
    expect(passes(['a', 'b'], { type: 'array', items: { type: 'string' } })).toBe(true)
    expect(passes(['a', 1], { type: 'array', items: { type: 'string' } })).toBe(false)
    expect(passes([], { type: 'array', items: { type: 'string' } })).toBe(true)
  })

  it('reads a credential type array the way verifiers write it', () => {
    const filter: Filter = { type: 'array', items: { type: 'string' }, contains: { const: 'OpenBadgeCredential' } }
    expect(passes(['VerifiableCredential', 'OpenBadgeCredential'], filter)).toBe(true)
    expect(passes(['VerifiableCredential'], filter)).toBe(false)
  })
})

describe('not', () => {
  it('negates a sub-filter', () => {
    expect(passes('Karen', { type: 'string', not: { const: 'Karen' } })).toBe(false)
    expect(passes('Sam', { type: 'string', not: { const: 'Karen' } })).toBe(true)
    expect(passes('red', { type: 'string', not: { enum: ['red', 'yellow', 'blue'] } })).toBe(false)
  })
})

describe('issue reporting', () => {
  it('reports every failing keyword, not just the first', () => {
    expect(issueKeywords('ab', { type: 'string', minLength: 5, format: 'date' }).sort()).toEqual([
      'format',
      'minLength',
    ])
  })

  it('locates failures inside an array', () => {
    const result = runFilter(['a', 1], { type: 'array', items: { type: 'string' } })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.issues[0]?.path).toEqual([1])
    expect(result.issues[0]?.message).toContain('$[1]')
  })

  it('an empty filter matches anything', () => {
    expect(passes('a', {})).toBe(true)
    expect(passes(null, {})).toBe(true)
    expect(passes(undefined, {})).toBe(true)
  })
})

describe('fixed edge cases', () => {
  it('requires a date-time to have an offset, so it is an instant', () => {
    expect(passes('2020-01-01T10:00:00', { type: 'string', format: 'date-time' })).toBe(false)
    expect(
      passes('2020-01-01T10:00:00+01:00', {
        type: 'string',
        format: 'date-time',
        formatMinimum: '2020-01-01T09:30:00Z',
      })
    ).toBe(false)
  })

  it('orders a leap second and a year below 100', () => {
    expect(
      passes('2016-12-31T23:59:60Z', { type: 'string', format: 'date-time', formatMinimum: '2016-12-31T23:59:59Z' })
    ).toBe(true)
    expect(passes('0050-01-01', { type: 'string', format: 'date', formatMaximum: '1900-01-01' })).toBe(true)
  })

  it('compares times in UTC when both have an offset, and refuses to mix', () => {
    expect(passes('10:00:00+05:00', { type: 'string', format: 'time', formatMaximum: '06:00:00Z' })).toBe(true)
    expect(passes('10:00:00', { type: 'string', format: 'time', formatMaximum: '06:00:00Z' })).toBe(false)
  })

  it('gives values that are not JSON no type', () => {
    expect(passes(new Uint8Array(1), { type: 'object' })).toBe(false)
    expect(passes(Number.NaN, { type: 'number' })).toBe(false)
  })

  it('does not recurse into a value, however deep it nests', () => {
    let deep: unknown = 'leaf'
    for (let depth = 0; depth < 100_000; depth++) deep = [deep]
    expect(passes(deep, { type: 'array', items: { type: 'array' } })).toBe(true)
    expect(passes([deep, deep], { type: 'array', contains: { type: 'string' } })).toBe(false)
  })
})
