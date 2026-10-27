# Parity with `@animo-id/pex`

A temporary harness that runs the same presentation definitions and credentials through the
deprecated `@animo-id/pex` (the version credo-ts pins, `^6.1.1`) and through
`@owf/pex`, and diffs the result.

**Delete this package once the migration lands.** It exists only to make deliberate behaviour
changes visible and to catch accidental ones.

## What is compared

Result _structures_ differ by design (see `PLAN.md` §7), so the harness compares a projection
both implementations can express: **which input descriptors were satisfied, by which
credentials**, plus whether the definition as a whole is satisfiable.

Decoding is done once, in `src/convert.ts`, using the same `@sd-jwt` version the deprecated
implementation uses internally. Both sides therefore see identical claims, and the comparison
isolates _matching_ behaviour rather than decoding behaviour.

## Running it

```sh
pnpm vitest run parity.test
```

The test fails if the set of diverging definitions is anything other than the list below. A
full report is written to `/tmp/parity-report.txt`.

## Coverage, honestly

Of the 29 definitions in the vendored DIF corpus, 13 use `pattern`, which `@owf/pex` rejects by
design (see its README), and one uses a placeholder path. The harness asserts those rejections and
skips them (`SKIP`). Of the 15 comparable definitions:

|                                                                 |     |
| --------------------------------------------------------------- | --- |
| `OK` — agree, and at least one implementation matched something | 6   |
| `OK?` — agree, but **both matched nothing**                     | 6   |
| `DIFF` — diverge                                                | 3   |

The vacuous agreements are weak evidence: those DIF examples ask for credential types (bank
accounts, particular driver licence schemas, status examples) that the corpus has no credentials
for, so both implementations correctly match nothing and the comparison proves little beyond
"neither crashed".

The 6 substantive agreements are the ones carrying weight, and they cover the harder paths:
wildcard paths into arrays (`$.order.paxSegments[*].operatingCarrierFlightNumber`), SD-JWT
selective disclosure, multi-format definitions with submission requirements, and predicates.

Adding credential fixtures for the vacuous 6 would be the highest-value improvement here. The 13
skipped definitions can only be compared by rewriting their `pattern` filters as `const`, `enum` or
`contains`, which would no longer be the DIF examples.

## Known divergences

All three are deliberate, and each corresponds to a decision recorded in `PLAN.md` §14.

### 1. `pdV1/pd-PermanentResidentCard.json` — `is_holder` is not evaluated

### 2. `pdV1/pd_driver_license_name.json` — `is_holder` is not evaluated

Both declare `constraints.is_holder` with `directive: "required"`.

- **old**: matches `vc-PermanentResidentCard.json`, reports the definition satisfiable.
- **new**: matches nothing, with reason `unsupported_constraint`.

`is_holder` requires proving the presenter is the subject of the claim, which needs holder
binding information this library is never given. The deprecated implementation accepts the
constraint and returns success regardless — a silent false claim of compliance. Per decision
§14.4 this fails loudly instead.

Worth noting these are _DIF specification examples_, not contrived cases: `is_holder` is used in
practice, and any caller relying on it must now check it themselves. This is the divergence most
likely to be felt during migration.

### 3. `pdV1/pd_element_must_be_array_example(corrected).json` — empty `input_descriptors`

The definition requests nothing (`"input_descriptors": []`).

- **old**: reports not satisfiable.
- **new**: reports satisfiable, vacuously.

Neither spec schema sets `minItems` on `input_descriptors`, so the definition is valid and
imposes no requirements — which nothing can fail to meet. Per decision §15.6, parsing accepts
what the spec accepts, and a definition asking for nothing is satisfied by anything.

## Divergences found and fixed

The harness earned its keep by catching two bugs that reasoning had missed:

1. **Presentation formats were being applied to credentials.** `getEffectiveFormat` fell back to
   the definition-level `format`, and both failing definitions declare
   `format: {"ldp_vp": {...}}` — a _presentation_ encoding. A credential is never `ldp_vp`, so
   every credential was rejected. Fixed by filtering a `format` to its credential designations
   before matching, and treating a `format` that names none of them as no restriction.
   See `credentialFormatDesignations` in `m-format.ts`.
2. **A harness bug, not a library one**: `areRequiredCredentialsPresent === 'info'` was being
   read as "satisfiable". The deprecated implementation returns `warn` when _more_ credentials
   match a descriptor than are needed, which is ambiguity rather than failure. Corrected to
   `!== 'error'`.
