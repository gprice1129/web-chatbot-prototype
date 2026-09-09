---
id: missing-facets
title: A node declaring no type, status or audiences
summary: >
  Exists so the loader's missing-facet warnings have something to find, and so
  an absent level can be shown to stay quiet.
aliases: [missing facets]
---

# A node declaring no type, status or audiences

`level` is deliberately absent too. The ontology puts a level on every atom but
not on the modules and tracks that contain them, so an absent level is not a
divergence and must not warn.
