import { describe, expect, it } from 'vitest'
import { zFilter } from '../filter/m-filter.js'
import { PexInvalidDefinitionError, PexParseError } from '../pex-error/e-pex.js'
import {
  discoverPresentationDefinitionVersion,
  parsePresentationDefinition,
  safeParsePresentationDefinition,
} from './m-presentation-definition.js'
import { getNeededCount } from './m-submission-requirement.js'
import { getPresentationDefinitionIssues, validatePresentationDefinition } from './validate-definition.js'

const v1Definition = {
  id: 'v1',
  input_descriptors: [{ id: 'a', schema: [{ uri: 'https://example.com/schema' }] }],
}

const v2Definition = {
  id: 'v2',
  input_descriptors: [{ id: 'a', constraints: { fields: [{ path: ['$.vct'] }] } }],
}

describe('version discovery', () => {
  it('distinguishes the versions by their mutually exclusive properties', () => {
    expect(discoverPresentationDefinitionVersion(v1Definition)).toBe('v1')
    expect(discoverPresentationDefinitionVersion(v2Definition)).toBe('v2')
  })

  it('treats a definition with `frame` as v2', () => {
    expect(discoverPresentationDefinitionVersion({ ...v2Definition, frame: { '@context': {} } })).toBe('v2')
  })

  it('treats a per-descriptor `format` as v2', () => {
    const definition = {
      id: 'x',
      input_descriptors: [{ id: 'a', format: { mso_mdoc: { alg: ['ES256'] } }, constraints: {} }],
    }
    expect(discoverPresentationDefinitionVersion(definition)).toBe('v2')
  })

  it('rejects a definition mixing v1 and v2 properties', () => {
    const mixed = {
      id: 'mixed',
      input_descriptors: [{ id: 'a', schema: [{ uri: 'x' }], constraints: {}, format: { jwt: { alg: ['ES256'] } } }],
    }
    expect(() => parsePresentationDefinition(mixed)).toThrow(PexParseError)
  })

  it('reports issues from both versions when neither matches', () => {
    const result = safeParsePresentationDefinition({ id: 'broken', input_descriptors: [{ name: 'no id' }] })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.message).toContain('v1 issues:')
    expect(result.message).toContain('v2 issues:')
  })
})

describe('structural validation', () => {
  it('rejects unknown properties', () => {
    expect(() => parsePresentationDefinition({ ...v2Definition, unexpected: true })).toThrow(PexParseError)
  })

  it('rejects a field whose path is outside the supported subset', () => {
    const definition = {
      id: 'x',
      input_descriptors: [{ id: 'a', constraints: { fields: [{ path: ['$.a[?(@.b == 1)]'] }] } }],
    }

    expect(() => parsePresentationDefinition(definition)).toThrow(/Filter expressions are not supported/)
  })

  it('rejects a field whose path is the whole credential', () => {
    const definition = {
      id: 'x',
      input_descriptors: [{ id: 'a', constraints: { fields: [{ path: ['$.vct', '$'] }] } }],
    }

    expect(() => parsePresentationDefinition(definition)).toThrow(/not the whole credential/)
  })

  it('rejects a predicate without a filter', () => {
    const definition = {
      id: 'x',
      input_descriptors: [{ id: 'a', constraints: { fields: [{ path: ['$.age'], predicate: 'required' }] } }],
    }

    expect(() => parsePresentationDefinition(definition)).toThrow(/must also define 'filter'/)
  })

  it('accepts a predicate with a filter', () => {
    const definition = {
      id: 'x',
      input_descriptors: [
        {
          id: 'a',
          constraints: {
            fields: [{ path: ['$.age'], predicate: 'required', filter: { type: 'number', minimum: 18 } }],
          },
        },
      ],
    }

    expect(() => parsePresentationDefinition(definition)).not.toThrow()
  })

  it('rejects a submission requirement with neither from nor from_nested', () => {
    const definition = { ...v2Definition, submission_requirements: [{ rule: 'all' }] }
    expect(() => parsePresentationDefinition(definition)).toThrow(/either 'from' or 'from_nested'/)
  })

  it('rejects a submission requirement with both from and from_nested', () => {
    const definition = {
      ...v2Definition,
      submission_requirements: [{ rule: 'all', from: 'A', from_nested: [{ rule: 'all', from: 'A' }] }],
    }
    expect(() => parsePresentationDefinition(definition)).toThrow(/not define both/)
  })

  it('accepts count alongside min and max, as both spec schemas do', () => {
    const definition = {
      id: 'x',
      input_descriptors: [{ id: 'a', group: ['A'], constraints: {} }],
      submission_requirements: [{ rule: 'pick', from: 'A', count: 4, min: 4, max: 4 }],
    }

    expect(() => parsePresentationDefinition(definition)).not.toThrow()
  })

  it('accepts an empty input_descriptors array, as both spec schemas do', () => {
    expect(() => parsePresentationDefinition({ id: 'x', input_descriptors: [] })).not.toThrow()
  })

  it('accepts empty arrays where the spec schema sets no minimum', () => {
    const definition = {
      ...v2Definition,
      submission_requirements: [],
      input_descriptors: [
        {
          id: 'a',
          group: [],
          issuance: [],
          constraints: { is_holder: [], same_subject: [], fields: [{ path: ['$.vct'] }] },
        },
      ],
    }
    expect(safeParsePresentationDefinition(definition).success).toBe(true)
  })
})

