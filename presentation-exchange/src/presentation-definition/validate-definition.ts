import { parseJsonPath } from '../json-path/parse-json-path.js'
import { PexInvalidDefinitionError } from '../pex-error/e-pex.js'
import { getAllowedCredentialFormats } from './m-format.js'
import type { InputDescriptor } from './m-input-descriptor.js'
import type { PresentationDefinition } from './m-presentation-definition.js'
import type { SubmissionRequirement } from './m-submission-requirement.js'

/**
 * A single semantic problem with a definition. Structural problems (wrong types, unknown
 * properties, unparseable paths) are already caught by the models; these are the constraints
 * that only make sense once the whole document is in view.
 */
export interface DefinitionIssue {
  /** Where the problem is, as a JSONPath into the definition. */
  path: string
  message: string
}

function collectGroups(inputDescriptors: InputDescriptor[]): Set<string> {
  const groups = new Set<string>()
  for (const inputDescriptor of inputDescriptors) {
    for (const group of inputDescriptor.group ?? []) groups.add(group)
  }
  return groups
}

/**
 * ISO 18013-7 requires each path of an mdoc input descriptor to name one data element,
 * `$['<namespace>']['<data element identifier>']`, as an mdoc discloses whole data elements.
 */
function validateMdocPaths(inputDescriptor: InputDescriptor, path: string, issues: DefinitionIssue[]) {
  const fields = 'constraints' in inputDescriptor ? (inputDescriptor.constraints?.fields ?? []) : []

  for (const [fieldIndex, field] of fields.entries()) {
    for (const [pathIndex, fieldPath] of field.path.entries()) {
      const segments = parseJsonPath(fieldPath)
      if (segments.length === 2 && segments.every((segment) => typeof segment === 'string')) continue

      issues.push({
        path: `${path}.constraints.fields[${fieldIndex}].path[${pathIndex}]`,
        message: `An mdoc path names one data element, $['<namespace>']['<data element identifier>'] (ISO 18013-7), not '${fieldPath}'`,
      })
    }
  }
}

function validateSubmissionRequirement(
  requirement: SubmissionRequirement,
  groups: Set<string>,
  path: string,
  issues: DefinitionIssue[]
) {
  if (requirement.from !== undefined && !groups.has(requirement.from)) {
    issues.push({
      path: `${path}.from`,
      message: `References group '${requirement.from}', which no input descriptor declares`,
    })
  }

  // Bounds that contradict each other are structurally valid per the spec schema but can never
  // be satisfied, so they are reported here rather than rejected at parse time.
  const { count, min, max } = requirement
  if (min !== undefined && max !== undefined && min > max) {
    issues.push({ path: `${path}.min`, message: `'min' (${min}) is greater than 'max' (${max})` })
  }
  if (count !== undefined && min !== undefined && count < min) {
    issues.push({ path: `${path}.count`, message: `'count' (${count}) is less than 'min' (${min})` })
  }
  if (count !== undefined && max !== undefined && count > max) {
    issues.push({ path: `${path}.count`, message: `'count' (${count}) is greater than 'max' (${max})` })
  }

  requirement.from_nested?.forEach((nested, index) => {
    validateSubmissionRequirement(nested, groups, `${path}.from_nested[${index}]`, issues)
  })
}

/**
 * Collect every semantic problem with a definition. Returns an empty array when it is valid.
 *
 * Unlike the previous implementation this reports *all* issues rather than stopping at the
 * first, so a verifier fixing a definition sees the whole list at once.
 */
export function getPresentationDefinitionIssues(definition: PresentationDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = []

  const allowed = definition.format === undefined ? undefined : getAllowedCredentialFormats(definition.format)

  const seenIds = new Set<string>()
  for (const [index, inputDescriptor] of definition.input_descriptors.entries()) {
    if (seenIds.has(inputDescriptor.id)) {
      issues.push({
        path: `$.input_descriptors[${index}].id`,
        message: `Duplicate input descriptor id '${inputDescriptor.id}'`,
      })
    }
    seenIds.add(inputDescriptor.id)

    // A per-descriptor format may only narrow the definition-level one. Widening it would let a
    // descriptor admit a credential format the definition as a whole rejects. The two are compared by the
    // credential formats they admit, so a descriptor naming `ldp_vc` under a definition naming `ldp_vp`
    // narrows rather than widens, and a definition admitting any format can't be widened.
    const descriptorFormat = 'format' in inputDescriptor ? inputDescriptor.format : undefined
    if (descriptorFormat !== undefined && allowed !== undefined) {
      const requested = getAllowedCredentialFormats(descriptorFormat) ?? []
      const widened = requested.filter((designation) => !allowed.includes(designation))

      if (widened.length > 0) {
        issues.push({
          path: `$.input_descriptors[${index}].format`,
          message:
            `Admits credential format${widened.length === 1 ? '' : 's'} '${widened.join("', '")}' ` +
            `which the definition-level format does not ('${allowed.join("', '")}')`,
        })
      }
    }

    const effectiveFormat = descriptorFormat ?? definition.format
    if (effectiveFormat !== undefined && getAllowedCredentialFormats(effectiveFormat)?.includes('mso_mdoc')) {
      validateMdocPaths(inputDescriptor, `$.input_descriptors[${index}]`, issues)
    }
  }

  const groups = collectGroups(definition.input_descriptors)
  definition.submission_requirements?.forEach((requirement, index) => {
    validateSubmissionRequirement(requirement, groups, `$.submission_requirements[${index}]`, issues)
  })

  return issues
}

/**
 * Throw {@link PexInvalidDefinitionError} if the definition has any semantic problem.
 */
export function validatePresentationDefinition(definition: PresentationDefinition): void {
  const issues = getPresentationDefinitionIssues(definition)
  if (issues.length === 0) return

  throw new PexInvalidDefinitionError({
    message: `Invalid presentation definition:\n${issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`,
  })
}
