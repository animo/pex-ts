import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { safeParsePresentationDefinition } from './m-presentation-definition.js'
import { getPresentationDefinitionIssues } from './validate-definition.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/dif-pe-examples')

/**
 * Fixtures expected not to parse. All of them use `pattern`, which this library rejects by design (see the
 * README), and `input_descriptor_filter_examples.json` also uses `"path": ["A"]` as a placeholder, not a
 * JSONPath under any implementation. The rejection must name `pattern`, so that a fixture failing for any
 * other reason is noticed.
 */
const expectedFailures = new Set([
  'pdV1/input_descriptor_filter_examples.json',
  'pdV1/input_descriptor_filter_simple_example.json',
  'pdV1/input_descriptor_id_token_example.json',
  'pdV1/input_descriptor_simple_example.json',
  'pdV1/pd-schema-invalid-predicates.json',
  'pdV1/sr_all_rule.json',
  'pdV1/sr_basic.json',
  'pdV1/sr_pick_rule.json',
  'pdV1/sr_pick_rule_from_nested.json',
  'pdV1/sr_pick_rule_min_2.json',
  'pdV2/pd-multi-sd-jwt-vp.json',
  'pdV2/pd_basic_example(corrected).json',
  'pdV2/pd_multi_group_example(corrected).json',
  'pdV2/pd_single_group_example(corrected).json',
])

function loadFixtures(version: 'pdV1' | 'pdV2') {
  return readdirSync(join(fixturesDir, version))
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const contents = JSON.parse(readFileSync(join(fixturesDir, version, file), 'utf8'))
      // The examples wrap the definition in various envelopes.
      const definition = contents.presentation_definition ?? contents
      return { name: `${version}/${file}`, definition }
    })
}

describe('DIF presentation exchange examples', () => {
  const v1 = loadFixtures('pdV1')
  const v2 = loadFixtures('pdV2')

  it('finds the fixtures', () => {
    expect(v1.length).toBeGreaterThan(15)
    expect(v2.length).toBeGreaterThan(5)
  })

  it.each(v1)('parses $name as v1', ({ name, definition }) => {
    const result = safeParsePresentationDefinition(definition)

    if (expectedFailures.has(name)) {
      expect(result.success).toBe(false)
      expect(result.success ? '' : result.message).toContain('"pattern"')
      return
    }

    if (!result.success) expect.unreachable(result.message)
    expect(result.version).toBe('v1')
  })

  it.each(v2)('parses $name as v2', ({ name, definition }) => {
    const result = safeParsePresentationDefinition(definition)

    if (expectedFailures.has(name)) {
      expect(result.success).toBe(false)
      expect(result.success ? '' : result.message).toContain('"pattern"')
      return
    }

    if (!result.success) expect.unreachable(result.message)
    expect(result.version).toBe('v2')
  })

  it('reports no semantic issues across the corpus', () => {
    const issues: string[] = []

    for (const { name, definition } of [...v1, ...v2]) {
      if (expectedFailures.has(name)) continue
      const result = safeParsePresentationDefinition(definition)
      if (!result.success) continue

      for (const issue of getPresentationDefinitionIssues(result.definition)) {
        issues.push(`${name} ${issue.path}: ${issue.message}`)
      }
    }

    expect(issues).toEqual([])
  })
})
