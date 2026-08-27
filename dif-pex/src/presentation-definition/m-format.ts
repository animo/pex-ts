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
 * A `format` object may mix credential and presentation designations — a definition commonly
 * says `{"ldp_vp": {...}}` to state what presentation encodings the verifier accepts, which says
 * nothing about the credentials inside. Only these designations can restrict a credential; a
 * `format` naming none of them imposes no credential-level restriction at all.
 *
 * `jwt`, `ldp` and `di` are the bare designations, which address credentials.
 * `vc+sd-jwt`, `dc+sd-jwt` and `mso_mdoc` appear in both lists because those formats are
 * presented as themselves.
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

export function isCredentialFormatDesignation(designation: FormatDesignation): boolean {
  return (credentialFormatDesignations as readonly string[]).includes(designation)
}

export const formatModel = new ModelDefinition({ zModel: zFormat })
export type FormatModel = InferModelTypes<typeof formatModel>
