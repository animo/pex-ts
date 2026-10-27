import type { JsonPathNode, JsonPathSegment, PathComponent } from './m-json-path.js'
import { parseJsonPath } from './parse-json-path.js'

/**
 * A JSON object. Other objects — an mdoc's byte strings and dates, class instances — are values, not
 * containers: a path does not reach into them, so a wildcard cannot fan out over the bytes of a portrait.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export interface QueryJsonPathOptions {
  /**
   * Let an array index match any element, as dcql-ts does when checking a presentation.
   *
   * A verifier needs this for selectively disclosed arrays: elements the holder withheld are absent
   * from the presented claims, so the element at index 1 in the credential can be at index 0 in the
   * presentation.
   */
  anyArrayIndex?: boolean
}

/**
 * The children of a value a segment selects: a property of a JSON object, or one or every element of an
 * array. Only own properties are read, so a path cannot reach an inherited property such as
 * `constructor` or `__proto__`. A wildcard selects array elements only, as `null` does in a DCQL claims
 * path — to ask for an object with everything in it, a definition names the object itself.
 */
function select(
  value: unknown,
  segment: JsonPathSegment,
  options: QueryJsonPathOptions
): Array<[PathComponent, unknown]> {
  if (Array.isArray(value)) {
    if (typeof segment === 'string') return []
    if (segment === null || options.anyArrayIndex) return value.map((element, index) => [index, element])
    return segment < value.length ? [[segment, value[segment]]] : []
  }

  if (typeof segment !== 'string' || !isPlainObject(value)) return []
  return Object.hasOwn(value, segment) ? [[segment, value[segment]]] : []
}

/**
 * Resolve a parsed path against a value, returning every matching node.
 *
 * Nothing is written, and the work is bounded by the size of the value: each segment only steps from
 * the nodes it was given to their children. A path that matches nothing returns an empty array; it
 * never throws.
 */
export function queryJsonPath(
  value: unknown,
  segments: JsonPathSegment[],
  options: QueryJsonPathOptions = {}
): JsonPathNode[] {
  let nodes: JsonPathNode[] = [{ value, path: [] }]

  for (const segment of segments) {
    nodes = nodes.flatMap((node) =>
      select(node.value, segment, options).map(([component, child]) => ({
        value: child,
        path: [...node.path, component],
      }))
    )
  }

  return nodes
}

/**
 * Convenience wrapper that parses and queries in one step.
 *
 * Prefer parsing once and reusing the segments when evaluating the same path against many
 * credentials, which is what the evaluation pipeline does.
 */
export function queryJsonPathString(value: unknown, path: string, options?: QueryJsonPathOptions): JsonPathNode[] {
  return queryJsonPath(value, parseJsonPath(path), options)
}

export type { JsonPathNode, PathComponent }
