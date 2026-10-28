# presentation-exchange

## 0.1.0

### Minor Changes

- fbc5fca: Initial release of `presentation-exchange`, a TypeScript implementation of DIF Presentation Exchange v1 and v2.

### Patch Changes

- de5cfc1: When checking a presentation, an array index in a field path only matches any element for a credential that can withhold array elements: an SD-JWT VC, or a W3C credential that declares `selectively_disclosable`. For a JWT VC, a Linked Data credential or an mdoc, which present an array in full, the index is matched as it is. Before, `$.nationalities[0]` with `const: 'NL'` accepted a JWT VC with `nationalities: ['DE', 'NL']`. The new `canWithholdArrayElements` tells which credentials can.
- de5cfc1: mdoc input descriptors follow ISO 18013-7. An mdoc only matches an input descriptor whose `format`, or the definition's, names `mso_mdoc`. In such an input descriptor every field path names one data element, `$['<namespace>']['<data element identifier>']`, and a definition with any other path is rejected. Before, a path that named a namespace requested every element in it, and a path into an element's value requested the whole element.
- 30dc76d: A field now tries its next path when a path resolves only to values that fail the filter, as DIF Presentation Exchange v2 prescribes. Before, the first path that resolved decided the field.
- de5cfc1: `selectively_disclosable` is now only on W3C credentials, where it defaults to `false`. An SD-JWT VC or an mdoc always discloses selectively.
