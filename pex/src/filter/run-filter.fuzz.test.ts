import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { arbitraryFilter, arbitraryJson, arbitraryValueFilter } from '../fuzz-arbitraries.js'
import { filterModel, zValueFilter } from './m-filter.js'
import { runFilter } from './run-filter.js'

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const parsedFilter = arbitraryFilter
  .filter((filter) => filterModel.is(filter))
  .map((filter) => filterModel.parse(filter))
const parsedValueFilter = arbitraryValueFilter
  .filter((filter) => zValueFilter.safeParse(filter).success)
  .map((filter) => zValueFilter.parse(filter))

describe('filter fuzz', () => {
  it('parses any input or reports why not, without throwing', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), arbitraryJson, arbitraryFilter), (input) => {
        const result = filterModel.safeParse(input)
        if (!result.success) expect(result.message).not.toBe('')
      }),
      { numRuns: 1000 }
    )
  })

  it('evaluates any value against any filter, with an issue for every failure', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), arbitraryJson), parsedFilter, (value, filter) => {
        const result = runFilter(value, filter)
        if (!result.success) expect(result.issues.length).toBeGreaterThan(0)
      }),
      { numRuns: 1000 }
    )
  })

  it('negates with not', () => {
    fc.assert(
      fc.property(arbitraryJson, parsedValueFilter, (value, filter) => {
        expect(runFilter(value, { not: filter }).success).toBe(!runFilter(value, filter).success)
      })
    )
  })

  it('takes the conjunction of its keywords', () => {
    fc.assert(
      fc.property(arbitraryJson, parsedValueFilter, parsedValueFilter, (value, left, right) => {
        fc.pre(Object.keys(left).every((keyword) => !Object.hasOwn(right, keyword)))
        const merged = filterModel.safeParse({ ...left, ...right })
        fc.pre(merged.success)
        if (!merged.success) return

        expect(runFilter(value, merged.output).success).toBe(
          runFilter(value, left).success && runFilter(value, right).success
        )
      })
    )
  })

  it('applies items to every element and contains to at least one', () => {
    fc.assert(
      fc.property(fc.array(arbitraryJson, { maxLength: 4 }), parsedValueFilter, (array, filter) => {
        const matches = array.map((element) => runFilter(element, filter).success)
        expect(runFilter(array, { type: 'array', items: filter }).success).toBe(matches.every(Boolean))
        expect(runFilter(array, { type: 'array', contains: filter }).success).toBe(matches.some(Boolean))
      })
    )
  })

  it('matches a value by its own type, const and enum', () => {
    fc.assert(
      fc.property(arbitraryJson, (value) => {
        const type = typeOf(value) as 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
        expect(runFilter(value, { type }).success).toBe(true)

        if (typeof value === 'object' && value !== null) return
        expect(runFilter(value, { const: value }).success).toBe(true)
        expect(runFilter(value, { enum: ['other', value] }).success).toBe(true)
      })
    )
  })
})
