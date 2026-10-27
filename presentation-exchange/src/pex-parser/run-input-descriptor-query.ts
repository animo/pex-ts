import type { PexCredential } from '../pex-credential/u-pex-credential.js'
import type {
  CredentialMatch,
  CredentialMismatch,
  InputDescriptorResult,
} from '../pex-query-result/m-pex-query-result.js'
import type { InputDescriptor } from '../presentation-definition/m-input-descriptor.js'
import type { PresentationDefinition } from '../presentation-definition/m-presentation-definition.js'
import { evaluateCredential } from './evaluate-credential.js'
import { buildLimitDisclosure } from './limit-disclosure.js'
import { compileFields } from './run-fields-query.js'

/**
 * Evaluate one input descriptor against every candidate credential.
 */
export function runInputDescriptorQuery(
  definition: PresentationDefinition,
  inputDescriptor: InputDescriptor,
  inputDescriptorIndex: number,
  credentials: PexCredential[]
): InputDescriptorResult {
  // Paths depend only on the definition, so they are parsed once for all credentials.
  const compiled = compileFields(inputDescriptor.constraints?.fields)

  const matching: CredentialMatch[] = []
  const nonMatching: CredentialMismatch[] = []

  for (const [credentialIndex, credential] of credentials.entries()) {
    const { matches, reasons } = evaluateCredential(definition, inputDescriptor, compiled, credential, {
      presentation: false,
    })

    if (reasons.length > 0) {
      nonMatching.push({ credential_index: credentialIndex, format: credential.credential_format, reasons })
      continue
    }

    matching.push({
      credential_index: credentialIndex,
      format: credential.credential_format,
      fields: matches,
      disclosure: buildLimitDisclosure(credential, matches),
    })
  }

  return {
    input_descriptor_id: inputDescriptor.id,
    input_descriptor_index: inputDescriptorIndex,
    name: inputDescriptor.name,
    purpose: inputDescriptor.purpose,
    group: inputDescriptor.group,
    satisfied: matching.length > 0,
    matching_credentials: matching,
    non_matching_credentials: nonMatching,
  }
}
