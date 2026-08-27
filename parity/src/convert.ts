import { createHash } from 'node:crypto'
import { decodeSdJwtSync, getClaimsSync } from '@sd-jwt/decode'
import type { PexCredential } from '../../dif-pex/src/index.js'

const hasher = (data: string | ArrayBuffer, algorithm: string) =>
  new Uint8Array(
    createHash(algorithm.replace('-', '').toLowerCase())
      .update(Buffer.from(data as never))
      .digest()
  )

/**
 * The two representations of one credential: what the deprecated implementation takes (an
 * encoded or raw credential, which it decodes itself) and what this one takes (already-decoded
 * claims).
 */
export interface CredentialPair {
  name: string
  /** Passed to `@animo-id/pex`, which decodes it. */
  original: unknown
  /** Passed to `@animo-id/dif-pex`. */
  parsed: PexCredential
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function fromCompactSdJwt(name: string, compact: string): CredentialPair {
  const { jwt, disclosures } = decodeSdJwtSync(compact, hasher)
  const claims = getClaimsSync(jwt.payload, disclosures, hasher) as Record<string, unknown>

  return {
    name,
    original: compact,
    parsed: { credential_format: 'vc+sd-jwt', claims: claims as never },
  }
}

function fromCompactJwt(name: string, compact: string): CredentialPair {
  const payload = compact.split('.')[1]
  if (payload === undefined) throw new Error(`${name} is not a JWT`)

  // The deprecated implementation exposes the whole payload for path matching, with the
  // credential under `vc`, so definitions address both `$.iss` and `$.vc.issuer`.
  return {
    name,
    original: compact,
    parsed: { credential_format: 'jwt_vc', claims: JSON.parse(decodeBase64Url(payload)) as never },
  }
}

/**
 * Convert a fixture into both representations.
 *
 * This is the only place the harness decodes anything, and it deliberately uses the *same*
 * decoding the deprecated implementation performs internally — including its `@sd-jwt` version —
 * so that the comparison isolates matching behaviour rather than decoding behaviour.
 *
 * Returns several pairs for a fixture that holds several credentials, and none for a fixture
 * that is not a credential at all.
 */
export function toCredentialPairs(name: string, contents: string): CredentialPair[] {
  const trimmed = contents.trim()

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>

    // Some fixtures are containers of encoded credentials rather than credentials themselves.
    if (Array.isArray(parsed.vcs)) {
      return parsed.vcs
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry, index) => fromCompactSdJwt(`${name}#${index}`, entry))
    }

    return [
      {
        name,
        original: parsed,
        parsed: { credential_format: 'ldp_vc', claims: parsed as never },
      },
    ]
  }

  // Compact SD-JWT: a JWT followed by tilde-separated disclosures.
  if (trimmed.includes('~')) return [fromCompactSdJwt(name, trimmed)]

  return [fromCompactJwt(name, trimmed)]
}
