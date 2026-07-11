# Contributing

Apache-2.0 with Developer Certificate of Origin. Every commit is signed off (`git commit -s`); the DCO check enforces it. Conventional commits with a `Refs: AGE-xx` trailer tying the change to a requirement. Specs are the source of truth: a change that moves a contract updates the spec in the same pull request, and a change that adds a runtime dependency to core, a seam, or a schema field starts life as an ADR in `adr/`. `pnpm verify` must be green before review. Instrument models are contributed as data (model files plus fixtures), not as code paths.
