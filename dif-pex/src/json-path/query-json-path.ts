import type { JsonPathNode, JsonPathSegment, PathComponent } from './m-json-path.js'
import { parseJsonPath } from './parse-json-path.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(object, key)
}

/**
 * Collect every occurrence of `key` in the subtree rooted at `node`, including `node` itself.
 *
 * Iterative rather than recursive so that deeply nested credentials cannot blow the stack, and
 * cycle-guarded so that a caller handing us a non-JSON object graph cannot hang the process.
 * Traversal is pre-order and deterministic: a node is inspected before its children, and
 * children are visited in property/index order.
 */
function collectDescendants(node: JsonPathNode, key: string): JsonPathNode[] {
  const results: JsonPathNode[] = []
  const seen = new WeakSet<object>()
  const stack: JsonPathNode[] = [node]

  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break

    const { value, path } = current
    if (typeof value !== 'object' || value === null) continue
    if (seen.has(value)) continue
    seen.add(value)

    if (isPlainObject(value)) {
      if (hasOwn(value, key)) {
        results.push({ value: value[key], path: [...path, key] })
      }

      // Pushed in reverse so the stack pops them in declaration order.
      const entries = Object.keys(value)
      for (let index = entries.length - 1; index >= 0; index--) {
        const property = entries[index]
        if (property === undefined) continue
        stack.push({ value: value[property], path: [...path, property] })
      }
      continue
    }

    if (!Array.isArray(value)) continue
    for (let index = value.length - 1; index >= 0; index--) {
      stack.push({ value: value[index], path: [...path, index] })
    }
  }

  return results
}

function applySegment(nodes: JsonPathNode[], segment: JsonPathSegment): JsonPathNode[] {
  const next: JsonPathNode[] = []

  for (const node of nodes) {
    const { value, path } = node

    switch (segment.type) {
      case 'key': {
        if (isPlainObject(value) && hasOwn(value, segment.key)) {
          next.push({ value: value[segment.key], path: [...path, segment.key] })
        }
        break
      }

      case 'index': {
        if (Array.isArray(value) && segment.index < value.length) {
          next.push({ value: value[segment.index], path: [...path, segment.index] })
        }
        break
      }

      case 'wildcard': {
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index++) {
            next.push({ value: value[index], path: [...path, index] })
          }
        } else if (isPlainObject(value)) {
          for (const key of Object.keys(value)) {
            next.push({ value: value[key], path: [...path, key] })
          }
        }
        break
      }

      case 'descendant': {
        next.push(...collectDescendants(node, segment.key))
        break
      }
    }
  }

  return next
}

/**
 * Resolve a parsed path against a value, returning every matching node.
 *
 * The equivalent of `jsonpath.nodes()`, restricted to the supported subset. A path that matches
 * nothing returns an empty array; it never throws.
 */
export function queryJsonPath(value: unknown, segments: JsonPathSegment[]): JsonPathNode[] {
  let nodes: JsonPathNode[] = [{ value, path: [] }]

  for (const segment of segments) {
    nodes = applySegment(nodes, segment)
    if (nodes.length === 0) return []
  }

  return nodes
}

/**
 * Convenience wrapper that parses and queries in one step.
 *
 * Prefer parsing once and reusing the segments when evaluating the same path against many
 * credentials, which is what the evaluation pipeline does.
 */
export function queryJsonPathString(value: unknown, path: string): JsonPathNode[] {
  return queryJsonPath(value, parseJsonPath(path))
}

export type { JsonPathNode, PathComponent }
