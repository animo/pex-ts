import type { JsonPathSegment } from '../json-path/m-json-path.js'
import { parseJsonPath } from '../json-path/parse-json-path.js'
import type { Descriptor } from './m-presentation-submission.js'

export interface DescriptorLocation {
  presentation_index: number
  credential_index: number
}

function segmentsOf(path: string): JsonPathSegment[] | undefined {
  try {
    return parseJsonPath(path)
  } catch {
    return undefined
  }
}

/**
 * The trailing array index of a nested credential path, e.g. `$.vp.verifiableCredential[2]`.
 *
 * The leading key segments are not checked against a fixed list: which key a presentation nests
 * credentials under is an encoding detail (`verifiableCredential` for Linked Data,
 * `vp.verifiableCredential` for JWT), and a verifier gains nothing from rejecting a shape it can
 * read. What matters is that the path ends by selecting one credential.
 */
function trailingIndex(segments: JsonPathSegment[]): number | undefined {
  const last = segments.at(-1)
  return last?.type === 'index' ? last.index : undefined
}

/**
 * Work out which credential, in which presentation, a `descriptor_map` entry points at.
 *
 * Both path shapes this library writes are accepted, plus the equivalents the previous
 * implementation produced:
 *
 *   { path: '$' }                                          -> presentation 0, credential 0
 *   { path: '$[2]' }                                       -> presentation 2, credential 0
 *   { path: '$', path_nested: '$.verifiableCredential[1]' } -> presentation 0, credential 1
 *   { path: '$.verifiableCredential[1]' }                   -> presentation 0, credential 1
 */
export function resolveDescriptorLocation(
  descriptor: Descriptor
): { success: true; location: DescriptorLocation } | { success: false; message: string } {
  const segments = segmentsOf(descriptor.path)
  if (segments === undefined) {
    return { success: false, message: `Path '${descriptor.path}' is not a supported JSONPath` }
  }

  let presentationIndex: number
  let credentialIndex: number | undefined

  if (segments.length === 0) {
    presentationIndex = 0
  } else if (segments.length === 1 && segments[0]?.type === 'index') {
    presentationIndex = segments[0].index
  } else {
    // A path that reaches into the presentation is the embedded form: the submission sits inside
    // the presentation, so there is only one, and the path addresses a credential in it.
    const index = trailingIndex(segments)
    if (index === undefined) {
      return {
        success: false,
        message: `Path '${descriptor.path}' does not address a presentation or a credential within one`,
      }
    }
    presentationIndex = 0
    credentialIndex = index
  }

  if (descriptor.path_nested !== undefined) {
    if (credentialIndex !== undefined) {
      return {
        success: false,
        message: `Path '${descriptor.path}' already addresses a credential, so 'path_nested' is contradictory`,
      }
    }

    const nestedSegments = segmentsOf(descriptor.path_nested.path)
    if (nestedSegments === undefined) {
      return { success: false, message: `Nested path '${descriptor.path_nested.path}' is not a supported JSONPath` }
    }

    credentialIndex = trailingIndex(nestedSegments)
    if (credentialIndex === undefined) {
      return {
        success: false,
        message: `Nested path '${descriptor.path_nested.path}' does not select a single credential`,
      }
    }

    if (descriptor.path_nested.path_nested !== undefined) {
      return { success: false, message: 'Nesting deeper than one level is not supported' }
    }
  }

  return { success: true, location: { presentation_index: presentationIndex, credential_index: credentialIndex ?? 0 } }
}
