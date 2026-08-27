import type { PathComponent } from '../json-path/m-json-path.js'
import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import type { FieldMatch, LimitDisclosureResult } from '../pex-query-result/m-pex-query-result.js'
import type { JsonObject, JsonValue } from '../u-pex.js'

type Mutable = Record<string, unknown> | unknown[]

function containerFor(component: PathComponent): Mutable {
  return typeof component === 'number' ? [] : {}
}

/**
 * Write `value` at `path`, creating arrays for numeric components and objects for string ones.
 *
 * Array holes are filled with `null` so that indices are preserved: a path into the pruned
 * object resolves to the same place it did in the original.
 */
function setAtPath(root: Mutable, path: readonly PathComponent[], value: unknown): void {
  let cursor: Mutable = root

  for (let depth = 0; depth < path.length; depth++) {
    const component = path[depth]
    if (component === undefined) return
    const isLast = depth === path.length - 1

    if (Array.isArray(cursor) && typeof component === 'number') {
      while (cursor.length < component) cursor.push(null)
      if (isLast) {
        cursor[component] = value
        return
      }
      const next = cursor[component]
      const container = next === undefined || next === null ? containerFor(path[depth + 1] as PathComponent) : next
      cursor[component] = container
      cursor = container as Mutable
      continue
    }

    if (!Array.isArray(cursor) && typeof component === 'string') {
      if (isLast) {
        cursor[component] = value
        return
      }
      const next = cursor[component]
      const container = next === undefined || next === null ? containerFor(path[depth + 1] as PathComponent) : next
      cursor[component] = container
      cursor = container as Mutable
      continue
    }

    // The path shape disagrees with the container built so far. This can only happen when two
    // fields resolve incompatible shapes at the same location, which cannot occur for paths
    // resolved against a single document.
    return
  }
}

/**
 * Mark everything under `value` for disclosure, mirroring its structure.
 *
 * A primitive becomes `true`. An object or array is walked so that each leaf is marked
 * individually — which is what `@sd-jwt/present` needs, since a nested disclosure has to be
 * addressed at the level it lives at rather than by marking an ancestor.
 */
function markForDisclosure(frame: Mutable, path: readonly PathComponent[], value: unknown): void {
  if (value === null || typeof value !== 'object') {
    setAtPath(frame, path, true)
    return
  }

  if (Array.isArray(value)) {
    if (value.length === 0) setAtPath(frame, path, true)
    else for (const [index, item] of value.entries()) markForDisclosure(frame, [...path, index], item)
    return
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) setAtPath(frame, path, true)
  else for (const [key, child] of entries) markForDisclosure(frame, [...path, key], child)
}

/**
 * Build what to disclose from a credential, given the fields that matched it.
 *
 * Nothing is mutated: the caller applies the result with whichever library owns the credential
 * format. This is why this package needs no SD-JWT or mdoc dependency, where the previous
 * implementation rewrote the credential in place through `@sd-jwt/present` and `@animo-id/mdoc`.
 */
export function buildLimitDisclosure(credential: PexCredential, matches: FieldMatch[]): LimitDisclosureResult {
  const output: JsonObject = {}
  const presentationFrame: JsonObject = {}

  for (const match of matches) {
    // An `optional` field that resolved nothing has nothing to disclose.
    if (match.resolved_path === undefined) continue

    setAtPath(output, match.resolved_path, match.value as JsonValue)
    markForDisclosure(presentationFrame, match.resolved_path, match.value)
  }

  if (credential.credential_format !== 'mso_mdoc') {
    return { output, presentation_frame: presentationFrame }
  }

  // An mdoc path is `$['namespace']['element']`, so a matched path is exactly those two
  // components. `intent_to_retain` defaults to false, matching ISO 18013-7.
  const namespaces: Record<string, Record<string, boolean>> = {}
  for (const match of matches) {
    const path = match.resolved_path
    if (path === undefined || path.length !== 2) continue

    const [namespace, element] = path
    if (typeof namespace !== 'string' || typeof element !== 'string') continue

    const existing = namespaces[namespace] ?? {}
    existing[element] = match.intent_to_retain ?? false
    namespaces[namespace] = existing
  }

  return { output, presentation_frame: presentationFrame, namespaces }
}
