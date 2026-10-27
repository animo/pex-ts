# @owf/pex

A lean TypeScript implementation of [DIF Presentation Exchange][spec] v1 and v2. It covers a
reasonable subset of the specification, the part that definitions use, and is built to be small
and safe to run on a definition from a verifier you don't know. See *Scope* for what is in and
what is out.

One runtime dependency ([zod][zod]). It does no credential parsing, crypto or signing, and brings
no JSONPath library or JSON Schema validator.

```sh
npm install @owf/pex
```

## The idea

You decode credentials and this library matches them. It never sees a JWT, an SD-JWT, a CBOR
mdoc or a proof. You pass claims you have already decoded and get back a description of what
matched and why.

That constraint keeps it small. Deciding what to disclose is a pure function over JSON, and
applying the decision belongs to whichever library already owns the format.

## Scope

This is not a full implementation of the specification, and does not try to be. Presentation
Exchange delegates to JSONPath and JSON Schema, two open-ended languages, so a complete
implementation gives every verifier an expression evaluator and a backtracking regex engine to run
over the holder's credentials. This library implements a reasonable subset: the constructs that
definitions use in practice. Anything else is rejected when a definition is parsed, so nothing is
silently ignored. That keeps it small and makes it safe to evaluate a definition from an unknown
verifier.

Supported:

- definitions in v1 (`schema`) and v2 form, with the version discovered while parsing
- fields with a path, a filter, `optional`, `predicate` and `intent_to_retain`; `limit_disclosure`;
  `subject_is_issuer`; `format` restrictions on the definition or the descriptor; submission
  requirements with `all`, `pick`, `count`, `min`, `max`, `from` and `from_nested`
- JSONPath: `.name`, `['name']`, `[0]` and `[*]` (see *Supported JSONPath*)
- filters: `type`, `const`, `enum`, `format`, lengths and bounds, plus `not`, `contains` and `items`
  one level deep (see *Filters*)
- SD-JWT VC, mdoc and W3C credentials as decoded claims; disclosure as data (a pruned copy, the
  paths to disclose, an mdoc namespace map); building and checking a presentation submission

Rejected when a definition is parsed, where a JSON Schema validator would ignore them:

- JSONPath filter and script expressions, recursive descent, slices, unions and negative indices
- `pattern`, the structural JSON Schema keywords (`properties`, `required`, `additionalProperties`,
  `minItems`, `maxItems`, `uniqueItems`, `allOf`, `anyOf`, `oneOf`), `$ref`, and any other keyword
- a `format` object that names nothing, or a designation outside the claim format registry

Carried, but never evaluated:

- `is_holder`, `same_subject` and `statuses`: they need holder binding, subject linkage and status
  lookups this library is never given, so a descriptor asserting one fails unless you declare that
  you check it yourself (see *Not evaluated*)
- `frame` and `issuance`, which no part of matching needs

Out of scope by design: decoding credentials, verifying signatures, holder binding, key binding
JWTs, device signatures and status lists. Those belong to the libraries that own the formats.

## Quick start

```ts
import { queryPresentationDefinition } from '@owf/pex'

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
A credential that does not match never throws. The result reports it.

To parse once and query many times, split the steps:

```ts
import { parsePresentationDefinition, runPexQuery, validatePresentationDefinition } from '@owf/pex'

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

Every format also accepts optional fields that only some constraints need. Most definitions never
ask for them, so they are optional. A constraint that needs one and does not get it fails, rather
than quietly passing:

| Field | Needed by |
| --- | --- |
| `issuer`, `subject` | `constraints.subject_is_issuer` |
| `algorithms` | a `format` restriction's `alg` / `sd-jwt_alg_values` |
| `proof_types` | a `format` restriction's `proof_type` |
| `cryptosuites` | a `di*` format restriction's `cryptosuite` |
| `key_binding_algorithms` | an SD-JWT VC `format` restriction's `kb-jwt_alg_values` (presentations) |

A holder can't always know these in advance, so for a query a restriction the credential declares
nothing for is not checked. For a presentation it fails (see *Presentations*).

A `format` restriction admits a credential by its designation: `jwt_vc` and `jwt_vc_json` are
distinct, and a credential matches the one it declares. A presentation designation (`jwt_vp`,
`jwt_vp_json`, `ldp_vp`, `di_vp`) admits the credentials such a presentation carries: JWT
credentials under either of their designations, Linked Data credentials, or Data Integrity
credentials. Its `alg` or `proof_type` describes the presentation, which this library never sees.
An SD-JWT VC or an mdoc is presented as itself, so only its own designation admits it.

