import fc from 'fast-check'
import type { JsonPathSegment } from './json-path/m-json-path.js'
import type { PexSdJwtVcCredential } from './pex-credential/u-pex-credential.js'
import type { JsonObject, JsonValue } from './u-pex.js'

/**
 * Generators for the fuzz tests. The value domains are small on purpose: keys, strings and numbers are
 * drawn from short lists, so a generated path or filter mostly hits something in generated claims.
 */

/** Keys, including the ones a careless implementation reads from the prototype. */
export const arbitraryKey = fc.constantFrom('a', 'b', 'c', '18', '@context', '__proto__', 'constructor', 'toString')

export const arbitraryScalar: fc.Arbitrary<string | number | boolean | null> = fc.oneof(
  fc.constantFrom('', 'x', 'NL', '2024-01-01', '1990-05-17T10:00:00Z', 'a@b.example'),
  fc.integer({ min: -2, max: 30 }),
  fc.constantFrom(0.5, 18.5),
  fc.boolean(),
  fc.constant(null)
)

/** JSON, with objects whose own keys may be `__proto__` or `constructor`. */
export const arbitraryJson: fc.Arbitrary<JsonValue> = fc.letrec<{ value: JsonValue }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    arbitraryScalar,
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(arbitraryKey, tie('value'), { maxKeys: 3, noNullPrototype: true })
  ),
})).value

export const arbitraryClaims: fc.Arbitrary<JsonObject> = fc.dictionary(arbitraryKey, arbitraryJson, {
  maxKeys: 4,
  noNullPrototype: true,
})

const arbitrarySegment = fc.oneof(arbitraryKey, fc.nat({ max: 3 }), fc.constant(null))

/** A parsed path: a key, an array index, or `null` for a wildcard. */
export const arbitrarySegments: fc.Arbitrary<JsonPathSegment[]> = fc.array(arbitrarySegment, { maxLength: 4 })

/** A field path, which can't be `$`. */
const arbitraryFieldSegments = fc.array(arbitrarySegment, { minLength: 1, maxLength: 4 })

