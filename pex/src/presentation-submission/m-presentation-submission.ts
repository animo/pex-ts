import { z } from 'zod'
import type { PexCredentialFormat } from '../pex-credential/u-pex-credential.js'
import type { InferModelTypes } from '../u-model.js'
import { ModelDefinition } from '../u-model.js'

/** `path_nested` refers back to this schema through a getter, which is how zod 4 defines a recursive type. */
export const zDescriptor: z.ZodType<Descriptor> = z.strictObject({
  id: z.string(),
  format: z.string(),
  path: z.string(),
  get path_nested() {
    return zDescriptor.optional()
  },
})

export interface Descriptor {
  /** The id of the input descriptor this entry satisfies. */
  id: string
  format: string
  path: string
  path_nested?: Descriptor
}

export const zPresentationSubmission = z.strictObject({
  id: z.string(),
  definition_id: z.string(),
  descriptor_map: z.array(zDescriptor),
})
export type PresentationSubmission = z.output<typeof zPresentationSubmission>

export const presentationSubmissionModel = new ModelDefinition({ zModel: zPresentationSubmission })
export type PresentationSubmissionModel = InferModelTypes<typeof presentationSubmissionModel>

/**
 * Where the submission travels, which decides how `descriptor_map` paths are written.
 *
 * - `external`: the submission is carried alongside the presentations, as in an OpenID4VP
 *   authorization response. Paths address the presentation(s): `$` for a single one, `$[n]` when
 *   there are several. A credential inside a W3C VP is then addressed by `path_nested`.
 * - `presentation`: the submission is embedded inside a single verifiable presentation. Paths
 *   address the credential within that presentation directly, and there is no `path_nested`.
 */
export const presentationSubmissionLocations = ['external', 'presentation'] as const
export type PresentationSubmissionLocation = (typeof presentationSubmissionLocations)[number]

/**
 * The presentation format a credential of the given format is presented in, and the path at
 * which credentials sit inside it.
 *
 * SD-JWT VCs and mdocs are presented as themselves — the presentation *is* the credential — so
 * they nest nothing. W3C credentials are wrapped in a verifiable presentation, and where that
 * wrapper puts them differs between the JWT and Linked Data encodings.
 */
export function getPresentationFormat(format: PexCredentialFormat): {
  presentationFormat: string
  nestedCredentialPath?: string
} {
  switch (format) {
    case 'di_vc':
    case 'di':
      return { presentationFormat: 'di_vp', nestedCredentialPath: '$.verifiableCredential' }
    case 'ldp_vc':
    case 'ldp':
      return { presentationFormat: 'ldp_vp', nestedCredentialPath: '$.verifiableCredential' }
    case 'jwt_vc_json':
      return { presentationFormat: 'jwt_vp_json', nestedCredentialPath: '$.vp.verifiableCredential' }
    case 'jwt_vc':
    case 'jwt':
      return { presentationFormat: 'jwt_vp', nestedCredentialPath: '$.vp.verifiableCredential' }
    case 'vc+sd-jwt':
      return { presentationFormat: 'vc+sd-jwt' }
    case 'dc+sd-jwt':
      return { presentationFormat: 'dc+sd-jwt' }
    case 'mso_mdoc':
      return { presentationFormat: 'mso_mdoc' }
  }
}
