import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import type { MismatchReason } from '../pex-query-result/m-pex-query-result.js'
import type { Format } from '../presentation-definition/m-format.js'
import { credentialFormatDesignations, getAllowedCredentialFormats } from '../presentation-definition/m-format.js'
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

export interface RunFormatQueryOptions {
  /**
   * Fail a credential that declares no algorithms, proof types, cryptosuites or key binding algorithms
   * where the restriction names some. A verifier knows these for what it received, and skipping the
   * check would silently drop the restriction. A holder can't always know them in advance (a key binding
   * JWT doesn't exist yet), so for a holder an undeclared value is not checked.
   */
  requireDeclared?: boolean
}

/**
 * Check a credential's format against a restriction.
 *
 * Credential designations are matched exactly — `jwt_vc` and `jwt_vc_json` are distinct designations and
 * do not stand in for one another; a caller that treats them as aliases offers the credential under each.
 * A presentation designation admits the credentials such a presentation carries, see
 * {@link getAllowedCredentialFormats}. Where the restriction names algorithms, proof types or cryptosuites
 * for the credential's own designation, a credential that declares its own must intersect with them. See
 * {@link RunFormatQueryOptions.requireDeclared} for a credential that declares none.
 */
export function runFormatQuery(
  credential: PexCredential,
  format: Format | undefined,
  options: RunFormatQueryOptions = {}
): { success: true } | { success: false; reason: MismatchReason } {
  const designation = credential.credential_format
  const allowed = format === undefined ? undefined : getAllowedCredentialFormats(format)

  // ISO 18013-7 requires an mdoc input descriptor to name `mso_mdoc` in its format, which is also what limits its
  // paths to data elements, see `getPresentationDefinitionIssues`
  if (designation === 'mso_mdoc' && allowed === undefined) {
    return {
      success: false,
      reason: {
        type: 'format',
        allowed: [...credentialFormatDesignations],
        message: "An mdoc only matches an input descriptor whose format names 'mso_mdoc', which ISO 18013-7 requires",
      },
    }
  }

  // Nothing in this `format` addresses credentials, so it cannot reject one.
  if (format === undefined || allowed === undefined) return { success: true }

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

  // Admitted through a presentation designation, whose restriction is on the presentation, not the credential
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
    {
      label: 'key binding algorithm',
      required: 'kb-jwt_alg_values' in restriction ? restriction['kb-jwt_alg_values'] : undefined,
      declared: credential.key_binding_algorithms,
    },
  ]

  for (const { label, required, declared } of checks) {
    if (required === undefined) continue

    if (declared === undefined) {
      if (!options.requireDeclared) continue
      return {
        success: false,
        reason: {
          type: 'format',
          allowed,
          message: `'${designation}' restricts the ${label} to '${required.join("', '")}', but the credential does not declare its ${label}`,
        },
      }
    }

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
