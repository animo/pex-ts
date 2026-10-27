# pex-ts

A lean TypeScript implementation of [DIF Presentation Exchange][spec] v1 and v2, built along the
lines of [dcql-ts][dcql-ts]: pure functions, structured results, and no credential parsing.

| Package                                             |                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`presentation-exchange/`](./presentation-exchange) | **`presentation-exchange`** — the library. [Usage docs](./presentation-exchange/README.md).                               |
| [`parity/`](./parity)                               | Temporary harness diffing against the deprecated `@animo-id/pex`. [Findings](./parity/PARITY.md). Delete after migration. |

It replaces `@animo-id/pex`, which decodes credentials itself and therefore depends on SD-JWT,
mdoc, W3C credential, JSON Schema and JSONPath libraries. Here you pass already-decoded claims,
which leaves one runtime dependency ([zod][zod]).

`PLAN.md` records the design and — in §15 — every deviation made while implementing it, with the
reasoning.

## Development

```sh
pnpm install
pnpm test          # vitest, all packages
pnpm build         # tsdown, ESM + types
pnpm types:check   # tsc --noEmit, all packages
pnpm style:check   # biome: TypeScript, JSON, Markdown, YAML
pnpm style:fix
```

Add a changeset (`pnpm changeset`) to every change to `presentation-exchange`. Merging to
`main` publishes an `alpha` snapshot and opens a release pull request. Merging the release pull
request publishes the new version to npm.

The examples in `presentation-exchange/README.md` are executed by
`presentation-exchange/src/readme.test.ts`, so the documentation cannot drift from the API. Update
both together.

## License

Apache-2.0

[spec]: https://identity.foundation/presentation-exchange/
[dcql-ts]: https://github.com/openwallet-foundation-labs/dcql-ts
[zod]: https://zod.dev
