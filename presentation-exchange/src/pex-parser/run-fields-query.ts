import { type FilterIssue, runFilter } from '../filter/run-filter.js'
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

export interface RunFieldQueryOptions {
  /**
   * Evaluate presented claims of a credential that can withhold array elements, rather than a credential: an
   * array index matches any element, because the elements a holder withheld are absent from a selectively
   * disclosed presentation.
   */
  presentation?: boolean
  /** A field with a `predicate` also accepts `true`, see `PexCredential.predicate_results`. */
  predicateResults?: boolean
}

/**
 * Evaluate one field against a credential's claims.
 *
 * Paths are tried in order and the **first one with a node that satisfies the filter wins**. A path
 * that resolves nothing, or only to values failing the filter, passes on to the next path, as DIF
 * Presentation Exchange v2 prescribes. This is how a definition expresses one claim across
 * credential shapes, e.g. `["$.issuer", "$.vc.issuer", "$.iss"]`. When no path matches, the first
 * path whose values failed the filter is reported.
 *
 * In a presentation that can withhold array elements, a path with an array index resolves only when an element
 * passes the filter: the index matches any element there, and the one it names may have been withheld.
 *
 * Where a path resolves to several nodes (through a wildcard), the field matches if **any** of
 * them satisfies the filter, and every node that satisfies it is reported — as dcql-ts does for a
 * `null` path element. The previous implementation reported `inputField[0]` regardless of which
 * node matched, so a wildcard path could disclose a different element than the one that satisfied
 * the constraint.
 */
export function runFieldQuery(
  compiled: CompiledField,
  claims: unknown,
  options: RunFieldQueryOptions = {}
): FieldResult {
  const { field, index } = compiled
  const isOptional = 'optional' in field && field.optional === true
  const intentToRetain = 'intent_to_retain' in field ? field.intent_to_retain : undefined

  const toMatch = (matchedPath: string, nodes: JsonPathNode[]): FieldMatch => ({
    field_index: index,
    field_id: field.id,
    matched_path: matchedPath,
    // A predicate discloses only that the constraint holds, never the value behind it.
    nodes: nodes.map((node) => ({ path: node.path, value: field.predicate !== undefined ? true : node.value })),
    predicate: field.predicate,
    intent_to_retain: intentToRetain,
  })

  const filterFailed = (path: string, failures: FilterIssue[]): FieldResult => ({
    success: false,
    reason: {
      type: 'field',
      field_index: index,
      field_id: field.id,
      paths: field.path,
      cause: 'filter_failed',
      issues: failures,
      message: `Value at '${path}' did not satisfy the filter: ${failures.map((issue) => issue.message).join('; ')}`,
    },
  })

  // The first path whose values all failed the filter
  let failed: { path: string; failures: FilterIssue[] } | undefined
  // The first path in a presentation whose index matched only elements failing the filter
  let unmatchedIndex: { path: string; failures: FilterIssue[] } | undefined

  for (const { path, segments } of compiled.paths) {
    const nodes = queryJsonPath(claims, segments, { anyArrayIndex: options.presentation })
    if (nodes.length === 0) continue

    const failures: FilterIssue[] = []
    const matching = nodes.filter((node) => {
      if (field.filter === undefined) return true
      // A zero-knowledge presentation holds the predicate's result, not the value
      if (options.predicateResults && field.predicate !== undefined && node.value === true) return true

      const result = runFilter(node.value, field.filter)
      if (!result.success) failures.push(...result.issues)
      return result.success
    })

    if (matching.length > 0) return { success: true, match: toMatch(path, matching) }

    // In a presentation an index matches any element, so the elements that failed may all be other ones than
    // the path names, which the holder may have withheld. The path then counts as not resolved, so an optional
    // field passes if no other path fails the filter.
    if (options.presentation && segments.some((segment) => typeof segment === 'number')) {
      unmatchedIndex ??= { path, failures }
    } else {
      failed ??= { path, failures }
    }
  }

  if (failed) return filterFailed(failed.path, failed.failures)
  if (isOptional) return { success: true, match: toMatch(compiled.paths[0]?.path ?? '', []) }
  if (unmatchedIndex) return filterFailed(unmatchedIndex.path, unmatchedIndex.failures)

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

/**
 * Evaluate every field of a `constraints.fields` array. All failures are collected, so a wallet
 * can show everything a credential is missing rather than only the first problem.
 */
export function runFieldsQuery(
  compiled: CompiledField[],
  claims: unknown,
  options: RunFieldQueryOptions = {}
): { matches: FieldMatch[]; reasons: MismatchReason[] } {
  const matches: FieldMatch[] = []
  const reasons: MismatchReason[] = []

  for (const field of compiled) {
    const result = runFieldQuery(field, claims, options)
    if (result.success) matches.push(result.match)
    else reasons.push(result.reason)
  }

  return { matches, reasons }
}
