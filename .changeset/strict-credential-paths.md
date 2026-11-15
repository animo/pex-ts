---
'presentation-exchange': patch
---

A descriptor path now only selects a credential through `verifiableCredential[n]` or `vp.verifiableCredential[n]`. Before, any key followed by an index was accepted, so `$.fakeCred[0]` resolved to credential 0 although the path names nothing in the presentation.