/** Write parsed segments as a JSONPath, in dot notation where a key allows it. */
export function toJsonPath(segments: JsonPathSegment[]): string {
  let path = '$'
  for (const segment of segments) {
    if (segment === null) path += '[*]'
    else if (typeof segment === 'number') path += `[${segment}]`
    else if (/^[A-Za-z0-9_-]+$/.test(segment)) path += `.${segment}`
    else path += `['${segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
  }
  return path
}

const filterTypes = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const

/** The value keywords of a filter: what `not`, `contains` and `items` take. Bounds stay valid for the type. */
export const arbitraryValueFilter = fc.oneof(
  fc.record(
    {
      type: fc.oneof(
        fc.constantFrom(...filterTypes),
        fc.uniqueArray(fc.constantFrom(...filterTypes), { minLength: 1 })
      ),
      const: arbitraryScalar,
      enum: fc.array(arbitraryScalar, { minLength: 1, maxLength: 3 }),
      minimum: fc.integer({ min: -2, max: 30 }),
      maximum: fc.integer({ min: -2, max: 30 }),
      exclusiveMinimum: fc.integer({ min: -2, max: 30 }),
      exclusiveMaximum: fc.integer({ min: -2, max: 30 }),
    },
    { requiredKeys: [] }
  ),
  fc.record(
    {
      type: fc.constant('string' as const),
      minLength: fc.nat({ max: 12 }),
      maxLength: fc.nat({ max: 12 }),
      format: fc.constantFrom('email', 'uri', 'unknown-format'),
      minimum: fc.constantFrom('a', 'x', '2000'),
    },
    { requiredKeys: [] }
  ),
  fc.record(
    {
      type: fc.constant('string' as const),
      format: fc.constant('date' as const),
      formatMinimum: fc.constantFrom('1980-01-01', '2000-01-01'),
      formatMaximum: fc.constantFrom('2000-01-01', '2030-01-01'),
      minimum: fc.constantFrom('1980-01-01', '2000-01-01'),
    },
    { requiredKeys: ['format'] }
  )
)

/** A filter, possibly with a `not`, or an array filter with `contains` or `items`. */
export const arbitraryFilter = fc.oneof(
  arbitraryValueFilter,
  fc.record({ not: arbitraryValueFilter }),
  fc.record(
    { type: fc.constant('array' as const), contains: arbitraryValueFilter, items: arbitraryValueFilter },
    { requiredKeys: ['type'] }
  )
)

function fieldOf(segments: fc.Arbitrary<JsonPathSegment[]>, filter: fc.Arbitrary<object>) {
  return fc
    .record(
      {
        paths: fc.array(segments, { minLength: 1, maxLength: 2 }),
        filter,
        optional: fc.boolean(),
        predicate: fc.constantFrom('required', 'preferred'),
        intent_to_retain: fc.boolean(),
      },
      { requiredKeys: ['paths'] }
    )
    .map(({ paths, predicate, filter, ...field }) => ({
      ...field,
      path: paths.map(toJsonPath),
      ...(filter === undefined ? {} : { filter }),
      // A predicate needs a filter
      ...(predicate === undefined || filter === undefined ? {} : { predicate }),
    }))
}

function definitionOf(field: fc.Arbitrary<object>) {
  return fc
    .array(
      fc.record(
        { fields: fc.array(field, { maxLength: 3 }), limit_disclosure: fc.constantFrom('required', 'preferred') },
        { requiredKeys: ['fields'] }
      ),
      { minLength: 1, maxLength: 3 }
    )
    .map((descriptors) => ({
      id: 'definition',
      input_descriptors: descriptors.map((constraints, index) => ({ id: `descriptor-${index}`, constraints })),
    }))
}

/** A v2 definition with one to three input descriptors, unrelated to any claims. */
export const arbitraryDefinition = definitionOf(fieldOf(arbitraryFieldSegments, arbitraryFilter))

/** Every path into a value, with its value. */
function pathsOf(
  value: JsonValue,
  path: Array<string | number> = []
): Array<{ path: Array<string | number>; value: JsonValue }> {
  const children: Array<[string | number, JsonValue]> = Array.isArray(value)
    ? value.map((element, index) => [index, element])
    : value !== null && typeof value === 'object'
      ? Object.entries(value)
      : []
  return children.flatMap(([component, child]) => [
    { path: [...path, component], value: child },
    ...pathsOf(child, [...path, component]),
  ])
}

/**
 * SD-JWT VCs and a definition over them. Most field paths are taken from the claims, some with array
 * indices made wildcards, and most filters from the values found there, so that fields mostly match.
 */
export const arbitraryQueryCase = fc.array(arbitraryClaims, { minLength: 1, maxLength: 3 }).chain((claimsList) => {
  const found = claimsList.flatMap((claims) => pathsOf(claims))
  const scalars = found.map(({ value }) => value).filter((value) => value === null || typeof value !== 'object')

  const segments =
    found.length === 0
      ? arbitraryFieldSegments
      : fc.oneof(
          {
            weight: 4,
            arbitrary: fc
              .constantFrom(...found.map(({ path }) => path))
              .chain((path) =>
                fc
                  .array(fc.boolean(), { minLength: path.length, maxLength: path.length })
                  .map((wildcards) =>
                    path.map((component, index) =>
                      typeof component === 'number' && wildcards[index] ? null : component
                    )
                  )
              ),
          },
          { weight: 1, arbitrary: arbitraryFieldSegments }
        )

  const filter =
    scalars.length === 0
      ? arbitraryFilter
      : fc.oneof(
          arbitraryFilter,
          fc.constantFrom(...scalars).map((value) => ({ const: value })),
          fc.constantFrom(...scalars).map((value) => ({ not: { const: value } })),
          fc.constantFrom(...scalars).map((value) => ({ type: 'array' as const, contains: { const: value } }))
        )

  return fc.record({
    definition: definitionOf(fieldOf(segments, filter)),
    credentials: fc.constant(
      claimsList.map((claims): PexSdJwtVcCredential => ({ credential_format: 'dc+sd-jwt', claims }))
    ),
  })
})
