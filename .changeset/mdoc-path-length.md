---
'presentation-exchange': patch
---

mdoc input descriptors follow ISO 18013-7. An mdoc only matches an input descriptor whose `format`, or the definition's, names `mso_mdoc`. In such an input descriptor every field path names one data element, `$['<namespace>']['<data element identifier>']`, and a definition with any other path is rejected. Before, a path that named a namespace requested every element in it, and a path into an element's value requested the whole element.
