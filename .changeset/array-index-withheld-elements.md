---
'presentation-exchange': patch
---

When checking a presentation, an array index in a field path only matches any element for a credential that can withhold array elements: an SD-JWT VC, or a W3C credential that declares `selectively_disclosable`. For a JWT VC, a Linked Data credential or an mdoc, which present an array in full, the index is matched as it is. Before, `$.nationalities[0]` with `const: 'NL'` accepted a JWT VC with `nationalities: ['DE', 'NL']`. The new `canWithholdArrayElements` tells which credentials can.