A few more describe what the credential can do, or what you check yourself:

| Field | Meaning |
| --- | --- |
| `selectively_disclosable` | The credential can disclose selectively, which `limit_disclosure: required` needs. Defaults to `true` for SD-JWT VCs and mdocs and `false` for W3C credentials, so set it for a BBS or AnonCreds credential. |
| `predicate_results` | A presentation holding `true` for a predicate field rather than the value, as AnonCreds presents it. Verify the predicate proof yourself. |
| `evaluated_constraints` | Constraints you check yourself for this credential, e.g. `['statuses']` when you verify a non-revocation proof. See *Not evaluated*. |

Values that are not JSON, such as an mdoc's byte strings and dates, are leaves: a path does not
reach into them and no `type` admits them.

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
    matching_credentials: Array<{ credential_index, format, fields, disclosure }>
    non_matching_credentials: Array<{ credential_index, format, reasons }>
  }>

  // present only when the definition declares submission requirements (an empty array declares none)
  submission_requirements?: Array<SubmissionRequirementResult>
}
```

Each entry of `fields` reports the path that resolved and every node it matched:
`{ field_index, matched_path, nodes: Array<{ path, value }> }`. `value` is `true` for a field with a
`predicate`.

### Why a credential did not match

Every applicable reason is reported, so a wallet can explain everything at once:

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

`reason.message` quotes the claim values it found, like the `16` above. Show it to the holder, but
don't send it to a verifier.

### Submission requirements

The result mirrors the definition's tree rather than enumerating every satisfying combination.
Each node reports how many members are needed and which are available. You choose which to use.

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

Each match carries a `disclosure`: the claims its fields matched and nothing else. It is there
whether or not the input descriptor sets `constraints.limit_disclosure`, because disclosing only
what was asked is always the holder's choice. Nothing is mutated, and the result shares no object
with your credential. An mdoc's byte strings and dates are copied, and other values that aren't
JSON are kept as they are. You apply the result with whichever library owns the format.

```ts
const { output, paths, namespaces } = match.disclosure
```

- `output`: the claims pruned to the matched paths, which is what the verifier is to learn. Array
  indices are preserved (skipped elements become `null`) so paths still resolve. A claim only a
  `predicate` field matched is `true`.
- `paths`: the claims to disclose, each with everything below it, in the order of the claims. A
  path is a DCQL claims path without `null` (`['address', 'locality']`, `['nationalities', 0]`), so
  you disclose with the code you use for DCQL. A predicate's claim is in it, because a verifier can
  only check the predicate against the value. Only a zero-knowledge format keeps the value back, so
  with an SD-JWT show the holder the value rather than the `true` in `output`.
- `namespaces`: mdoc only, `{ [namespace]: { [element]: intent_to_retain } }`, the shape an mdoc
  device request needs. An mdoc discloses whole data elements: a path that points inside an
  element's value requests the element, and a path naming a namespace requests every element in
  it. `output` holds the elements as they are disclosed, and `paths` lists them.

An SD-JWT presentation frame can't be built from `paths` alone. `@sd-jwt/present` counts the decoy
digests in an array, which the decoded claims leave out, so build the frame from the encoded SD-JWT,
as Credo does for DCQL.

When `limit_disclosure` is `required`, a credential that can't disclose selectively, such as a JWT
VC or a Linked Data credential without `selectively_disclosable`, does not match.

## Presentations

On the holder side, build a submission for the credentials you chose:

```ts
import { createPresentationSubmission } from '@owf/pex'

const submission = createPresentationSubmission(parsed.definition, {
  id: crypto.randomUUID(), // you supply it; this library carries no randomness source
  location: 'external',    // 'external' (OpenID4VP) | 'presentation' (embedded in the VP)
  entries: [
    { input_descriptor_id: 'identity', format: 'dc+sd-jwt', presentation_index: 0 },
    { input_descriptor_id: 'address', format: 'ldp_vc', presentation_index: 1, credential_index: 0 },
  ],
})
```

On the verifier side, check that a submission answers the definition:

```ts
import { runPresentationSubmission } from '@owf/pex'

const result = runPresentationSubmission(parsed, submission, {
  // per presentation, its decoded credentials in the order a path addresses them:
  // a W3C VP's verifiableCredential, an mdoc device response's documents, an SD-JWT VC itself
  presentations: [{ credentials: [/* ... */] }],
})

