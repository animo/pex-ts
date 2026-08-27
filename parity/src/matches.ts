import { createHash } from 'node:crypto'
import { PEX } from '@animo-id/pex'
import { parsePresentationDefinition, queryPresentationDefinition } from '../../dif-pex/src/index.js'
import type { CredentialPair } from './convert.js'

/** The deprecated implementation decodes SD-JWTs itself, and needs a hasher to do it. */
const hasher = (data: string | ArrayBuffer, algorithm: string) =>
  new Uint8Array(
    createHash(algorithm.replace('-', '').toLowerCase())
      .update(Buffer.from(data as never))
      .digest()
  )

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * The one thing both implementations agree on the shape of: which input descriptors were
 * satisfied, by which of the credentials handed in.
 *
 * Result *structures* differ by design, so the harness compares this projection rather than
 * diffing objects. Keys are input descriptor ids; values are indices into the credential array.
 */
export type MatchMap = Map<string, Set<number>>

export interface Outcome {
  matches: MatchMap
  satisfied: boolean
  error?: string
}

export function formatMatchMap(map: MatchMap): string {
  return [...map.entries()]
    .map(([id, indices]) => `${id}: [${[...indices].sort((a, b) => a - b).join(', ')}]`)
    .sort()
    .join('; ')
}

/** `$.verifiableCredential[3]` -> 3 */
function indexFromVcPath(path: string): number | undefined {
  const match = /\[(\d+)\]/.exec(path)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

// biome-ignore lint/suspicious/noExplicitAny: walking the deprecated implementation's union type
function collectOldMatches(matches: any[], vcIndexes: number[] | undefined, into: MatchMap) {
  for (const match of matches ?? []) {
    if (match.type === 'InputDescriptor') {
      const indices = into.get(match.id) ?? new Set<number>()
      for (const vcPath of match.vc_path ?? []) {
        const selectableIndex = indexFromVcPath(vcPath)
        if (selectableIndex === undefined) continue
        // `vc_path` indexes the *selectable* credentials; `vcIndexes` maps back to the input.
        indices.add(vcIndexes?.[selectableIndex] ?? selectableIndex)
      }
      into.set(match.id, indices)
      continue
    }

    if (match.input_descriptors) collectOldMatches(match.input_descriptors, vcIndexes, into)
    if (match.from_nested) collectOldMatches(match.from_nested, vcIndexes, into)
  }
}

export function runOld(definition: unknown, credentials: CredentialPair[]): Outcome {
  const matches: MatchMap = new Map()

  try {
    const result = new PEX({ hasher }).selectFrom(
      definition as never,
      credentials.map((credential) => credential.original) as never
    )
    collectOldMatches(result.matches as never[], result.vcIndexes, matches)
    // `warn` means more credentials matched a descriptor than are needed — ambiguity, not
    // failure. Only `error` means the definition cannot be satisfied.
    return { matches, satisfied: result.areRequiredCredentialsPresent !== 'error' }
  } catch (error) {
    return { matches, satisfied: false, error: describeError(error) }
  }
}

export function runNew(definition: unknown, credentials: CredentialPair[]): Outcome {
  const matches: MatchMap = new Map()

  try {
    const result = queryPresentationDefinition(definition, {
      credentials: credentials.map((credential) => credential.parsed),
    })

    for (const inputDescriptor of result.input_descriptors) {
      matches.set(
        inputDescriptor.input_descriptor_id,
        new Set(inputDescriptor.matching_credentials.map((candidate) => candidate.credential_index))
      )
    }

    return { matches, satisfied: result.can_be_satisfied }
  } catch (error) {
    return { matches, satisfied: false, error: describeError(error) }
  }
}

export { parsePresentationDefinition }
