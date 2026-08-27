# @animo-id/dif-pex

A lean TypeScript implementation of [DIF Presentation Exchange][spec] v1 and v2.

One runtime dependency ([zod][zod]). No credential parsing, no crypto, no signing, no JSONPath
library, no JSON Schema validator.

```sh
npm install @animo-id/dif-pex
```

## The idea

**You decode credentials; this library matches them.** It never sees a JWT, an SD-JWT, a CBOR
mdoc, or a proof — you pass already-decoded claims, and you get back a description of what
matched and why.

That single constraint is what makes it small. The library it replaces
(`@animo-id/pex`) decodes credentials itself, and so depends on SD-JWT, mdoc, JSON Schema,
JSONPath and W3C credential libraries. Here, deciding *what to disclose* is a pure function over
JSON, and applying that decision belongs to whichever library already owns the format.

## Quick start

```ts
import { queryPresentationDefinition } from '@animo-id/dif-pex'

const result = queryPresentationDefinition(presentationDefinition, {
  credentials: [
    {
      credential_format: 'dc+sd-jwt',
      claims: { vct: 'https://example.com/IdentityCredential', given_name: 'Erika' },
    },
  ],
})

if (result.can_be_satisfied) {
  for (const inputDescriptor of result.input_descriptors) {
    for (const match of inputDescriptor.matching_credentials) {
      console.log(inputDescriptor.input_descriptor_id, '<-', match.credential_index)
    }
  }
}
```

`queryPresentationDefinition` parses, validates and evaluates in one call. It throws
`PexParseError` if the definition is malformed and `PexInvalidDefinitionError` if it is
semantically broken (duplicate ids, a submission requirement naming a group nothing declares).
A credential that simply does not match never throws — that is reported in the result.

To parse once and query many times, split the steps:

```ts
import { parsePresentationDefinition, runPexQuery, validatePresentationDefinition } from '@animo-id/dif-pex'

const parsed = parsePresentationDefinition(presentationDefinition)
validatePresentationDefinition(parsed.definition)

parsed.version // 'v1' | 'v2' — discovered while parsing

const result = runPexQuery(parsed, { credentials })
```

## Credentials

The input model is the part worth understanding. Every credential declares its format, and
carries claims you have already decoded.

```ts
// ISO mdoc. Paths resolve against `namespaces`, so `$['org.iso.18013.5.1']['family_name']`
// works with no special handling.
{
  credential_format: 'mso_mdoc',
  doctype: 'org.iso.18013.5.1.mDL',
  namespaces: { 'org.iso.18013.5.1': { family_name: 'Mustermann' } },
}

// SD-JWT VC. `claims` must be the fully disclosed ("pretty") payload — the library works out
// what to disclose, and cannot un-hide a claim you withheld.
{ credential_format: 'vc+sd-jwt', claims: { vct: '...', given_name: 'Erika' } }
{ credential_format: 'dc+sd-jwt', claims: { /* ... */ } }

// W3C. For a JWT VC pass the JWT payload, with the credential under `vc` — that is the shape
// definitions expect when they list ["$.issuer", "$.vc.issuer", "$.iss"].
{ credential_format: 'ldp_vc', claims: { '@context': [...], credentialSubject: { /* ... */ } } }
```

Every format also accepts optional fields that only some constraints need. They are optional
because most definitions never ask for them — and a constraint that needs one and does not get
it **fails explicitly** rather than quietly passing:

| Field | Needed by |
| --- | --- |
| `issuer`, `subject` | `constraints.subject_is_issuer` |
| `algorithms` | a `format` restriction's `alg` / `sd-jwt_alg_values` |
| `proof_types` | a `format` restriction's `proof_type` |
| `cryptosuites` | a `di*` format restriction's `cryptosuite` |

## Reading the result

The result mirrors Presentation Exchange's own model: input descriptors carry `group`s, and
submission requirements select those groups.

```ts
{
  definition_id: string
  version: 'v1' | 'v2'
  can_be_satisfied: boolean

  input_descriptors: Array<{
    input_descriptor_id: string
    group?: string[]
    satisfied: boolean
    matching_credentials: Array<{ credential_index, format, fields, disclosure? }>
    non_matching_credentials: Array<{ credential_index, format, reasons }>
  }>

  // present only when the definition declares submission requirements
  submission_requirements?: Array<SubmissionRequirementResult>
}
```

### Why a credential did not match

Every applicable reason is reported, not just the first, so a wallet can explain everything at
once:

```ts
for (const mismatch of inputDescriptor.non_matching_credentials) {
  for (const reason of mismatch.reasons) {
    console.log(reason.type, reason.message)
    // field   Value at '$.age' did not satisfy the filter: Expected 16 to be at least 18
    // format  Credential format 'jwt_vc' is not allowed; expected one of 'mso_mdoc'
  }
}
```

`reason.type` is one of `field`, `format`, `schema`, `limit_disclosure`,
`unsupported_constraint`, `subject_is_issuer`, `mdoc_doctype`.

### Submission requirements

The result mirrors the definition's tree rather than enumerating every satisfying combination.
Each node reports how many members are needed and which are available; **you** choose which to
use.

```ts
for (const requirement of result.submission_requirements ?? []) {
  requirement.rule        // 'all' | 'pick'
  requirement.needs_count // group size for `all`, else count ?? min ?? 1
  requirement.satisfied

  if (requirement.from) requirement.input_descriptors // [{ input_descriptor_id, satisfied }]
  else requirement.from_nested                        // recurses
}
```

## Limit disclosure

When an input descriptor sets `constraints.limit_disclosure`, each match carries a `disclosure`.
Nothing is mutated — you apply it with whichever library owns the format.

```ts
const { output, presentation_frame, namespaces } = match.disclosure!
```

