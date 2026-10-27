import { describe, expect, it } from 'vitest'
import { PexJsonPathError } from '../pex-error/e-pex.js'
import { parseJsonPath } from './parse-json-path.js'
import { queryJsonPath, queryJsonPathString } from './query-json-path.js'
import { stringifyJsonPath } from './stringify-json-path.js'

describe('parseJsonPath', () => {
  it('parses the forms that appear in real presentation definitions', () => {
    expect(parseJsonPath('$.issuer')).toEqual(['issuer'])
    expect(parseJsonPath('$.vc.credentialSubject.birth_date')).toEqual(['vc', 'credentialSubject', 'birth_date'])
    expect(parseJsonPath("$['org.iso.18013.5.1']['family_name']")).toEqual(['org.iso.18013.5.1', 'family_name'])
    expect(parseJsonPath('$.verifiableCredential[2]')).toEqual(['verifiableCredential', 2])
    expect(parseJsonPath('$.account[*].id')).toEqual(['account', null, 'id'])
    expect(parseJsonPath('$.type.*')).toEqual(['type', null])
    expect(parseJsonPath('$.age_equal_or_over.18')).toEqual(['age_equal_or_over', '18'])
    expect(parseJsonPath('$')).toEqual([])
    expect(parseJsonPath('$[0]')).toEqual([0])
  })

  it('accepts letters, digits, _ and - in dot notation, and anything quoted', () => {
    expect(parseJsonPath('$.given-name_2')).toEqual(['given-name_2'])
    expect(parseJsonPath("$['@context']")).toEqual(['@context'])
    expect(parseJsonPath('$["@context"]["it\\"s"]')).toEqual(['@context', 'it"s'])
    expect(parseJsonPath("$['it\\'s']")).toEqual(["it's"])
    expect(parseJsonPath("$['a.b[*]']")).toEqual(['a.b[*]'])
  })

  it('accepts only the enclosing quote and a backslash as escapes', () => {
    expect(parseJsonPath("$['it\\'s \\\\ ok']")).toEqual(["it's \\ ok"])
    expect(parseJsonPath('$["say \\"hi\\" \\\\ ok"]')).toEqual(['say "hi" \\ ok'])
    // The other quote needs no escape
    expect(parseJsonPath(`$['say "hi"']`)).toEqual(['say "hi"'])
    expect(parseJsonPath(`$["it's"]`)).toEqual(["it's"])
  })

  it.each([
    ["$['line\\nbreak']", "Unsupported escape '\\n'"],
    ["$['caf\\u00e9']", "Unsupported escape '\\u'"],
    ["$['a\\/b']", "Unsupported escape '\\/'"],
    ["$['\\x']", "Unsupported escape '\\x'"],
    ['$["it\\\'s"]', "Unsupported escape '\\''"],
    ['$[\'say \\"hi\\"\']', "Unsupported escape '\\\"'"],
    ["$['line\nbreak']", 'Control characters are not allowed'],
    ["$['unterminated", 'Unterminated quoted name'],
    ["$['a'b", "Expected ']' after the quoted name"],
  ])('rejects the quoted name in %j', (path, message) => {
    expect(() => parseJsonPath(path)).toThrow(PexJsonPathError)
    expect(() => parseJsonPath(path)).toThrow(message)
  })

  it('accepts a path up to the maximum length', () => {
    expect(parseJsonPath(`$${'.a'.repeat(511)}`)).toHaveLength(511)
    expect(parseJsonPath(`$['${"\\'".repeat(500)}']`)).toEqual(["'".repeat(500)])
  })

  it.each([`$${'.a'.repeat(10_000)}`, `$['${'a'.repeat(10_000_000)}']`, `$['${'a'.repeat(10_000_000)}`])(
    'rejects a path longer than the maximum, with a short message',
    (path) => {
      expect(() => parseJsonPath(path)).toThrow(PexJsonPathError)
      expect(() => parseJsonPath(path)).toThrow(/^Path is longer than 1024 characters: '.{100}…'$/)
    }
  )

  it('rejects an array index too large to address an element', () => {
    expect(() => parseJsonPath('$[1000000000]')).toThrow(PexJsonPathError)
    expect(parseJsonPath('$[999999999]')).toEqual([999_999_999])
  })

  it.each([
    ['$.a[?(@.b == 1)]', 'Filter expressions are not supported'],
    ["$['@book'].accessModeSufficient[(@.length-1)]", 'Script expressions are not supported'],
    ['$.a[1:3]', "Expected '.name'"],
    ['$.a[0,1]', "Expected '.name'"],
    ['$.a[-1]', "Expected '.name'"],
    ['$.@context', "Expected '.name'"],
    ['$..', 'Recursive descent (..) is not supported'],
    ['$..name', 'Recursive descent (..) is not supported'],
    ["$.vc..['@context']", 'Recursive descent (..) is not supported'],
  ])('rejects %s', (path, message) => {
    expect(() => parseJsonPath(path)).toThrow(PexJsonPathError)
    expect(() => parseJsonPath(path)).toThrow(message)
  })

  it.each(['', 'issuer', '.issuer', '$issuer', '$.', '$[', "$['unterminated", '$.a]', '$[]'])(
    'rejects malformed path %s',
    (path) => {
      expect(() => parseJsonPath(path)).toThrow(PexJsonPathError)
    }
  )

  it('reports the offending path on the error', () => {
    try {
      parseJsonPath('$.a[?(@.b)]')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(PexJsonPathError)
      expect((error as PexJsonPathError).path).toBe('$.a[?(@.b)]')
    }
  })
})

