import { z } from 'zod'
import { PexParseError } from '../pex-error/e-pex.js'
import { exceedsMaxDepth, maxDepthError } from '../u-model.js'
import { zFormat } from './m-format.js'
import { zInputDescriptorV1, zInputDescriptorV2 } from './m-input-descriptor.js'
import { zSubmissionRequirement } from './m-submission-requirement.js'

export const pexVersions = ['v1', 'v2'] as const
export type PexVersion = (typeof pexVersions)[number]

const presentationDefinitionBase = {
  id: z.string(),
  name: z.string().optional(),
  purpose: z.string().optional(),
  format: zFormat.optional(),
  submission_requirements: z.array(zSubmissionRequirement).optional(),
}

export const zPresentationDefinitionV1 = z.strictObject({
  ...presentationDefinitionBase,
  // Not `.nonempty()`: neither spec schema sets `minItems`, and a fixture in the DIF examples
  // relies on an empty array being valid. A definition asking for nothing is vacuously
  // satisfiable, which evaluation reports rather than parsing rejecting.
  input_descriptors: z.array(zInputDescriptorV1),
})
export type PresentationDefinitionV1 = z.output<typeof zPresentationDefinitionV1>

export const zPresentationDefinitionV2 = z.strictObject({
  ...presentationDefinitionBase,
  input_descriptors: z.array(zInputDescriptorV2),
  frame: z.record(z.string(), z.unknown()).optional(),
})
export type PresentationDefinitionV2 = z.output<typeof zPresentationDefinitionV2>

export const zPresentationDefinition = z.union([zPresentationDefinitionV1, zPresentationDefinitionV2])
export type PresentationDefinition = PresentationDefinitionV1 | PresentationDefinitionV2

export type ParsedPresentationDefinition =
  | { version: 'v1'; definition: PresentationDefinitionV1 }
  | { version: 'v2'; definition: PresentationDefinitionV2 }

export type SafeParsedPresentationDefinition =
  | ({ success: true } & ParsedPresentationDefinition)
  | { success: false; message: string; v1Error: z.ZodError; v2Error: z.ZodError }

/**
 * Parse a definition and determine which version it is, in one pass.
 *
 * The two versions are mutually exclusive by construction: v1 requires `schema` on every input
 * descriptor and v2 forbids it (both models reject unknown properties), so at most one can
 * match. When neither does, both sets of issues are reported — a definition that is *almost*
 * valid v2 is far easier to fix when you can see the v2 issues rather than a merged union error.
 */
export function safeParsePresentationDefinition(input: unknown): SafeParsedPresentationDefinition {
  if (exceedsMaxDepth(input)) {
    const error = maxDepthError()
    return { success: false, v1Error: error, v2Error: error, message: z.prettifyError(error) }
  }

  const v1 = zPresentationDefinitionV1.safeParse(input)
  if (v1.success) return { success: true, version: 'v1', definition: v1.data }

  const v2 = zPresentationDefinitionV2.safeParse(input)
  if (v2.success) return { success: true, version: 'v2', definition: v2.data }

  return {
    success: false,
    v1Error: v1.error,
    v2Error: v2.error,
    message: [
      'Presentation definition is not valid against either version.',
      '',
      'v1 issues:',
      z.prettifyError(v1.error),
      '',
      'v2 issues:',
      z.prettifyError(v2.error),
    ].join('\n'),
  }
}

/**
 * Parse a definition, throwing {@link PexParseError} if it matches neither version.
 */
export function parsePresentationDefinition(input: unknown): ParsedPresentationDefinition {
  const result = safeParsePresentationDefinition(input)
  if (result.success) return { version: result.version, definition: result.definition } as ParsedPresentationDefinition

  throw new PexParseError({ message: result.message, cause: result.v2Error })
}

/**
 * Determine a definition's version without re-validating it in full.
 */
export function discoverPresentationDefinitionVersion(input: unknown): PexVersion {
  return parsePresentationDefinition(input).version
}
