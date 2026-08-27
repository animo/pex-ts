import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type CredentialPair, toCredentialPairs } from './convert.js'
import { formatMatchMap, runNew, runOld } from './matches.js'

const definitionsDir = fileURLToPath(new URL('../../dif-pex/fixtures/dif-pe-examples', import.meta.url))
const credentialsDir = fileURLToPath(new URL('../fixtures/vc', import.meta.url))

function loadDefinitions() {
  return (['pdV1', 'pdV2'] as const).flatMap((version) =>
    readdirSync(join(definitionsDir, version))
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const contents = JSON.parse(readFileSync(join(definitionsDir, version, file), 'utf8'))
        return { name: `${version}/${file}`, definition: contents.presentation_definition ?? contents }
      })
  )
}

function loadCredentials(): CredentialPair[] {
  return readdirSync(credentialsDir).flatMap((file) =>
    toCredentialPairs(file, readFileSync(join(credentialsDir, file), 'utf8'))
  )
}

/**
 * Definitions the deprecated implementation cannot be asked about, so there is nothing to
 * compare. Not divergences.
 */
const notComparable = new Set([
  // Placeholder paths (`"path": ["A"]`) that are not JSONPath under any implementation.
  'pdV1/input_descriptor_filter_examples.json',
])

/**
 * Deliberate behaviour changes, each explained in PARITY.md. Anything not on this list is an
 * accidental divergence and fails the build.
 */
const knownDivergences = [
  // `is_holder: required` is not evaluated, and fails loudly rather than silently passing.
  'pdV1/pd-PermanentResidentCard.json',
  'pdV1/pd_driver_license_name.json',
  // An empty `input_descriptors` requests nothing, so nothing can fail to satisfy it.
  'pdV1/pd_element_must_be_array_example(corrected).json',
].sort()

interface Divergence {
  definition: string
  old: string
  new: string
  oldSatisfied: boolean
  newSatisfied: boolean
  oldError?: string
  newError?: string
}

describe('parity with @animo-id/pex', () => {
  const definitions = loadDefinitions()
  const credentials = loadCredentials()

  it('has a corpus to compare', () => {
    expect(definitions.length).toBeGreaterThan(20)
    expect(credentials.length).toBeGreaterThan(5)
  })

  it('agrees on which credentials satisfy which input descriptors', () => {
    const divergences: Divergence[] = []
    const report: string[] = [
      `definitions: ${definitions.length}`,
      `credentials: ${credentials.map((credential) => credential.name).join(', ')}`,
      '',
    ]

    for (const { name, definition } of definitions) {
      if (notComparable.has(name)) continue

      const oldOutcome = runOld(definition, credentials)
      const newOutcome = runNew(definition, credentials)

      const oldFormatted = formatMatchMap(oldOutcome.matches)
      const newFormatted = formatMatchMap(newOutcome.matches)
      const agrees = oldFormatted === newFormatted && oldOutcome.satisfied === newOutcome.satisfied

      // Both implementations matching nothing is agreement, but weak evidence — flag it so the
      // report does not read as more coverage than it is.
      const vacuous = !oldOutcome.satisfied && !newOutcome.satisfied && !/\[\d/.test(oldFormatted + newFormatted)

      report.push(`${agrees ? (vacuous ? 'OK? ' : 'OK  ') : 'DIFF'} ${name}`)
      if (!agrees) {
        report.push(`       old (${oldOutcome.satisfied}): ${oldFormatted || '<none>'}`)
        if (oldOutcome.error) report.push(`       old error: ${oldOutcome.error}`)
        report.push(`       new (${newOutcome.satisfied}): ${newFormatted || '<none>'}`)
        if (newOutcome.error) report.push(`       new error: ${newOutcome.error}`)

        divergences.push({
          definition: name,
          old: oldFormatted,
          new: newFormatted,
          oldSatisfied: oldOutcome.satisfied,
          newSatisfied: newOutcome.satisfied,
          oldError: oldOutcome.error,
          newError: newOutcome.error,
        })
      }
    }

    writeFileSync('/tmp/parity-report.txt', report.join('\n'))

    // Every divergence must be a deliberate behaviour change, explained in PARITY.md.
    expect(divergences.map((divergence) => divergence.definition).sort()).toEqual(knownDivergences)
  })

  it('reports how much of the agreement is substantive', () => {
    let substantive = 0
    let vacuous = 0

    for (const { name, definition } of definitions) {
      if (notComparable.has(name) || knownDivergences.includes(name)) continue

      const matched = [runOld(definition, credentials), runNew(definition, credentials)].some((outcome) =>
        [...outcome.matches.values()].some((indices) => indices.size > 0)
      )

      if (matched) substantive++
      else vacuous++
    }

    // Both implementations matching nothing is agreement, but weak evidence. Asserting the
    // split keeps the harness honest: if fixtures are added, this number must be raised, and if
    // coverage silently regresses, this fails.
    expect({ substantive, vacuous }).toEqual({ substantive: 7, vacuous: 18 })
  })
})
