import { z } from 'zod'
import type { InferModelTypes } from '../u-model.js'
import { ModelDefinition } from '../u-model.js'

export const zJwtObject = z.strictObject({
  alg: z.array(z.string()).nonempty(),
})

export const zLdpObject = z.strictObject({
  proof_type: z.array(z.string()).nonempty(),
})

export const zDiObject = z.strictObject({
  proof_type: z.array(z.string()).nonempty(),
  cryptosuite: z.array(z.string()).nonempty(),
})

export const zSdJwtObject = z.strictObject({
  'sd-jwt_alg_values': z.array(z.string()).nonempty().optional(),
  'kb-jwt_alg_values': z.array(z.string()).nonempty().optional(),
})

export const zMsoMdocObject = z.strictObject({
  alg: z.array(z.string()).nonempty(),
})

/**
 * The claim format designations a definition or input descriptor accepts.
 *
 * `dc+sd-jwt` is included alongside `vc+sd-jwt` even though `pex-models` only knows the latter:
 * the SD-JWT VC media type was renamed, and definitions in the wild use both.
 */
export const zFormat = z
  .strictObject({
    jwt: zJwtObject.optional(),
    jwt_vc: zJwtObject.optional(),
    jwt_vc_json: zJwtObject.optional(),
    jwt_vp: zJwtObject.optional(),
    jwt_vp_json: zJwtObject.optional(),
    ldp: zLdpObject.optional(),
    ldp_vc: zLdpObject.optional(),
    ldp_vp: zLdpObject.optional(),
    di: zDiObject.optional(),
    di_vc: zDiObject.optional(),
    di_vp: zDiObject.optional(),
    'vc+sd-jwt': zSdJwtObject.optional(),
    'dc+sd-jwt': zSdJwtObject.optional(),
    mso_mdoc: zMsoMdocObject.optional(),
  })
  .refine((format) => Object.keys(format).length > 0, {
    error: 'A format object must designate at least one claim format',
  })

export type Format = z.output<typeof zFormat>

/** Every claim format designation a `format` object may key. */
export const formatDesignations = [
  'jwt',
  'jwt_vc',
  'jwt_vc_json',
  'jwt_vp',
  'jwt_vp_json',
  'ldp',
  'ldp_vc',
  'ldp_vp',
  'di',
  'di_vc',
  'di_vp',
  'vc+sd-jwt',
  'dc+sd-jwt',
  'mso_mdoc',
] as const

export type FormatDesignation = (typeof formatDesignations)[number]

/**
 * The designations that name a *credential* format.
 *
 * `jwt`, `ldp` and `di` are the bare designations, which address credentials. `vc+sd-jwt`, `dc+sd-jwt` and
 * `mso_mdoc` name both a credential and a presentation format, because those formats are presented as
 * themselves. The other designations name presentation formats, see {@link getAllowedCredentialFormats}.
 */
export const credentialFormatDesignations = [
  'jwt',
  'jwt_vc',
  'jwt_vc_json',
  'ldp',
  'ldp_vc',
  'di',
  'di_vc',
  'vc+sd-jwt',
  'dc+sd-jwt',
  'mso_mdoc',
] as const satisfies readonly FormatDesignation[]

export type CredentialFormatDesignation = (typeof credentialFormatDesignations)[number]

export function isCredentialFormatDesignation(
  designation: FormatDesignation
): designation is CredentialFormatDesignation {
  return (credentialFormatDesignations as readonly string[]).includes(designation)
}

/** The designations that name a presentation format only: a credential is never one of these. */
export type PresentationFormatDesignation = Exclude<FormatDesignation, CredentialFormatDesignation>

/**
 * The credentials a presentation designation admits: the formats a presentation of that kind carries. A JWT
 * presentation carries JWT credentials, under either of their designations; a Linked Data presentation Linked
 * Data credentials; a Data Integrity presentation Data Integrity credentials. SD-JWT VCs and mdocs are presented
 * as themselves, so no presentation designation admits them.
 */
const presentationDesignationCredentials: Record<
  PresentationFormatDesignation,
  readonly CredentialFormatDesignation[]
> = {
  jwt_vp: ['jwt', 'jwt_vc', 'jwt_vc_json'],
  jwt_vp_json: ['jwt', 'jwt_vc', 'jwt_vc_json'],
  ldp_vp: ['ldp', 'ldp_vc'],
  di_vp: ['di', 'di_vc'],
}

/**
 * The credential formats a `format` object admits, or `undefined` when it names none and so admits any.
 *
 * A designation names a credential format directly, or a presentation format, which admits the credentials
 * such a presentation carries. A definition commonly says `{"ldp_vp": {"proof_type": [...]}}` to state which
 * presentation encodings the verifier accepts: that admits a Linked Data credential, and not an mdoc or an
 * SD-JWT VC, which could never be presented that way. The algorithm or proof type restriction of a
 * presentation designation is on the presentation, and is not applied to the credentials it admits.
 */
export function getAllowedCredentialFormats(format: Format): CredentialFormatDesignation[] | undefined {
  const allowed = new Set<CredentialFormatDesignation>()
  for (const designation of formatDesignations) {
    if (format[designation] === undefined) continue
    if (isCredentialFormatDesignation(designation)) allowed.add(designation)
    else for (const credential of presentationDesignationCredentials[designation]) allowed.add(credential)
  }
  return allowed.size === 0 ? undefined : [...allowed]
}

export const formatModel = new ModelDefinition({ zModel: zFormat })
export type FormatModel = InferModelTypes<typeof formatModel>
