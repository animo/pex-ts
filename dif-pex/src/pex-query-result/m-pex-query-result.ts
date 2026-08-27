import type { FilterIssue } from '../filter/run-filter.js'
import type { PathComponent } from '../json-path/m-json-path.js'
import type { UnevaluatedConstraint } from '../presentation-definition/m-constraints.js'
import type { PexVersion } from '../presentation-definition/m-presentation-definition.js'
import type { Rules } from '../presentation-definition/m-submission-requirement.js'
import type { JsonObject } from '../u-pex.js'

/**
 * Results are plain TypeScript types rather than zod models: they are produced by this library,
 * never parsed from untrusted input, so a schema would add weight without buying anything.
 * (dcql-ts models its results with valibot; this is a deliberate simplification.)
 */

/** A field whose constraint the credential satisfies. */
export interface FieldMatch {
  field_index: number
  field_id?: string
  /** The entry of `field.path` that resolved. The rest were not consulted. */
  matched_path: string
  /** Where it resolved to. Absent when an `optional` field matched nothing. */
  resolved_path?: PathComponent[]
  /**
   * The disclosed value, or `true` when the field declares a `predicate` — a predicate asks
   * whether the value satisfies the filter, and discloses only that it does.
   */
  value: unknown
  /** Carried through from the field; never asserted. Used to build mdoc device requests. */
  intent_to_retain?: boolean
}

/** Why a credential does not satisfy an input descriptor. Every applicable reason is reported. */
export type MismatchReason =
  | { type: 'format'; message: string; allowed: string[] }
  | { type: 'schema'; message: string; expected_uris: string[]; credential_uris: string[] }
  | {
      type: 'field'
      field_index: number
      field_id?: string
      /** Every path the field offered. */
      paths: string[]
      /** Whether no path resolved at all, or one resolved and the filter rejected the value. */
      cause: 'path_not_found' | 'filter_failed'
      message: string
      issues?: FilterIssue[]
    }
  | { type: 'limit_disclosure'; field_index: number; message: string }
  | { type: 'unsupported_constraint'; constraint: UnevaluatedConstraint; message: string }
  | { type: 'subject_is_issuer'; message: string }
  | { type: 'mdoc_doctype'; message: string }

/**
 * What to disclose from a credential when `limit_disclosure` applies.
 *
 * This library returns disclosure as *data* rather than mutating the credential, which is why it
 * needs no SD-JWT or mdoc dependency. The caller applies it with whichever library owns the
 * format.
 */
export interface LimitDisclosureResult {
  /**
   * The claims pruned to the matched paths, deep-merged across fields. A preview of what will be
   * disclosed. Array indices are preserved by filling skipped elements with `null`, so paths into
   * the pruned object still resolve the same way.
   */
  output: JsonObject
  /**
   * A path-to-`true` map, the shape `@sd-jwt/present` expects as a presentation frame.
   */
  presentation_frame: JsonObject
  /**
   * mdoc only: `{ [namespace]: { [element]: intent_to_retain } }`, the shape an mdoc device
   * request needs.
   */
  namespaces?: Record<string, Record<string, boolean>>
}

export interface CredentialMatch {
  /** Index into the `credentials` array passed to the query. */
  credential_index: number
  /** The credential's format, as it will appear in a `descriptor_map` entry. */
  format: string
  fields: FieldMatch[]
  disclosure?: LimitDisclosureResult
}

export interface CredentialMismatch {
  credential_index: number
  format: string
  reasons: MismatchReason[]
}

export interface InputDescriptorResult {
  input_descriptor_id: string
  input_descriptor_index: number
  name?: string
  purpose?: string
  /**
   * The groups this descriptor declares. Submission requirements select descriptors through
   * these — the linkage is specific to Presentation Exchange.
   */
  group?: string[]
  satisfied: boolean
  matching_credentials: CredentialMatch[]
  non_matching_credentials: CredentialMismatch[]
}

/**
 * Mirrors the definition's own `submission_requirements` tree, node for node.
 */
export type SubmissionRequirementResult = {
  submission_requirement_index: number
  name?: string
  purpose?: string
  rule: Rules
  count?: number
  min?: number
  max?: number
  /** How many members must be satisfied: the group size under `all`, else `count ?? min ?? 1`. */
  needs_count: number
  satisfied: boolean
} & (
  | {
      from: string
      from_nested?: undefined
      /** The descriptors in that group, in definition order. */
      input_descriptors: Array<{ input_descriptor_id: string; satisfied: boolean }>
    }
  | { from?: undefined; from_nested: SubmissionRequirementResult[]; input_descriptors?: undefined }
)

export interface PexQueryResult {
  definition_id: string
  name?: string
  purpose?: string
  version: PexVersion
  /** Whether the definition as a whole can be satisfied by the credentials given. */
  can_be_satisfied: boolean
  input_descriptors: InputDescriptorResult[]
  /**
   * Absent when the definition declares no submission requirements, in which case every input
   * descriptor must be satisfied.
   */
  submission_requirements?: SubmissionRequirementResult[]
}
