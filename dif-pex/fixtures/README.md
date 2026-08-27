# Fixtures

`dif-pe-examples/` are the presentation definitions from the DIF Presentation Exchange
specification examples, as vendored by the Sphereon `pex` implementation
(`test/dif_pe_examples`). They are the regression corpus for the definition models: every one of
them must parse, at the version its directory claims.

Two are deliberately not expected to parse — see `corpus.test.ts` for which, and why.