describe('queryJsonPath', () => {
  const credential = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    issuer: 'did:example:123',
    type: ['VerifiableCredential', 'PermanentResidentCard'],
    credentialSubject: {
      birth_date: '1990-01-01',
      account: [
        { id: 'a', route: 'r1' },
        { id: 'b', route: 'r2' },
      ],
      address: { locality: 'Utrecht' },
    },
  }

  it('resolves keys, indices and wildcards', () => {
    expect(queryJsonPathString(credential, '$.issuer')).toEqual([{ value: 'did:example:123', path: ['issuer'] }])

    expect(queryJsonPathString(credential, '$.credentialSubject.account[*].id')).toEqual([
      { value: 'a', path: ['credentialSubject', 'account', 0, 'id'] },
      { value: 'b', path: ['credentialSubject', 'account', 1, 'id'] },
    ])

    expect(queryJsonPathString(credential, '$.type[1]')).toEqual([
      { value: 'PermanentResidentCard', path: ['type', 1] },
    ])

    expect(queryJsonPathString(credential, '$.type.*')).toEqual([
      { value: 'VerifiableCredential', path: ['type', 0] },
      { value: 'PermanentResidentCard', path: ['type', 1] },
    ])
  })

  it('applies a wildcard to array elements only, as DCQL does', () => {
    // A definition asks for the whole object with `$.credentialSubject.address`
    expect(queryJsonPathString(credential, '$.credentialSubject.address.*')).toEqual([])
    expect(queryJsonPathString(credential, '$.credentialSubject.address')).toEqual([
      { value: { locality: 'Utrecht' }, path: ['credentialSubject', 'address'] },
    ])
  })

  it('returns an empty array when nothing matches', () => {
    expect(queryJsonPathString(credential, '$.nonexistent')).toEqual([])
    expect(queryJsonPathString(credential, '$.type[99]')).toEqual([])
    expect(queryJsonPathString(credential, '$.issuer.nested')).toEqual([])
  })

  it('does not resolve string keys against arrays', () => {
    expect(queryJsonPathString({ a: [1, 2] }, '$.a.length')).toEqual([])
  })

  it('does not resolve inherited properties', () => {
    expect(queryJsonPathString({ a: 1 }, '$.toString')).toEqual([])
    expect(queryJsonPathString({ a: 1 }, '$.constructor')).toEqual([])
  })

  it('distinguishes a present undefined value from a missing key', () => {
    expect(queryJsonPathString({ a: undefined }, '$.a')).toEqual([{ value: undefined, path: ['a'] }])
    expect(queryJsonPathString({}, '$.a')).toEqual([])
  })

  it('reads only own properties, so prototype keys resolve nothing', () => {
    for (const path of ['$.__proto__', "$['__proto__']", '$.constructor.prototype', '$.hasOwnProperty']) {
      expect(queryJsonPathString({ a: 1 }, path)).toEqual([])
    }

    // JSON.parse makes `__proto__` an own property, which is then an ordinary claim
    const parsed = JSON.parse('{"__proto__": {"x": 1}}')
    expect(queryJsonPathString(parsed, "$['__proto__'].x")).toEqual([{ value: 1, path: ['__proto__', 'x'] }])
  })

  it('does work bounded by the size of the input, however deeply it nests', () => {
    let deep: unknown = 'found'
    for (let i = 0; i < 50_000; i++) deep = [deep]

    expect(queryJsonPathString(deep, '$.*.*.*')).toHaveLength(1)
  })

  it('reuses parsed segments across values', () => {
    const segments = parseJsonPath('$.issuer')
    expect(queryJsonPath({ issuer: 'a' }, segments)).toEqual([{ value: 'a', path: ['issuer'] }])
    expect(queryJsonPath({ issuer: 'b' }, segments)).toEqual([{ value: 'b', path: ['issuer'] }])
  })
})

describe('stringifyJsonPath', () => {
  it('always renders bracket form', () => {
    expect(stringifyJsonPath(['credentialSubject', 'account', 0, 'id'])).toBe(
      "$['credentialSubject']['account'][0]['id']"
    )
    expect(stringifyJsonPath(['@context'])).toBe("$['@context']")
    expect(stringifyJsonPath(['org.iso.18013.5.1', 'family_name'])).toBe("$['org.iso.18013.5.1']['family_name']")
    expect(stringifyJsonPath([])).toBe('$')
  })

  it('escapes quotes and backslashes', () => {
    expect(stringifyJsonPath(["it's"])).toBe("$['it\\'s']")
    expect(stringifyJsonPath(['back\\slash'])).toBe("$['back\\\\slash']")
  })

  it('round-trips through the parser', () => {
    for (const path of [['a', 'b'], ['@context'], ['a', 0, 'b'], ["it's"], ['org.iso.18013.5.1']]) {
      expect(parseJsonPath(stringifyJsonPath(path))).toEqual(path)
    }
  })
})

describe('queryJsonPath edge cases', () => {
  it('does not reach into values that are not JSON, like an mdoc byte string', () => {
    const namespaces = { ns: { portrait: new Uint8Array(50_000) } }
    expect(queryJsonPathString(namespaces, '$.ns.portrait.*')).toEqual([])
    expect(queryJsonPathString(namespaces, '$.ns.portrait[0]')).toEqual([])
    expect(queryJsonPathString(namespaces, '$.ns.portrait')).toHaveLength(1)
  })

  it('matches an array index against any element when asked to', () => {
    expect(queryJsonPathString({ list: ['a', 'b'] }, '$.list[1]', { anyArrayIndex: true })).toHaveLength(2)
  })
})
