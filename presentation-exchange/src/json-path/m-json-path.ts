/**
 * A single step of a parsed JSONPath: a property name, an array index, or `null` for every element
 * of an array — the same shape, and meaning, as a DCQL claims path.
 *
 * Presentation Exchange only ever needs a tiny fragment of JSONPath. Real definitions use these forms:
 *
 *   $.issuer                                  -> ['issuer']
 *   $['org.iso.18013.5.1']['family_name']     -> ['org.iso.18013.5.1', 'family_name']
 *   $.verifiableCredential[2]                 -> ['verifiableCredential', 2]
 *   $.account[*].id                           -> ['account', null, 'id']
 *   $.type.*                                  -> ['type', null]
 *
 * Everything else is rejected, including:
 * - filter `[?(...)]` and script `[(...)]` expressions, because a general JSONPath implementation
 *   evaluates them, which hands a verifier-supplied definition an expression evaluator over the
 *   holder's credentials
 * - recursive descent `..`, because its cost grows with the square of the nesting depth of the
 *   credential, and no definition in the wild needs it
 * - slices `[1:3]` (a range of elements), unions `[0,1]` (several elements or keys) and negative
 *   indices (counting from the end), which no definition uses
 * - `@` or `$` in dot notation, which RFC 9535 does not allow either: such a key is quoted, e.g.
 *   `$['@context']`
 */
export type JsonPathSegment = string | number | null

/**
 * A concrete location in a document, as produced by {@link queryJsonPath}. Strings address
 * object properties, numbers address array elements.
 */
export type PathComponent = string | number

/**
 * A node returned by a query: the value found, and where it was found.
 */
export interface JsonPathNode<Value = unknown> {
  readonly value: Value
  readonly path: PathComponent[]
}
