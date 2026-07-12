# ADR-0007: Phase 0 freeze: resolutions and deferrals

Status: accepted. Date: 2026-07-11.

## Decision

SPEC-STRIP, SPEC-INSTRUMENT-MODEL, and SPEC-PROVIDER freeze as of this date; further contract changes require an ADR. The open items resolved into the specs: provider error semantics (structured refusal via `CoverageRefusalError`, never NaN fills or clamping, queries atomic), coverage advertisement (optional `coverage(body)` returning validity windows), batch sizing (soft ceiling of 65536 epochs per query with a chunk-and-stitch pattern); strip sub-structure (an eight-kind discriminated union covering the 21 families), quality vocabulary (`incidenceDeg`, `resolutionM`, `lookCount`), canonical JSON serialization (closed draft-07 schema), size and chunking guidance; instrument-model units policy (km, s, rad, unit-suffixed names), mount as a platform-outward composition chain, per-family required-parameter vocabulary, and validity windows as an optional refusing fence.

Deferrals, each explicit: (1) AnalysisProduct field-level alignment (SPEC-STRIP section 8): the Bessel ADR on product contracts has not landed in the pinned tree, so `StripProduct` stays the minimal envelope (`kind` plus strip payload); the alignment is a future binding recorded by its own ADR when the Bessel pin exists, and the envelope is additive around the frozen strip, so this deferral cannot move the strip schema. (2) Mount chains beyond one articulated element are legal data now and sampler-supported in Phase 2 (the CRISM gimbal-over-platform case). (3) A JSON Schema for instrument models is deferred to Phase 1; models validate through `validateInstrumentModel` in core until then. (4) The golden-image half of AGE-17 lands in Phase 1 when the atlas re-renders through the engine; Phase 0 lands the numeric half for the two anchor tiles.

## Rationale

goals/PHASE-0.md requires every open item resolved or explicitly deferred with an ADR note, and freezing against an absent upstream pin would fake precision: the strip payload is what adapters and exports consume, and it freezes fully; the product envelope is plumbing whose alignment is cheap to bind later precisely because it is additive. The remaining deferrals are sequencing already implied by the phase plan, recorded here so the specs can say frozen without an asterisk.

## Addendum (phase-1-samplers merge)

Scene policy is two-tier: tiles 1 and 21 remain spec-frozen conformance anchors, while the other nineteen family scenes are code-owned sampler scenes, pinned by tests and revisable with their samplers without spec churn. Fixture authority follows the same line: as each family's sampler lands, its fixture retires from hand-authored worked example to sampler-generated anchor (UPDATE_FIXTURES=1), and SPEC-INSTRUMENT-MODEL section 5 is amended in the same change to describe the progressive retirement. Dependency ruling from the Phase 0 review, recorded: the core zero-dependency rule governs runtime dependencies; dev-only type and tooling packages (for example @types/node) sit outside it.
