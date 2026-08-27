import { describe, expect, it } from 'vitest'
import { PexJsonPathError } from '../pex-error/e-pex.js'
import { parseJsonPath } from './parse-json-path.js'
import { queryJsonPath, queryJsonPathString } from './query-json-path.js'
import { stringifyJsonPath } from './stringify-json-path.js'

describe('parseJsonPath', () => {
  it('parses the forms that appear in real presentation definitions', () => {
    expect(parseJsonPath('$.issuer')).toEqual([{ type: 'key', key: 'issuer' }])
    expect(parseJsonPath('$.vc.credentialSubject.birth_date')).toEqual([
      { type: 'key', key: 'vc' },
      { type: 'key', key: 'credentialSubject' },
      { type: 'key', key: 'birth_date' },
    ])
    expect(parseJsonPath("$['org.iso.18013.5.1']['family_name']")).toEqual([
      { type: 'key', key: 'org.iso.18013.5.1' },
      { type: 'key', key: 'family_name' },
    ])
    expect(parseJsonPath('$.verifiableCredential[2]')).toEqual([
      { type: 'key', key: 'verifiableCredential' },
      { type: 'index', index: 2 },
    ])
    expect(parseJsonPath('$.account[*].id')).toEqual([
      { type: 'key', key: 'account' },
      { type: 'wildcard' },
      { type: 'key', key: 'id' },
    ])
    expect(parseJsonPath('$.type.*')).toEqual([{ type: 'key', key: 'type' }, { type: 'wildcard' }])
    expect(parseJsonPath("$..['@context']")).toEqual([{ type: 'descendant', key: '@context' }])
    expect(parseJsonPath("$.vc..['@context']")).toEqual([
      { type: 'key', key: 'vc' },
      { type: 'descendant', key: '@context' },
    ])
    expect(parseJsonPath('$')).toEqual([])
    expect(parseJsonPath('$[0]')).toEqual([{ type: 'index', index: 0 }])
  })

  it('accepts @-prefixed keys in dot notation without rewriting', () => {
    // The old implementation could not parse this and rewrote it with regexes first.
    expect(parseJsonPath('$.@context')).toEqual([{ type: 'key', key: '@context' }])
    expect(parseJsonPath('$..@context')).toEqual([{ type: 'descendant', key: '@context' }])
  })

  it('accepts double-quoted and escaped keys', () => {
    expect(parseJsonPath('$["family_name"]')).toEqual([{ type: 'key', key: 'family_name' }])
    expect(parseJsonPath("$['it\\'s']")).toEqual([{ type: 'key', key: "it's" }])
  })

  it.each([
    ['$.a[?(@.b == 1)]', 'Filter expressions are not supported'],
    ["$['@book'].accessModeSufficient[(@.length-1)]", 'Script expressions are not supported'],
    ['$.a[1:3]', 'Array slices are not supported'],
    ['$.a[:2]', 'Array slices are not supported'],
    ['$.a[0,1]', 'Union expressions are not supported'],
    ['$.a[-1]', 'Negative array indices are not supported'],
    ['$..', 'Recursive descent must be followed by a property name'],
    ['$..*', 'Recursive descent must be followed by a property name'],
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

    expect(queryJsonPathString(credential, '$.credentialSubject.address.*')).toEqual([
      { value: 'Utrecht', path: ['credentialSubject', 'address', 'locality'] },
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

  it('finds descendants at any depth, in pre-order', () => {
    const nested = {
      '@context': 'outer',
      vc: { '@context': 'inner', nested: [{ '@context': 'in-array' }] },
    }

    expect(queryJsonPathString(nested, "$..['@context']")).toEqual([
      { value: 'outer', path: ['@context'] },
      { value: 'inner', path: ['vc', '@context'] },
      { value: 'in-array', path: ['vc', 'nested', 0, '@context'] },
    ])
  })

  it('terminates on cyclic input', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic

    expect(queryJsonPathString(cyclic, '$..a')).toEqual([{ value: 1, path: ['a'] }])
  })

  it('does not blow the stack on deeply nested input', () => {
    let deep: Record<string, unknown> = { target: 'found' }
    for (let i = 0; i < 50_000; i++) deep = { nested: deep }

    expect(queryJsonPathString(deep, '$..target')).toEqual([{ value: 'found', path: expect.any(Array) }])
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
      expect(parseJsonPath(stringifyJsonPath(path))).toEqual(
        path.map((component) =>
          typeof component === 'number' ? { type: 'index', index: component } : { type: 'key', key: component }
        )
      )
    }
  })
})
