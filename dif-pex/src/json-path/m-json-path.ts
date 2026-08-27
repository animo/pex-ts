/**
 * A single step of a parsed JSONPath.
 *
 * Presentation Exchange only ever needs a tiny fragment of JSONPath. A survey of every `path`
 * in the DIF examples and the Sphereon PEX fixtures turns up exactly these forms:
 *
 *   $.issuer                                  -> key
 *   $['org.iso.18013.5.1']['family_name']     -> key, key
 *   $.verifiableCredential[2]                 -> key, index
 *   $.account[*].id                           -> key, wildcard, key
 *   $.type.*                                  -> key, wildcard
 *   $..['@context']                           -> descendant
 *
 * Everything else — filter expressions `[?(...)]`, script expressions `[(...)]`, slices
 * `[1:3]`, unions `[0,1]`, negative indices — is rejected. Filter and script expressions are
 * the reason: a general JSONPath implementation evaluates them, which hands a verifier-supplied
 * presentation definition an expression evaluator over the holder's credentials.
 */
export type JsonPathSegment =
  /** `.name` or `['name']` or `["name"]` */
  | { readonly type: 'key'; readonly key: string }
  /** `[0]` */
  | { readonly type: 'index'; readonly index: number }
  /** `[*]` or `.*` — every element of an array, or every value of an object */
  | { readonly type: 'wildcard' }
  /** `..name` or `..['name']` — the key at any depth */
  | { readonly type: 'descendant'; readonly key: string }

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
