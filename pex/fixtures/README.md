# Fixtures

`dif-pe-examples/` are the presentation definitions from the DIF Presentation Exchange
specification examples, as vendored by the Sphereon `pex` implementation
(`test/dif_pe_examples`). They are the regression corpus for the definition models: every one of
them must parse, at the version its directory claims.

Fourteen are expected not to parse: they use `pattern`, which this library rejects by design, and one of them
also uses a placeholder path. See `corpus.test.ts` for the list.
