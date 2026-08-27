import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import type { MismatchReason } from '../pex-query-result/m-pex-query-result.js'
import type { Format, FormatDesignation } from '../presentation-definition/m-format.js'
import { formatDesignations, isCredentialFormatDesignation } from '../presentation-definition/m-format.js'
import type { InputDescriptor } from '../presentation-definition/m-input-descriptor.js'
import type { PresentationDefinition } from '../presentation-definition/m-presentation-definition.js'

/**
 * The format restriction that applies to an input descriptor: its own if it declares one,
 * otherwise the definition-level one. A per-descriptor `format` overrides rather than
 * intersects, which is how the spec reads and how the previous implementation behaved.
 */
export function getEffectiveFormat(
  definition: PresentationDefinition,
  inputDescriptor: InputDescriptor
): Format | undefined {
  const descriptorFormat = 'format' in inputDescriptor ? inputDescriptor.format : undefined
  return descriptorFormat ?? definition.format
}

/**
 * The credential formats a `format` object allows.
 *
 * Presentation designations (`ldp_vp`, `jwt_vp`, …) are filtered out: they constrain the
 * envelope, not the credential inside it, and a credential is never `ldp_vp`. A `format` naming
 * only presentation designations therefore allows any credential — which is what the DIF
 * examples that say `{"ldp_vp": {"proof_type": [...]}}` at the definition level intend.
 */
function credentialDesignationsOf(format: Format): FormatDesignation[] {
  return formatDesignations.filter(
    (designation) => format[designation] !== undefined && isCredentialFormatDesignation(designation)
  )
}

/**
 * Check a credential's format against a restriction.
 *
 * Designations are matched exactly — `jwt_vc` and `jwt_vc_json` are distinct designations and do
 * not stand in for one another. Where the restriction names algorithms, proof types or
 * cryptosuites, a credential that declares its own must intersect with them; a credential that
 * declares none is not rejected, since this library cannot inspect proofs itself.
 */
export function runFormatQuery(
  credential: PexCredential,
  format: Format | undefined
): { success: true } | { success: false; reason: MismatchReason } {
  if (format === undefined) return { success: true }

  const allowed = credentialDesignationsOf(format)
  // Nothing in this `format` addresses credentials, so it cannot reject one.
  if (allowed.length === 0) return { success: true }

  const designation = credential.credential_format as FormatDesignation

  if (!allowed.includes(designation)) {
    return {
      success: false,
      reason: {
        type: 'format',
        allowed,
        message: `Credential format '${designation}' is not allowed; expected one of '${allowed.join("', '")}'`,
      },
    }
  }

  const restriction = format[designation]
  if (restriction === undefined) return { success: true }

  const checks: Array<{ label: string; required: string[] | undefined; declared: string[] | undefined }> = [
    {
      label: 'algorithm',
      required:
        'alg' in restriction
          ? restriction.alg
          : 'sd-jwt_alg_values' in restriction
            ? restriction['sd-jwt_alg_values']
            : undefined,
      declared: credential.algorithms,
    },
    {
      label: 'proof type',
      required: 'proof_type' in restriction ? restriction.proof_type : undefined,
      declared: credential.proof_types,
    },
    {
      label: 'cryptosuite',
      required: 'cryptosuite' in restriction ? restriction.cryptosuite : undefined,
      declared: credential.cryptosuites,
    },
  ]

  for (const { label, required, declared } of checks) {
    // Nothing required, or the credential declares nothing for us to check against.
    if (required === undefined || declared === undefined) continue

    if (!declared.some((value) => required.includes(value))) {
      return {
        success: false,
        reason: {
          type: 'format',
          allowed,
          message:
            `Credential ${label}${declared.length === 1 ? '' : 's'} '${declared.join("', '")}' ` +
            `${declared.length === 1 ? 'is' : 'are'} not among those allowed for '${designation}' ('${required.join("', '")}')`,
        },
      }
    }
  }

  return { success: true }
}
