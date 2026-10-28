import type { PathComponent } from '../json-path/m-json-path.js'
import { isPlainObject } from '../json-path/query-json-path.js'
import { getCredentialClaims, type PexCredential } from '../pex-credential/u-pex-credential.js'
import type { FieldMatch, LimitDisclosureResult } from '../pex-query-result/m-pex-query-result.js'
import type { JsonObject } from '../u-pex.js'

/**
 * Set an own property. Plain assignment would treat a `__proto__` key — which a JSON-parsed credential
 * can have as an own property — as the object's prototype, and a later write through it would reach
 * `Object.prototype`.
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

type Container = unknown[] | Record<string, unknown>

function isContainer(value: unknown): value is Container {
  return Array.isArray(value) || isPlainObject(value)
}

function isEmpty(container: Container): boolean {
  return Array.isArray(container) ? container.length === 0 : Object.keys(container).length === 0
}

/**
 * The matched paths as a tree. A node is `complete` when a path ends there: the claim is disclosed with
 * everything below it, so paths further down add nothing.
 */
interface PathTree {
  complete: boolean
  children: Map<string, { component: PathComponent; tree: PathTree }>
}

/** Numbers and strings are distinct: `0` addresses an array element, `'0'` an object property. */
function getTreeKey(component: PathComponent): string {
  return `${typeof component}:${component}`
}

function addPath(root: PathTree, path: PathComponent[]) {
  let tree = root
  for (const component of path) {
    if (tree.complete) return
    const key = getTreeKey(component)
    let child = tree.children.get(key)
    if (!child) {
      child = { component, tree: { complete: false, children: new Map() } }
      tree.children.set(key, child)
    }
    tree = child.tree
  }
  tree.complete = true
  tree.children.clear()
}

function buildPathTree(paths: PathComponent[][]): PathTree {
  const root: PathTree = { complete: false, children: new Map() }
  for (const path of paths) addPath(root, path)
  return root
}

/** Whether a path in the tree discloses the claim at `path`: the claim itself or one above it. */
function isCovered(tree: PathTree, path: PathComponent[]): boolean {
  let node: PathTree | undefined = tree
  for (const component of path) {
    if (node.complete) return true
    node = node.children.get(getTreeKey(component))?.tree
    if (!node) return false
  }
  return node.complete
}

/**
 * The claims under the paths of `tree`, built from fresh objects and arrays. Where a path ends, `onClaim`
 * produces what goes in its place. Array indices are kept, with `null` in the gaps. Recursion here is bounded
 * by the length of a path, not by the depth of the claims.
 */
function project(value: unknown, tree: PathTree, onClaim: (claim: unknown) => unknown): unknown {
  if (tree.complete) return onClaim(value)

  if (Array.isArray(value)) {
    const output: unknown[] = []
    for (const { component, tree: child } of tree.children.values()) {
      if (typeof component !== 'number' || component >= value.length) continue
      while (output.length < component) output.push(null)
      output[component] = project(value[component], child, onClaim)
    }
    return output
  }

  if (isPlainObject(value)) {
    const output: Record<string, unknown> = {}
    for (const { component, tree: child } of tree.children.values()) {
      if (typeof component !== 'string' || !Object.hasOwn(value, component)) continue
      setOwn(output, component, project(value[component], child, onClaim))
    }
    return output
  }

  return undefined
}

/**
 * Rebuild the JSON containers of a value from fresh objects and arrays, replacing everything else: `leaf`
 * gives what stands in for a value that is not a container, `empty` for a container with nothing in it.
 *
 * Iterative, so a credential nested deeper than the call stack allows can't throw. A JSON document of a few
 * hundred kilobytes can nest a hundred thousand levels, and `JSON.parse` reads it without recursing.
 */
function rebuild(
  root: unknown,
  replace: { leaf(value: unknown): unknown; empty(container: Container): unknown }
): unknown {
  const pending: Array<{ source: Container; target: Container }> = []

  const start = (value: unknown): unknown => {
    if (!isContainer(value)) return replace.leaf(value)
    if (isEmpty(value)) return replace.empty(value)
    const target: Container = Array.isArray(value) ? [] : {}
    pending.push({ source: value, target })
    return target
  }

  const output = start(root)
  while (pending.length > 0) {
    const { source, target } = pending.pop() as { source: Container; target: Container }
    if (Array.isArray(source)) {
      const array = target as unknown[]
      for (let index = 0; index < source.length; index++) array[index] = start(source[index])
    } else {
      const object = target as Record<string, unknown>
      for (const [key, child] of Object.entries(source)) setOwn(object, key, start(child))
    }
  }

  return output
}

/**
 * A deep copy of the JSON parts of a value. An mdoc's byte strings and dates are copied too; any other value
 * that is not JSON is kept as is.
 */
function copy(value: unknown): unknown {
  return rebuild(value, {
    leaf: (leaf) =>
      leaf instanceof Uint8Array ? leaf.slice() : leaf instanceof Date ? new Date(leaf.getTime()) : leaf,
    empty: (container) => (Array.isArray(container) ? [] : {}),
  })
}

