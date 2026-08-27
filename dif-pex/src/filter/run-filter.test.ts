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
    expect(issueKeywords(42, { type: 'string', minLength: 5, pattern: '^a' })).toEqual(['type'])
  })
})

describe('const and enum', () => {
  it('compares strictly', () => {
    expect(passes('a', { const: 'a' })).toBe(true)
    expect(passes('a', { const: 'b' })).toBe(false)
    expect(passes(true, { type: 'boolean', const: true })).toBe(true)
    expect(passes(1, { const: '1' })).toBe(false)
  })

  it('accepts any enum member', () => {
    expect(passes('eu', { type: 'string', enum: ['eu', 'us', 'uk'] })).toBe(true)
    expect(passes('nl', { type: 'string', enum: ['eu', 'us', 'uk'] })).toBe(false)
  })
})

describe('string keywords', () => {
  it('applies pattern', () => {
    expect(passes('did:example:123', { type: 'string', pattern: 'did:example:123|did:example:456' })).toBe(true)
    expect(passes('did:other:1', { type: 'string', pattern: 'did:example:123|did:example:456' })).toBe(false)
  })

  it('measures length in code points, not UTF-16 units', () => {
    // '👩‍💻' is several code points but many more UTF-16 units.
    expect(passes('😀😀', { type: 'string', minLength: 2, maxLength: 2 })).toBe(true)
    expect(passes('abc', { type: 'string', maxLength: 2 })).toBe(false)
  })

  it('ignores string keywords for non-strings', () => {
    expect(passes(5, { minLength: 10 })).toBe(true)
    expect(passes(5, { pattern: '^a$' })).toBe(true)
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

  it('ignores a bound whose type does not match the instance', () => {
    expect(passes('abc', { minimum: 5 })).toBe(true)
    expect(passes(5, { minimum: 'abc' })).toBe(true)
  })
})

describe('array keywords', () => {
  it('bounds item counts and uniqueness', () => {
    expect(passes([1, 2], { type: 'array', minItems: 2, maxItems: 3 })).toBe(true)
    expect(passes([1], { type: 'array', minItems: 2 })).toBe(false)
    expect(passes([1, 1], { type: 'array', uniqueItems: true })).toBe(false)
    expect(passes([1, 2], { type: 'array', uniqueItems: true })).toBe(true)
    expect(passes([{ a: 1 }, { a: 1 }], { type: 'array', uniqueItems: true })).toBe(false)
  })

  it('applies contains to any single item', () => {
    const filter: Filter = { type: 'array', contains: { const: 'PermanentResidentCard' } }
    expect(passes(['VerifiableCredential', 'PermanentResidentCard'], filter)).toBe(true)
    expect(passes(['VerifiableCredential'], filter)).toBe(false)
  })

  it('applies items to every element', () => {
    expect(passes(['a', 'b'], { type: 'array', items: { type: 'string' } })).toBe(true)
    expect(passes(['a', 1], { type: 'array', items: { type: 'string' } })).toBe(false)
  })

  it('applies tuple items positionally', () => {
    const filter: Filter = { type: 'array', items: [{ type: 'string' }, { type: 'number' }] }
    expect(passes(['a', 1], filter)).toBe(true)
    expect(passes([1, 'a'], filter)).toBe(false)
    expect(passes(['a'], filter)).toBe(true)
  })
})

describe('object keywords', () => {
  it('checks required properties', () => {
    expect(passes({ a: 1 }, { type: 'object', required: ['a'] })).toBe(true)
    expect(passes({ a: 1 }, { type: 'object', required: ['a', 'b'] })).toBe(false)
  })

  it('applies property schemas only to present properties', () => {
    const filter: Filter = { type: 'object', properties: { a: { type: 'string' } } }
    expect(passes({ a: 'x' }, filter)).toBe(true)
    expect(passes({ a: 1 }, filter)).toBe(false)
    expect(passes({}, filter)).toBe(true)
  })

  it('restricts additional properties', () => {
    const filter: Filter = { type: 'object', properties: { a: {} }, additionalProperties: false }
    expect(passes({ a: 1 }, filter)).toBe(true)
    expect(passes({ a: 1, b: 2 }, filter)).toBe(false)
  })
})

describe('composition', () => {
  it('negates with not', () => {
    expect(passes('Karen', { type: 'string', not: { const: 'Karen' } })).toBe(false)
    expect(passes('Sam', { type: 'string', not: { const: 'Karen' } })).toBe(true)
  })

  it('requires every allOf branch', () => {
    expect(passes('abc', { allOf: [{ type: 'string' }, { minLength: 2 }] })).toBe(true)
    expect(passes('a', { allOf: [{ type: 'string' }, { minLength: 2 }] })).toBe(false)
  })

  it('requires at least one anyOf branch', () => {
    expect(passes(1, { anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe(true)
    expect(passes(true, { anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe(false)
  })

  it('requires exactly one oneOf branch', () => {
    expect(passes(1, { oneOf: [{ type: 'number' }, { type: 'string' }] })).toBe(true)
    expect(passes(1, { oneOf: [{ type: 'number' }, { type: 'integer' }] })).toBe(false)
  })
})

describe('issue reporting', () => {
  it('reports every failing keyword, not just the first', () => {
    expect(issueKeywords('ab', { type: 'string', minLength: 5, pattern: '^z' }).sort()).toEqual([
      'minLength',
      'pattern',
    ])
  })

  it('locates failures inside nested values', () => {
    const result = runFilter({ a: { b: 1 } }, { properties: { a: { properties: { b: { type: 'string' } } } } })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.issues[0]?.path).toEqual(['a', 'b'])
    expect(result.issues[0]?.message).toContain("$['a']['b']")
  })

  it('an empty filter matches anything', () => {
    expect(passes('a', {})).toBe(true)
    expect(passes(null, {})).toBe(true)
    expect(passes(undefined, {})).toBe(true)
  })
})