- **`output`** — the claims pruned to the matched paths. A preview of what will be disclosed.
  Array indices are preserved (skipped elements become `null`) so paths still resolve.
- **`presentation_frame`** — a path-to-`true` map, the shape `@sd-jwt/present` takes.
- **`namespaces`** — mdoc only: `{ [namespace]: { [element]: intent_to_retain } }`, the shape an
  mdoc device request needs.

```ts
// SD-JWT
import { present } from '@sd-jwt/present'
const disclosed = await present(compactSdJwt, match.disclosure.presentation_frame, hasher)
```

## Presentations

Holder side — build a submission for the credentials you chose:

```ts
import { createPresentationSubmission } from '@animo-id/dif-pex'

const submission = createPresentationSubmission(parsed.definition, {
  id: crypto.randomUUID(), // you supply it; this library carries no randomness source
  location: 'external',    // 'external' (OpenID4VP) | 'presentation' (embedded in the VP)
  entries: [
    { input_descriptor_id: 'identity', format: 'dc+sd-jwt', presentation_index: 0 },
    { input_descriptor_id: 'address', format: 'ldp_vc', presentation_index: 1, credential_index: 0 },
  ],
})
```

Verifier side — check that a submission actually answers the definition:

```ts
import { runPresentationSubmission } from '@animo-id/dif-pex'

const result = runPresentationSubmission(parsed, submission, {
  presentations: [{ credentials: [/* decoded credentials, in descriptor_map order */] }],
})

result.valid       // descriptors resolved, constraints re-checked, requirements met
result.descriptors // per descriptor_map entry
result.issues      // problems with the submission as a whole
```

This does **not** take the submission's word for anything: each entry is re-evaluated against
the input descriptor it claims to satisfy, and the descriptor's self-declared `format` is not
treated as evidence. Verifying the presentations themselves — signatures, holder binding, key
binding JWTs, device signatures — remains yours.

## Not evaluated

`is_holder`, `same_subject` and `statuses` need information this library is never given: holder
binding proofs, subject linkage across credentials, live status list lookups.

They are parsed and carried, and a `preferred` directive passes. But an input descriptor marking
one **`required` fails**, with an `unsupported_constraint` reason.

This is deliberate, and differs from `@animo-id/pex`, which accepts these constraints and
returns success regardless — a silent false claim of compliance. If you rely on one of them, you
must check it yourself.

## Supported JSONPath

A hand-written subset, not a JSONPath library. Filter expressions `[?(...)]` and script
expressions `[(...)]` — which hand a verifier-supplied definition an expression evaluator over
holder data — are **rejected when the definition is parsed**, so an unsupported path surfaces
immediately rather than as a mysterious no-match.

| Supported | |
| --- | --- |
| `$.name`, `$['name']`, `$["name"]` | object key (`@`-prefixed and numeric keys included) |
| `$[0]` | array index |
| `$[*]`, `$.*` | every element of an array, every value of an object |
| `$..name`, `$..['name']` | the key at any depth |

Rejected: `[?(...)]`, `[(...)]`, slices `[1:3]`, unions `[0,1]`, negative indices, bare `$..`.

The helpers are exported if you need them: `parseJsonPath`, `queryJsonPath`, `stringifyJsonPath`,
`isSupportedJsonPath`.

## Filters

`field.filter` is nominally arbitrary JSON Schema. This library supports a **bounded, closed** set
of keywords and **rejects unknown ones when the definition is parsed**.

That is deliberately unlike a real JSON Schema validator, which ignores keywords it does not
recognise. Ignoring an assertion *widens* what matches — a verifier writing a constraint we
quietly drop gets credentials it did not ask for.

Supported: `type`, `const`, `enum`, `pattern`, `format`, `minLength`, `maxLength`, `minimum`,
`maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `formatMinimum`, `formatMaximum`,
`formatExclusiveMinimum`, `formatExclusiveMaximum`, `minItems`, `maxItems`, `uniqueItems`,
`items`, `contains`, `required`, `properties`, `additionalProperties`, `not`, `allOf`, `anyOf`,
`oneOf`. Annotations (`title`, `description`, `$comment`, `default`, `examples`, `$schema`,
`$id`) are accepted and ignored.

> **Note.** A `pattern` is verifier-controlled and evaluated against holder data, so a
> catastrophic-backtracking regex can hang the process. JavaScript cannot time-bound a `RegExp`.
> This is the same exposure the `ajv`-based implementation had.

## Migrating from `@animo-id/pex`

Beyond decoding credentials yourself, the behaviour changes worth knowing:

- **`is_holder` / `same_subject` / `statuses` marked `required` now fail** rather than silently
  passing. This is the change most likely to be felt — the DIF examples use `is_holder`.
- **`schema[].required` is honoured** in v1. The old implementation ignored it and asked only for
  any URI match.
- **Unknown filter keywords and unsupported JSONPath are rejected** at parse time.
- **Results have a different shape.** There is no `SelectResults`; see *Reading the result*.
- **Wildcard matches report the node that matched.** The old implementation reported the first
  node regardless, so `$.accounts[*].id` with `{const: 'target'}` could disclose a different
  element than the one that satisfied the constraint.
- **A string `minimum`/`maximum` bound is applied.** `{"type": "string", "format": "date",
  "minimum": "1999-05-16"}` — a shape the spec's own examples use — asserted nothing under `ajv`,
  which scopes numeric bounds to numbers.

A harness diffing both implementations over the DIF example corpus lives in `parity/`; see
`parity/PARITY.md` for the full list of divergences and how much they are actually exercised.

## License

Apache-2.0

[spec]: https://identity.foundation/presentation-exchange/
[zod]: https://zod.dev
