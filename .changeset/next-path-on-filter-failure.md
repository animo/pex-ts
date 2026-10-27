---
'presentation-exchange': patch
---

A field now tries its next path when a path resolves only to values that fail the filter, as DIF Presentation Exchange v2 prescribes. Before, the first path that resolved decided the field.
