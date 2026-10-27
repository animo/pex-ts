import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { arbitraryJson, arbitrarySegments, toJsonPath } from '../fuzz-arbitraries.js'
import { PexJsonPathError } from '../pex-error/e-pex.js'
import { MAX_JSON_PATH_LENGTH, parseJsonPath } from './parse-json-path.js'
import { isPlainObject, queryJsonPath } from './query-json-path.js'
import { stringifyJsonPath } from './stringify-json-path.js'

const pathCharacter = fc.constantFrom(
  ...['$', '.', '[', ']', "'", '"', '\\', '*', '0', '1', '9', 'a', 'Z', '-', '_', '@', '?', '(', ')', ',', ':', ' '],
  ...['\n', '\u0000', 'é', '😀']
)

/** The value at a concrete path, reading own properties only. */
function valueAt(root: unknown, path: Array<string | number>): unknown {
  let value = root
  for (const component of path) {
    if (Array.isArray(value) && typeof component === 'number') value = value[component]
    else if (isPlainObject(value) && typeof component === 'string' && Object.hasOwn(value, component))
      value = value[component]
    else throw new Error(`Path ${JSON.stringify(path)} does not resolve`)
  }
  return value
}

describe('parseJsonPath fuzz', () => {
  it('parses any string or throws a PexJsonPathError', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'binary' }),
          fc.string({ unit: pathCharacter, maxLength: 40 }).map((rest) => `$${rest}`)
        ),
        (path) => {
          try {
            expect(Array.isArray(parseJsonPath(path))).toBe(true)
          } catch (error) {
            expect(error).toBeInstanceOf(PexJsonPathError)
          }
        }
      ),
      { numRuns: 2000 }
    )
  })

  it('reads back the segments a path is written from', () => {
    fc.assert(
      fc.property(arbitrarySegments, (segments) => {
        expect(parseJsonPath(toJsonPath(segments))).toEqual(segments)
      })
    )
  })

  it('parses what stringifyJsonPath writes, for keys without control characters', () => {
    // A control character can only be written escaped (RFC 9535), and the parser supports no such escape
    const key = fc
      .string({ unit: 'grapheme', maxLength: 10 })
      .filter((text) => [...text].every((character) => character.charCodeAt(0) > 0x1f))
    fc.assert(
      fc.property(fc.array(fc.oneof(key, fc.nat({ max: 999_999_999 })), { maxLength: 6 }), (path) => {
        const written = stringifyJsonPath(path)
        fc.pre(written.length <= MAX_JSON_PATH_LENGTH)
        expect(parseJsonPath(written)).toEqual(path)
      })
    )
  })
})

describe('queryJsonPath fuzz', () => {
  it('returns only nodes whose path leads to their value through own properties', () => {
    fc.assert(
      fc.property(arbitraryJson, arbitrarySegments, fc.boolean(), (value, segments, anyArrayIndex) => {
        for (const node of queryJsonPath(value, segments, { anyArrayIndex })) {
          expect(node.path).toHaveLength(segments.length)
          expect(valueAt(value, node.path)).toBe(node.value)

          for (const [index, segment] of segments.entries()) {
            const component = node.path[index]
            if (typeof segment === 'string') expect(component).toBe(segment)
            else if (typeof segment === 'number' && !anyArrayIndex) expect(component).toBe(segment)
            else expect(typeof component).toBe('number')
          }
        }
      })
    )
  })

  it('finds every node the path selects', () => {
    // A brute force walk over every concrete path of the same length
    const expected = (value: unknown, segments: (string | number | null)[], anyArrayIndex: boolean): unknown[] => {
      const [segment, ...rest] = segments
      if (segments.length === 0) return [value]
      if (Array.isArray(value)) {
        if (typeof segment === 'string') return []
        return value.flatMap((element, index) =>
          segment === null || anyArrayIndex || segment === index ? expected(element, rest, anyArrayIndex) : []
        )
      }
      if (!isPlainObject(value) || typeof segment !== 'string' || !Object.hasOwn(value, segment)) return []
      return expected(value[segment], rest, anyArrayIndex)
    }

    fc.assert(
      fc.property(arbitraryJson, arbitrarySegments, fc.boolean(), (value, segments, anyArrayIndex) => {
        const nodes = queryJsonPath(value, segments, { anyArrayIndex })
        expect(nodes.map((node) => node.value)).toEqual(expected(value, segments, anyArrayIndex))
      })
    )
  })
})
