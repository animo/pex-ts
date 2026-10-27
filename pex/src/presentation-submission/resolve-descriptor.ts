import type { JsonPathSegment } from '../json-path/m-json-path.js'
import { parseJsonPath } from '../json-path/parse-json-path.js'
import { shorten } from '../u-pex.js'
import type { Descriptor } from './m-presentation-submission.js'

export interface DescriptorLocation {
  presentation_index: number
  /**
   * The credential within the presentation, or `undefined` when the path addresses the presentation as a
   * whole: an SD-JWT VC, or an mdoc device response, whose document is the one with the input
   * descriptor's id as doctype (ISO 18013-7).
   */
  credential_index?: number
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
  return typeof last === 'number' ? last : undefined
}

export interface ResolveDescriptorLocationOptions {
  /**
   * How many presentations were submitted. With more than one, `$` is the array of them rather than a
   * presentation, so a path must select one by index (`$[n]`).
   */
  presentationCount?: number
}

/**
 * Work out which credential, in which presentation, a `descriptor_map` entry points at.
 *
 * Both path shapes this library writes are accepted, plus the equivalents the previous
 * implementation produced:
 *
 *   { path: '$' }                                          -> presentation 0
 *   { path: '$[2]' }                                       -> presentation 2
 *   { path: '$', path_nested: '$.verifiableCredential[1]' } -> presentation 0, credential 1
 *   { path: '$.verifiableCredential[1]' }                   -> presentation 0, credential 1
 *   { path: '$[2].verifiableCredential[1]' }                -> presentation 2, credential 1
 *
 * A nested path is read relative to the presentation. One that starts with the presentation's index
 * (`$[2].vp.verifiableCredential[1]`) is read from the root instead, and must name the same presentation.
 *
 * A message quotes the holder's path shortened: the parser caps a path it reads, a message shouldn't echo
 * one it didn't.
 */
export function resolveDescriptorLocation(
  descriptor: Descriptor,
  options: ResolveDescriptorLocationOptions = {}
): { success: true; location: DescriptorLocation } | { success: false; message: string } {
  const segments = segmentsOf(descriptor.path)
  if (segments === undefined) {
    return { success: false, message: `Path '${shorten(descriptor.path)}' is not a supported JSONPath` }
  }

  const [first, ...rest] = segments
  const selectedPresentation = typeof first === 'number' ? first : undefined
  const withinPresentation = selectedPresentation === undefined ? segments : rest

  const presentationCount = options.presentationCount ?? 1
  if (selectedPresentation === undefined && presentationCount > 1) {
    return {
      success: false,
      message: `Path '${shorten(descriptor.path)}' does not select one of the ${presentationCount} presentations with '$[n]'`,
    }
  }

  const presentationIndex = selectedPresentation ?? 0
  let credentialIndex: number | undefined

  if (withinPresentation.length > 0) {
    // A path that reaches into the presentation addresses a credential in it. Without a presentation
    // index this is the embedded form: the submission sits inside the presentation, so there is only one.
    credentialIndex = trailingIndex(withinPresentation)
    if (credentialIndex === undefined) {
      return {
        success: false,
        message: `Path '${shorten(descriptor.path)}' does not address a presentation or a credential within one`,
      }
    }
  }

  if (descriptor.path_nested !== undefined) {
    if (credentialIndex !== undefined) {
      return {
        success: false,
        message: `Path '${shorten(descriptor.path)}' already addresses a credential, so 'path_nested' is contradictory`,
      }
    }

    const nestedPath = descriptor.path_nested.path
    const nestedSegments = segmentsOf(nestedPath)
    if (nestedSegments === undefined) {
      return { success: false, message: `Nested path '${shorten(nestedPath)}' is not a supported JSONPath` }
    }

    const [nestedFirst, ...nestedRest] = nestedSegments
    const fromRoot = typeof nestedFirst === 'number' && nestedRest.length > 0
    if (fromRoot && nestedFirst !== presentationIndex) {
      return {
        success: false,
        message: `Nested path '${shorten(nestedPath)}' selects presentation ${nestedFirst}, but path '${shorten(descriptor.path)}' selects presentation ${presentationIndex}`,
      }
    }

    credentialIndex = trailingIndex(fromRoot ? nestedRest : nestedSegments)
    if (credentialIndex === undefined) {
      return {
        success: false,
        message: `Nested path '${shorten(nestedPath)}' does not select a single credential`,
      }
    }

    if (descriptor.path_nested.path_nested !== undefined) {
      return { success: false, message: 'Nesting deeper than one level is not supported' }
    }
  }

  return { success: true, location: { presentation_index: presentationIndex, credential_index: credentialIndex } }
}