describe('filter model', () => {
  it('rejects unknown keywords rather than ignoring them', () => {
    // A real JSON Schema validator ignores these; silently dropping an assertion widens what
    // matches, so an unsupported keyword is surfaced instead.
    expect(zFilter.safeParse({ type: 'string', multipleOf: 2 }).success).toBe(false)
    expect(zFilter.safeParse({ type: 'string', $ref: '#/definitions/x' }).success).toBe(false)
  })

  it('accepts annotation keywords and ignores them', () => {
    const result = zFilter.safeParse({ type: 'string', title: 'Name', description: 'x', $comment: 'y' })
    expect(result.success).toBe(true)
  })

  it('rejects pattern, naming it', () => {
    const result = zFilter.safeParse({ type: 'string', pattern: '^a.*$' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message).join('\n')).toContain('"pattern"')
  })

  it.each([
    { type: 'object', properties: { a: { type: 'string' } } },
    { type: 'object', required: ['a'] },
    { type: 'object', additionalProperties: false },
    { type: 'array', minItems: 1 },
    { type: 'array', maxItems: 1 },
    { type: 'array', uniqueItems: true },
    { allOf: [{ type: 'string' }] },
    { anyOf: [{ type: 'string' }] },
    { oneOf: [{ type: 'string' }] },
  ])('rejects the structural keyword in %o', (filter) => {
    expect(zFilter.safeParse(filter).success).toBe(false)
  })

  it('takes a sub-filter for not, contains and items, one level deep', () => {
    expect(zFilter.safeParse({ type: 'string', not: { const: 'Karen' } }).success).toBe(true)
    expect(zFilter.safeParse({ type: 'array', contains: { const: 'PermanentResidentCard' } }).success).toBe(true)
    expect(zFilter.safeParse({ type: 'array', items: { type: 'string' }, contains: { const: 'x' } }).success).toBe(true)

    expect(zFilter.safeParse({ type: 'string', not: { not: { const: 'Karen' } } }).success).toBe(false)
    expect(zFilter.safeParse({ type: 'array', contains: { contains: { const: 'x' } } }).success).toBe(false)
    expect(zFilter.safeParse({ type: 'array', items: { items: { type: 'string' } } }).success).toBe(false)
  })

  it('requires type array for contains and items', () => {
    expect(zFilter.safeParse({ contains: { const: 'x' } }).success).toBe(false)
    expect(zFilter.safeParse({ type: 'string', items: { type: 'string' } }).success).toBe(false)
    expect(zFilter.safeParse({ type: ['array', 'null'], contains: { const: 'x' } }).success).toBe(false)
  })
})