/**
 * The paths of `tree` that resolve in `value`, in the order of its claims. A path is only listed down to
 * where it ends, as the claim there is disclosed with everything below it. Recursion here is bounded by the
 * length of a path, not by the depth of the claims.
 */
function listPaths(value: unknown, tree: PathTree, path: PathComponent[] = []): PathComponent[][] {
  if (tree.complete) return [path]

  if (Array.isArray(value)) {
    return [...tree.children.values()]
      .filter(({ component }) => typeof component === 'number' && component < value.length)
      .sort((a, b) => (a.component as number) - (b.component as number))
      .flatMap(({ component, tree: child }) => listPaths(value[component as number], child, [...path, component]))
  }

  if (isPlainObject(value)) {
    return Object.keys(value).flatMap((key) => {
      const child = tree.children.get(getTreeKey(key))
      return child ? listPaths(value[key], child.tree, [...path, key]) : []
    })
  }

  return []
}

/**
 * Put `true` at a path of a projected output, for a claim matched only by a `predicate` field. The path must
 * not be covered by a disclosed claim, so a `null` met in an array is a gap the projection filled, never a
 * disclosed value. Nothing is changed when a claim below the path is already disclosed.
 */
function setPredicateResult(output: Record<string, unknown>, path: PathComponent[]) {
  let cursor: unknown = output

  for (const [depth, component] of path.entries()) {
    const isLast = depth === path.length - 1
    const next = path[depth + 1]

    if (Array.isArray(cursor) && typeof component === 'number') {
      while (cursor.length < component) cursor.push(null)
      const existing = cursor[component]
      if (isLast) {
        if (existing === undefined || existing === null) cursor[component] = true
        return
      }
      if (existing === undefined || existing === null) cursor[component] = typeof next === 'number' ? [] : {}
      cursor = cursor[component]
      continue
    }

    if (isPlainObject(cursor) && typeof component === 'string') {
      const existing = Object.hasOwn(cursor, component) ? cursor[component] : undefined
      if (isLast) {
        if (existing === undefined) setOwn(cursor, component, true)
        return
      }
      if (existing === undefined) setOwn(cursor, component, typeof next === 'number' ? [] : {})
      cursor = cursor[component]
      continue
    }

    // A disclosed claim (or a value of another shape) is in the way, so the predicate's claim is covered
    return
  }
}

/**
 * Build what to disclose from a credential, given the fields that matched it.
 *
 * Nothing is mutated, and nothing returned shares an object with the credential: the caller applies the
 * result with whichever library owns the credential format. This is why this package needs no SD-JWT or
 * mdoc dependency, where the previous implementation rewrote the credential in place through
 * `@sd-jwt/present` and `@animo-id/mdoc`.
 *
 * The result depends only on the set of matched paths, not on the order of the fields. For an mdoc each path is a
 * data element, `$['namespace']['element']`, as ISO 18013-7 requires and `getPresentationDefinitionIssues` checks.
 */
export function buildLimitDisclosure(credential: PexCredential, matches: FieldMatch[]): LimitDisclosureResult {
  const claims = getCredentialClaims(credential)
  const isMdoc = credential.credential_format === 'mso_mdoc'

  const pathsOf = (match: FieldMatch): PathComponent[][] => match.nodes.map(({ path }) => path)

  const valuePaths = matches.filter((match) => match.predicate === undefined).flatMap(pathsOf)
  const predicatePaths = matches.filter((match) => match.predicate !== undefined).flatMap(pathsOf)

  const valueTree = buildPathTree(valuePaths)
  const output = (project(claims, valueTree, copy) ?? {}) as JsonObject
  // Outermost first, so a predicate claim below another one is covered by its `true` whatever the field order
  const predicateTree = buildPathTree([])
  for (const path of [...predicatePaths].sort((left, right) => left.length - right.length)) {
    if (isCovered(valueTree, path) || isCovered(predicateTree, path)) continue
    setPredicateResult(output, path)
    addPath(predicateTree, path)
  }

  // A verifier can only check a predicate against the value, so the value is disclosed as well
  const paths = listPaths(claims, buildPathTree([...valuePaths, ...predicatePaths]))

  if (!isMdoc) {
    return { output, paths }
  }

  // `intent_to_retain` defaults to false, matching ISO 18013-7, and is true when any field matching the element
  // sets it.
  const namespaces: Record<string, Record<string, boolean>> = {}
  for (const match of matches) {
    for (const [namespace, element] of pathsOf(match) as Array<[string, string]>) {
      if (!Object.hasOwn(namespaces, namespace)) setOwn(namespaces, namespace, {})
      const elements = namespaces[namespace] as Record<string, boolean>
      const intentToRetain = (Object.hasOwn(elements, element) && elements[element]) || match.intent_to_retain === true
      setOwn(elements, element, intentToRetain)
    }
  }

  return { output, paths, namespaces }
}
