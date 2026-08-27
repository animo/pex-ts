import type { PexCredentialFormat } from '../pex-credential/u-pex-credential.js'
import { PexInvalidSubmissionError } from '../pex-error/e-pex.js'
import type { PresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import type { Descriptor, PresentationSubmission, PresentationSubmissionLocation } from './m-presentation-submission.js'
import { getPresentationFormat } from './m-presentation-submission.js'

export interface PresentationSubmissionEntry {
  /** The input descriptor this entry satisfies. Must exist in the definition. */
  input_descriptor_id: string
  /** The format of the credential being presented, not of the presentation wrapping it. */
  format: PexCredentialFormat
  /**
   * Which presentation carries it. Omit when there is exactly one presentation, which writes the
   * path as `$` rather than `$[0]`.
   */
  presentation_index?: number
  /**
   * Where the credential sits inside a W3C verifiable presentation. Defaults to 0. Ignored for
   * formats that are presented as themselves (SD-JWT VC, mdoc).
   */
  credential_index?: number
}

export interface CreatePresentationSubmissionOptions {
  /**
   * The submission's id. Required: this library generates no identifiers, so that it needs no
   * randomness source and stays deterministic — the previous implementation pulled in `nanoid`
   * for this alone.
   */
  id: string
  entries: PresentationSubmissionEntry[]
  /** Defaults to `external`, which is what OpenID4VP uses. */
  location?: PresentationSubmissionLocation
}

/**
 * Build a presentation submission for a set of chosen credentials.
 *
 * This is a pure function of its inputs. Which credential satisfies which input descriptor is the
 * caller's decision — run the query first, then pass the choices here.
 */
export function createPresentationSubmission(
  definition: PresentationDefinition,
  options: CreatePresentationSubmissionOptions
): PresentationSubmission {
  const { id, entries, location = 'external' } = options

  const knownIds = new Set(definition.input_descriptors.map((inputDescriptor) => inputDescriptor.id))
  const unknown = entries
    .map((entry) => entry.input_descriptor_id)
    .filter((inputDescriptorId) => !knownIds.has(inputDescriptorId))

  if (unknown.length > 0) {
    throw new PexInvalidSubmissionError({
      message: `Submission references input descriptor id${unknown.length === 1 ? '' : 's'} '${unknown.join("', '")}' which the definition does not declare`,
    })
  }

  const descriptorMap = entries.map((entry): Descriptor => {
    const { presentationFormat, nestedCredentialPath } = getPresentationFormat(entry.format)
    const credentialIndex = entry.credential_index ?? 0

    if (location === 'presentation') {
      // The submission lives inside the presentation, so the path is already relative to it and
      // there is nothing left to nest. A format presented as itself sits at the root.
      return {
        id: entry.input_descriptor_id,
        format: entry.format,
        path: nestedCredentialPath === undefined ? '$' : `$.verifiableCredential[${credentialIndex}]`,
      }
    }

    const path = entry.presentation_index === undefined ? '$' : `$[${entry.presentation_index}]`

    if (nestedCredentialPath === undefined) {
      return { id: entry.input_descriptor_id, format: presentationFormat, path }
    }

    return {
      id: entry.input_descriptor_id,
      format: presentationFormat,
      path,
      path_nested: {
        id: entry.input_descriptor_id,
        format: entry.format,
        path: `${nestedCredentialPath}[${credentialIndex}]`,
      },
    }
  })

  return { id, definition_id: definition.id, descriptor_map: descriptorMap }
}
