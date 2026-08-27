import type { PathComponent } from './m-json-path.js'

/**
 * Render a concrete path back to a JSONPath string, always in bracket form.
 *
 * Bracket form is used unconditionally so that keys needing quoting (`@context`,
 * `org.iso.18013.5.1`) and keys not needing it round-trip through the same code path — the old
 * Sphereon implementation carried ~40 lines of regex surgery to retrofit brackets onto dot paths
 * its parser could not handle.
 *
 * @example stringifyJsonPath(['credentialSubject', 'account', 0, 'id'])
 * // "$['credentialSubject']['account'][0]['id']"
 */
export function stringifyJsonPath(path: readonly PathComponent[]): string {
  let result = '$'

  for (const component of path) {
    if (typeof component === 'number') {
      result += `[${component}]`
      continue
    }
    result += `['${component.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
  }

  return result
}