result.valid       // descriptors resolved, constraints re-checked, requirements met
result.descriptors // per descriptor_map entry
result.issues      // problems with the submission as a whole
```

This does not take the submission's word for anything. Each entry is re-evaluated against the
input descriptor it claims to satisfy, with the same checks as a query, and the descriptor's own
`format` is not treated as evidence. Verifying the presentations themselves (signatures, holder
binding, key binding JWTs, device signatures) remains yours.

To read the presented credential of a descriptor after verification, resolve it the same way:

```ts
import { resolveDescriptorCredential } from '@owf/pex'

const resolved = resolveDescriptorCredential(submission.descriptor_map[0], presentations)
if (resolved.success) {
  resolved.location   // { presentation_index, credential_index }
  resolved.credential // the credential runPresentationSubmission evaluated for this entry
}
```

A presentation differs from a credential in a few ways, which this accounts for:

- A path like `$` that addresses a presentation as a whole selects its only credential, or for an
  mdoc device response the document whose doctype is the input descriptor's id (ISO 18013-7).
- With more than one presentation, `$` is the array of them, so every path has to select one with
  `$[n]`. A path like `$[1].verifiableCredential[0]` selects credential 0 of presentation 1.
- An array index in a field path matches any element: the elements the holder withheld are gone,
  so the second element of the credential can be the first of the presentation.
- A `format` restriction on algorithms, proof types or cryptosuites fails when the credential
  declares none, instead of being skipped.
- A `pick` requirement needs exactly `count` of its members, or between `min` and `max`. For a query
  it needs at least that many available, as a holder can always submit fewer.

A requirement over a group that no input descriptor declares is never satisfied, in a query or a
submission. `validatePresentationDefinition` reports such a definition, and
`runPresentationSubmission` expects a validated one.

## Not evaluated

`is_holder`, `same_subject` and `statuses` need information this library is never given: holder
binding proofs, subject linkage across credentials, live status list lookups.

They are parsed and carried. A `preferred` directive (or `allowed`, for a status) passes. An input
descriptor that asserts one, with `required` or for a status `disallowed` ("must not be revoked"),
fails with an `unsupported_constraint` reason.

Accepting them and reporting success would be a false claim of compliance. If you rely on one of
them, check it yourself and say so on the credential:

```ts
// You verify the non-revocation proof of this credential yourself
{ credential_format: 'ldp_vc', claims, evaluated_constraints: ['statuses'] }
```

## Supported JSONPath

A `field.path` is a JSONPath, of which this library supports the small part that definitions use
in a credential's field paths.

| Path | Selects |
| --- | --- |
| `.name` | a property, named with letters, digits, `_` and `-`, e.g. `$.vct`, `$.age_equal_or_over.18` |
| `['name']`, `["name"]` | a property with any name, e.g. `$['org.iso.18013.5.1']['family_name']`, `$["@context"]`; escape the quote and `\` with `\` |
| `[0]` | an array element |
| `[*]`, `.*` | every array element, e.g. `$.vc.type.*`, `$.accounts[*].id` |

A path starts at the claims (the namespaces of an mdoc), and is at least one segment long, as a DCQL
claims path is: a field with path `$` would disclose the whole credential, and is rejected. A wildcard
selects array elements only, as `null` does in a DCQL claims path. To ask for an object with
everything in it, name the object: `$.address`, not `$.address.*`.

Everything else is rejected when the definition is parsed, so an unsupported path surfaces
immediately rather than as a mysterious no-match:

- filter expressions `[?(...)]` and script expressions `[(...)]`, which would hand a verifier an
  expression evaluator over the holder's data
- recursive descent `..` (a key at any depth), whose cost grows with the square of a credential's
  nesting depth
- slices `[1:3]` (a range of elements), unions `[0,1]` (several elements or keys) and negative
  indices `[-1]` (counting from the end)
- `@` or `$` in dot notation, which RFC 9535 does not allow either. Quote such a key instead.
- in a quoted name, escapes other than the enclosing quote and `\` (RFC 9535's `\n`, `\uXXXX` and the
  like), and raw control characters

A query only reads own properties of JSON objects and elements of arrays: a path can't reach
`__proto__`, `constructor` or anything else inherited, nor leave the claims it is given, and its work
is bounded by the size of the claims. A path is at most 1024 characters (`MAX_JSON_PATH_LENGTH`) and
parses in linear time.

A parsed path has the shape of a DCQL claims path: a property name, an array index, or `null` for a
wildcard. The helpers are exported if you need them: `parseJsonPath`, `queryJsonPath`,
`stringifyJsonPath`, `isSupportedJsonPath`.

## Filters

`field.filter` is nominally arbitrary JSON Schema. This library supports a small, closed set of
keywords that assert something about the value at the path, and rejects everything else when the
definition is parsed.

A JSON Schema validator ignores keywords it does not recognise. Ignoring an assertion widens what
matches: a verifier whose constraint is quietly dropped gets credentials it did not ask for.

Supported: `type` (`string`, `number`, `integer`, `boolean`, `null`, `object`, `array`, or a list
of them), `const`, `enum`, `format`, `minLength`, `maxLength`, `minimum`, `maximum`,
`exclusiveMinimum`, `exclusiveMaximum`, `formatMinimum`, `formatMaximum`,
`formatExclusiveMinimum`, `formatExclusiveMaximum`. Three keywords take a sub-filter made of the
same keywords, with no further nesting: `not` (the value must not satisfy it), and on a filter with
`type: "array"`, `contains` (at least one element satisfies it) and `items` (every element does).
Annotations (`title`, `description`, `$comment`, `default`, `examples`, `$schema`, `$id`) are
accepted and ignored.

A filter describes one value. To constrain something inside an object, address it with the path:
`$.address.locality` with `{"const": "Köln"}`, not `$.address` with `properties`. A field whose path
names an object or an array can still assert its `type` and disclose it whole, which is how an
mdoc's `driving_privileges` is requested. The structural keywords (`properties`, `required`,
`additionalProperties`, `minItems`, `maxItems`, `uniqueItems`, `allOf`, `anyOf`, `oneOf`) are
rejected. A credential type in an array is matched with `contains`, the way verifiers write it:

```json
{ "path": ["$.vc.type"], "filter": { "type": "array", "contains": { "const": "OpenBadgeCredential" } } }
```

or with a wildcard path, `$.vc.type[*]` with `{"const": "OpenBadgeCredential"}`, since a field
matches when any node satisfies its filter.

A bound that can't apply is not dropped either, which would widen what matches. A string
`minimum` on a filter that only admits numbers, a date bound that isn't a valid date, or a
`formatMinimum` without an ordered `format` (`date`, `date-time`, `time`) is rejected when the
definition is parsed. A string bound, or a `format*` bound, that a value can't be compared with
fails. A `date-time` needs an offset, as RFC 3339 requires, so comparing instants never depends on
the host's timezone.

### No `pattern`

`pattern` is not supported, and a definition that uses it is rejected when parsed. A pattern is a
verifier-controlled regular expression run against the holder's claims, and JavaScript's `RegExp`
backtracks: `^(\S+)*!$` keeps a wallet busy for a minute on a 33-character claim and for years on a
60-character one, before the holder has seen the request. A linear-time engine would add a
dependency, and a hand-written one would add risk. Patterns in definitions in the wild are
literals, or alternations of literals, which `const` and `enum` say directly. The DIF
specification's own examples use `pattern`, so they are rejected too (see `fixtures/README.md`).

## Note on `@animo-id/pex`

This library replaces `@animo-id/pex`, which decoded credentials itself and so depended on SD-JWT,
mdoc, JSON Schema, JSONPath and W3C credential libraries. Besides decoding credentials yourself,
these are the behaviour differences to know about:

- `is_holder`, `same_subject` and `statuses` marked `required` (or a status `disallowed`) fail
  unless you declare them in `evaluated_constraints`. The DIF examples use `is_holder`, so this is
  the difference most likely to be felt.
- `schema[].required` is honoured in v1, where the old implementation asked only for any URI match.
- `pattern`, the structural JSON Schema keywords, unknown keywords, unsupported JSONPath and a
  field path of `$` are rejected when a definition is parsed.
- A wildcard field reports every node that matched. The old implementation reported the first node
  regardless, so `$.accounts[*].id` with `{"const": "target"}` could disclose a different element
  than the one that satisfied the constraint.
- A string `minimum` or `maximum` bound is applied. `{"type": "string", "format": "date",
  "minimum": "1999-05-16"}`, a shape the spec's own examples use, asserted nothing under ajv.
- A presentation designation admits only the credentials it can carry, where the old
  implementation ignored a definition-level `format`.
- Results have a different shape. There is no `SelectResults` (see *Reading the result*).

A harness diffing both implementations over the DIF example corpus lives in `parity/`, with its
findings in `parity/PARITY.md`.

## License

Apache-2.0

[spec]: https://identity.foundation/presentation-exchange/
[zod]: https://zod.dev