describe('semantic validation', () => {
  it('reports duplicate input descriptor ids', () => {
    const definition = parsePresentationDefinition({
      id: 'x',
      input_descriptors: [
        { id: 'dupe', constraints: {} },
        { id: 'dupe', constraints: {} },
      ],
    }).definition

    expect(getPresentationDefinitionIssues(definition)).toEqual([
      { path: '$.input_descriptors[1].id', message: "Duplicate input descriptor id 'dupe'" },
    ])
    expect(() => validatePresentationDefinition(definition)).toThrow(PexInvalidDefinitionError)
  })

  it('reports a submission requirement referencing an undeclared group', () => {
    const definition = parsePresentationDefinition({
      id: 'x',
      input_descriptors: [{ id: 'a', group: ['A'], constraints: {} }],
      submission_requirements: [{ rule: 'all', from: 'B' }],
    }).definition

    expect(getPresentationDefinitionIssues(definition)).toEqual([
      {
        path: '$.submission_requirements[0].from',
        message: "References group 'B', which no input descriptor declares",
      },
    ])
  })

  it('checks nested submission requirements too', () => {
    const definition = parsePresentationDefinition({
      id: 'x',
      input_descriptors: [{ id: 'a', group: ['A'], constraints: {} }],
      submission_requirements: [
        {
          rule: 'all',
          from_nested: [
            { rule: 'all', from: 'A' },
            { rule: 'all', from: 'Z' },
          ],
        },
      ],
    }).definition

    expect(getPresentationDefinitionIssues(definition)).toEqual([
      {
        path: '$.submission_requirements[0].from_nested[1].from',
        message: "References group 'Z', which no input descriptor declares",
      },
    ])
  })

  it('reports bounds that contradict each other', () => {
    const definition = parsePresentationDefinition({
      id: 'x',
      input_descriptors: [{ id: 'a', group: ['A'], constraints: {} }],
      submission_requirements: [{ rule: 'pick', from: 'A', min: 3, max: 1 }],
    }).definition

    expect(getPresentationDefinitionIssues(definition)).toEqual([
      { path: '$.submission_requirements[0].min', message: "'min' (3) is greater than 'max' (1)" },
    ])
  })

  it('reports an input descriptor format that widens the definition format', () => {
    const definition = parsePresentationDefinition({
      id: 'x',
      format: { jwt_vc: { alg: ['ES256'] } },
      input_descriptors: [{ id: 'a', format: { mso_mdoc: { alg: ['ES256'] } }, constraints: {} }],
    }).definition

    expect(getPresentationDefinitionIssues(definition)).toEqual([
      {
        path: '$.input_descriptors[0].format',
        message: "Admits credential format 'mso_mdoc' which the definition-level format does not ('jwt_vc')",
      },
    ])
  })

  it('allows an input descriptor format that narrows the definition format', () => {
    const definition = parsePresentationDefinition({
      id: 'x',
      format: { jwt_vc: { alg: ['ES256'] }, mso_mdoc: { alg: ['ES256'] } },
      input_descriptors: [{ id: 'a', format: { mso_mdoc: { alg: ['ES256'] } }, constraints: {} }],
    }).definition

    expect(getPresentationDefinitionIssues(definition)).toEqual([])
  })

  it('compares formats by the credentials they admit, so ldp_vc narrows ldp_vp', () => {
    const withDescriptorFormat = (format: unknown) =>
      parsePresentationDefinition({
        id: 'x',
        format: { ldp_vp: { proof_type: ['Ed25519Signature2018'] } },
        input_descriptors: [{ id: 'a', format, constraints: {} }],
      }).definition

    expect(
      getPresentationDefinitionIssues(withDescriptorFormat({ ldp_vc: { proof_type: ['Ed25519Signature2018'] } }))
    ).toEqual([])
    expect(getPresentationDefinitionIssues(withDescriptorFormat({ 'dc+sd-jwt': {} }))).toEqual([
      {
        path: '$.input_descriptors[0].format',
        message: "Admits credential format 'dc+sd-jwt' which the definition-level format does not ('ldp', 'ldp_vc')",
      },
    ])
  })

  it('collects every issue rather than stopping at the first', () => {
    const definition = parsePresentationDefinition({
      id: 'x',
      input_descriptors: [
        { id: 'dupe', constraints: {} },
        { id: 'dupe', constraints: {} },
      ],
      submission_requirements: [{ rule: 'all', from: 'nope' }],
    }).definition

    expect(getPresentationDefinitionIssues(definition)).toHaveLength(2)
  })
})

describe('getNeededCount', () => {
  it('needs every member under rule all', () => {
    expect(getNeededCount({ rule: 'all', from: 'A' }, 3)).toBe(3)
  })

  it('prefers count, then min, then one under rule pick', () => {
    expect(getNeededCount({ rule: 'pick', from: 'A', count: 2 }, 5)).toBe(2)
    expect(getNeededCount({ rule: 'pick', from: 'A', min: 3 }, 5)).toBe(3)
    expect(getNeededCount({ rule: 'pick', from: 'A', max: 4 }, 5)).toBe(1)
    expect(getNeededCount({ rule: 'pick', from: 'A' }, 5)).toBe(1)
  })
})

describe('input that could never be evaluated', () => {
  const withFilter = (filter: unknown) => ({
    id: 'd',
    input_descriptors: [{ id: 'x', constraints: { fields: [{ path: ['$.a'], filter }] } }],
  })

  it('reports nesting too deep to parse as a parse error', () => {
    let filter: unknown = { type: 'string' }
    for (let depth = 0; depth < 20_000; depth++) filter = { not: filter }

    expect(() => parsePresentationDefinition(withFilter(filter))).toThrow(PexParseError)
  })

  it.each([
    [{ type: 'number', minimum: '18' }, 'only admits number'],
    [{ type: 'string', format: 'date', minimum: '2000-1-1' }, 'not a valid date'],
    [{ type: 'string', formatMinimum: '2000-01-01' }, "requires 'format'"],
    [{ type: 'string', format: 'email', formatMinimum: 'a@b.c' }, 'requires an ordered format'],
  ])('rejects the bound in %o, rather than ignoring it', (filter, message) => {
    const result = zFilter.safeParse(filter)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain(message)
  })
})
