import { PexJsonPathError } from '../pex-error/e-pex.js'
import type { JsonPathSegment } from './m-json-path.js'

/**
 * One segment, matched at the cursor (`y` flag): `.name`, `['name']`, `["name"]`, `[0]`, `[*]` or `.*`.
 *
 * A name in dot notation is letters, digits, `_` and `-`. It may start with a digit: real definitions
 * address numeric-keyed objects that way, e.g. the Funke SD-JWT definitions' `$.age_equal_or_over.18`.
 * There is no ambiguity with array indices, which are always bracketed. Any other key is quoted.
 *
 * In a quoted name the only escapes are the enclosing quote and `\\`. RFC 9535 also defines `\b`, `\f`,
 * `\n`, `\r`, `\t`, `\/` and `\uXXXX`, which no definition needs, so a path using them is rejected
 * rather than read differently than the RFC means it. Control characters are rejected too: RFC 9535 only
 * allows them escaped.
 *
 * Every repetition matches a single character or a two-character escape, and the two never overlap, so
 * matching takes linear time whatever the input.
 */
const SEGMENT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: quoted names must not contain raw control characters
  /\.([A-Za-z0-9_-]+)|\['((?:[^'\\\x00-\x1f]|\\['\\])*)'\]|\["((?:[^"\\\x00-\x1f]|\\["\\])*)"\]|\[(0|[1-9][0-9]{0,8})\]|\[\*\]|\.\*/y

/**
 * The longest path accepted. Real paths are well under a hundred characters. The cap keeps the input
 * to the regex small: V8 matches a long enough quoted key by recursion and overflows the stack, at
 * about 10 MB.
 */
export const MAX_JSON_PATH_LENGTH = 1024

/** The path as quoted in an error message, shortened so a huge path doesn't make a huge message. */
function quote(path: string): string {
  return `'${path.length > 100 ? `${path.slice(0, 100)}…` : path}'`
}

/**
 * Explains why the path is not supported at the cursor. The constructs a general JSONPath implementation
 * evaluates or searches with are named, as a definition using one is most likely to have been written
 * for such an implementation. Anything else gets the list of what is supported.
 */
function describeUnsupported(rest: string): string {
  if (rest.startsWith('..')) return 'Recursive descent (..) is not supported'
  if (rest.startsWith('[?')) return 'Filter expressions are not supported'
  if (rest.startsWith('[(')) return 'Script expressions are not supported'
  if (rest.startsWith("['") || rest.startsWith('["')) return describeQuotedName(rest)
  return `Expected '.name', "['name']", '["name"]', '[index]', '[*]' or '.*', got ${quote(rest.slice(0, 10))}`
}

/** Explains why a quoted name at the start of `rest` is not supported. */
function describeQuotedName(rest: string): string {
  const quoteCharacter = rest[1]
  for (let index = 2; index < rest.length; index++) {
    const character = rest[index] as string
    if (character === quoteCharacter)
      return `Expected ']' after the quoted name, got ${quote(rest.slice(index + 1, index + 11))}`
    if (character.charCodeAt(0) <= 0x1f) return 'Control characters are not allowed in a quoted name'
    if (character === '\\') {
      const escaped = rest[index + 1]
      if (escaped !== quoteCharacter && escaped !== '\\') {
        return `Unsupported escape '\\${escaped ?? ''}' in a quoted name; only \\${quoteCharacter} and \\\\ are supported`
      }
      index++
    }
  }
  return 'Unterminated quoted name'
}

/**
 * Parse a JSONPath into the subset of segments this library supports.
 *
 * Throws {@link PexJsonPathError} for any construct outside the subset. Presentation definitions
 * are parsed up front, so an unsupported path surfaces when the definition is read rather than
 * as a mysterious "no credential matched" later on.
 */
export function parseJsonPath(path: string): JsonPathSegment[] {
  if (typeof path !== 'string' || !path.startsWith('$')) {
    throw new PexJsonPathError({ path: String(path), message: `Path must start with '$': ${quote(String(path))}` })
  }
  if (path.length > MAX_JSON_PATH_LENGTH) {
    throw new PexJsonPathError({
      path,
      message: `Path is longer than ${MAX_JSON_PATH_LENGTH} characters: ${quote(path)}`,
    })
  }

  const segments: JsonPathSegment[] = []
  SEGMENT.lastIndex = 1

  while (SEGMENT.lastIndex < path.length) {
    const cursor = SEGMENT.lastIndex
    const match = SEGMENT.exec(path)
    if (!match) {
      throw new PexJsonPathError({
        path,
        message: `${describeUnsupported(path.slice(cursor))} at position ${cursor} of ${quote(path)}`,
      })
    }

    const [, name, singleQuoted, doubleQuoted, index] = match
    const quoted = singleQuoted ?? doubleQuoted
    if (name !== undefined) segments.push(name)
    else if (quoted !== undefined) segments.push(quoted.replace(/\\(.)/g, '$1'))
    else if (index !== undefined) segments.push(Number(index))
    else segments.push(null)
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
