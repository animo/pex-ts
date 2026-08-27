import { runFilter } from '../filter/run-filter.js'
import type { JsonPathNode, JsonPathSegment } from '../json-path/m-json-path.js'
import { parseJsonPath } from '../json-path/parse-json-path.js'
import { queryJsonPath } from '../json-path/query-json-path.js'
import type { FieldMatch, MismatchReason } from '../pex-query-result/m-pex-query-result.js'
import type { Field } from '../presentation-definition/m-field.js'

/**
 * A field with its paths already parsed.
 *
 * Paths are parsed once per query rather than once per credential — the same field is evaluated
 * against every candidate credential, and parsing is the only part of that which does not depend
 * on the credential.
 */
export interface CompiledField {
  field: Field
  index: number
  paths: Array<{ path: string; segments: JsonPathSegment[] }>
}

export function compileFields(fields: Field[] | undefined): CompiledField[] {
  return (fields ?? []).map((field, index) => ({
    field,
    index,
    paths: field.path.map((path) => ({ path, segments: parseJsonPath(path) })),
  }))
}

export type FieldResult = { success: true; match: FieldMatch } | { success: false; reason: MismatchReason }

/**
 * Evaluate one field against a credential's claims.
 *
 * Paths are tried in order and the **first one that resolves to at least one node wins** — the
 * remaining paths are not consulted, even if the winning path's value fails the filter. This is
 * how a definition expresses one claim across credential shapes, e.g.
 * `["$.issuer", "$.vc.issuer", "$.iss"]`.
 *
 * Where a path resolves to several nodes (through a wildcard), the field matches if **any** of
 * them satisfies the filter, and the node reported is the one that actually matched. The previous
 * implementation reported `inputField[0]` regardless of which node matched, so a wildcard path
 * could disclose a different element than the one that satisfied the constraint.
 */
export function runFieldQuery(compiled: CompiledField, claims: unknown): FieldResult {
  const { field, index } = compiled
  const isOptional = 'optional' in field && field.optional === true
  const intentToRetain = 'intent_to_retain' in field ? field.intent_to_retain : undefined

  let resolved: { path: string; nodes: JsonPathNode[] } | undefined
  for (const { path, segments } of compiled.paths) {
    const nodes = queryJsonPath(claims, segments)
    if (nodes.length > 0) {
      resolved = { path, nodes }
      break
    }
  }

  if (resolved === undefined) {
    if (isOptional) {
      return {
        success: true,
        match: {
          field_index: index,
          field_id: field.id,
          matched_path: compiled.paths[0]?.path ?? '',
          value: undefined,
          intent_to_retain: intentToRetain,
        },
      }
    }

    return {
      success: false,
      reason: {
        type: 'field',
        field_index: index,
        field_id: field.id,
        paths: field.path,
        cause: 'path_not_found',
        message: `No path resolved: '${field.path.join("', '")}'`,
      },
    }
  }

  const toMatch = (node: JsonPathNode): FieldMatch => ({
    field_index: index,
    field_id: field.id,
    matched_path: resolved.path,
    resolved_path: node.path,
    // A predicate discloses only that the constraint holds, never the value behind it.
    value: field.predicate !== undefined ? true : node.value,
    intent_to_retain: intentToRetain,
  })

  if (field.filter === undefined) {
    const first = resolved.nodes[0]
    if (first === undefined) throw new Error('unreachable: resolved with no nodes')
    return { success: true, match: toMatch(first) }
  }

  const filter = field.filter
  const failures = []
  for (const node of resolved.nodes) {
    const result = runFilter(node.value, filter)
    if (result.success) return { success: true, match: toMatch(node) }
    failures.push(...result.issues)
  }

  return {
    success: false,
    reason: {
      type: 'field',
      field_index: index,
      field_id: field.id,
      paths: field.path,
      cause: 'filter_failed',
      issues: failures,
      message: `Value at '${resolved.path}' did not satisfy the filter: ${failures.map((issue) => issue.message).join('; ')}`,
    },
  }
}

/**
 * Evaluate every field of a `constraints.fields` array. All failures are collected, so a wallet
 * can show everything a credential is missing rather than only the first problem.
 */
export function runFieldsQuery(
  compiled: CompiledField[],
  claims: unknown
): { matches: FieldMatch[]; reasons: MismatchReason[] } {
  const matches: FieldMatch[] = []
  const reasons: MismatchReason[] = []

  for (const field of compiled) {
    const result = runFieldQuery(field, claims)
    if (result.success) matches.push(result.match)
    else reasons.push(result.reason)
  }

  return { matches, reasons }
}
