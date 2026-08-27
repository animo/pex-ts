import { PexJsonPathError } from '../pex-error/e-pex.js'
import type { JsonPathSegment } from './m-json-path.js'

/**
 * Digits are allowed to start a name: real definitions address numeric-keyed objects in dot
 * notation, e.g. the Funke SD-JWT definitions' `$.age_equal_or_over.18`. There is no ambiguity
 * with array indices, which are always bracketed.
 */
const NAME_START = /[A-Za-z0-9_@$]/
const NAME_CHAR = /[A-Za-z0-9_@$-]/

/**
 * Parse a JSONPath into the subset of segments this library supports.
 *
 * Throws {@link PexJsonPathError} for any construct outside the subset. Presentation definitions
 * are parsed up front, so an unsupported path surfaces when the definition is read rather than
 * as a mysterious "no credential matched" later on.
 */
export function parseJsonPath(path: string): JsonPathSegment[] {
  if (typeof path !== 'string') {
    throw new PexJsonPathError({ path: String(path), message: 'Path must be a string' })
  }

  if (path.length === 0) {
    throw new PexJsonPathError({ path, message: 'Path must not be empty' })
  }

  if (path[0] !== '$') {
    throw new PexJsonPathError({ path, message: `Path must start with '$', got '${path[0]}'` })
  }

  const segments: JsonPathSegment[] = []
  let cursor = 1

  const fail = (message: string): never => {
    throw new PexJsonPathError({ path, message: `${message} at position ${cursor} of '${path}'` })
  }

  const readName = (): string => {
    const start = cursor
    const first = path[cursor]
    if (first === undefined || !NAME_START.test(first)) {
      return fail(
        first === undefined
          ? 'Expected a property name'
          : `Expected a property name to start with a letter, digit, '_', '@' or '$', got '${first}'`
      )
    }
    cursor++
    while (cursor < path.length) {
      const char = path[cursor]
      if (char === undefined || !NAME_CHAR.test(char)) break
      cursor++
    }
    return path.slice(start, cursor)
  }

  /** Reads a `'...'` or `"..."` string, assuming the cursor sits on the opening quote. */
  const readQuoted = (): string => {
    const quote = path[cursor]
    if (quote !== "'" && quote !== '"') return fail('Expected a quoted property name')
    cursor++

    let value = ''
    while (cursor < path.length) {
      const char = path[cursor]
      if (char === '\\') {
        const escaped = path[cursor + 1]
        if (escaped === undefined) return fail('Unterminated escape sequence')
        value += escaped
        cursor += 2
        continue
      }
      if (char === quote) {
        cursor++
        return value
      }
      value += char
      cursor++
    }

    return fail(`Unterminated quoted property name, expected a closing ${quote}`)
  }

  const expect = (char: string) => {
    if (path[cursor] !== char) {
      return fail(`Expected '${char}', got ${path[cursor] === undefined ? 'end of path' : `'${path[cursor]}'`}`)
    }
    cursor++
  }

  while (cursor < path.length) {
    const char = path[cursor]

    if (char === '.') {
      // `..` — recursive descent
      if (path[cursor + 1] === '.') {
        cursor += 2
        if (path[cursor] === '[') {
          cursor++
          const key = readQuoted()
          expect(']')
          segments.push({ type: 'descendant', key })
          continue
        }
        if (path[cursor] === '*' || path[cursor] === undefined) {
          // `$..` and `$..*` mean "every descendant", which has no use in a presentation
          // definition and makes match semantics unpredictable.
          return fail('Recursive descent must be followed by a property name, e.g. "$..[\'@context\']"')
        }
        segments.push({ type: 'descendant', key: readName() })
        continue
      }

      cursor++
      if (path[cursor] === '*') {
        cursor++
        segments.push({ type: 'wildcard' })
        continue
      }
      segments.push({ type: 'key', key: readName() })
      continue
    }

    if (char === '[') {
      cursor++
      const next = path[cursor]

      if (next === '*') {
        cursor++
        expect(']')
        segments.push({ type: 'wildcard' })
        continue
      }

      if (next === "'" || next === '"') {
        const key = readQuoted()
        expect(']')
        segments.push({ type: 'key', key })
        continue
      }

      if (next !== undefined && next >= '0' && next <= '9') {
        const start = cursor
        while (cursor < path.length) {
          const digit = path[cursor]
          if (digit === undefined || digit < '0' || digit > '9') break
          cursor++
        }
        const raw = path.slice(start, cursor)

        // `[1:3]` and `[0,1]` land here — they start with a digit but are not a bare index.
        if (path[cursor] === ':') return fail('Array slices are not supported')
        if (path[cursor] === ',') return fail('Union expressions are not supported')
        expect(']')

        const index = Number(raw)
        if (!Number.isSafeInteger(index)) return fail(`Array index '${raw}' is out of range`)
        segments.push({ type: 'index', index })
        continue
      }

      if (next === '?') return fail('Filter expressions are not supported')
      if (next === '(') return fail('Script expressions are not supported')
      if (next === '-') return fail('Negative array indices are not supported')
      if (next === ':') return fail('Array slices are not supported')

      return fail(
        `Expected a quoted property name, an array index or '*', got ${next === undefined ? 'end of path' : `'${next}'`}`
      )
    }

    return fail(`Expected '.' or '[', got '${char}'`)
  }

  return segments
}

/**
 * Whether a path is expressible in the supported subset. Does not throw.
 */
export function isSupportedJsonPath(path: string): boolean {
  try {
    parseJsonPath(path)
    return true
  } catch {
    return false
  }
}
