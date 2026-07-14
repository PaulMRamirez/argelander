# CLAUDE.md

Canonical agent context for the Argelander repository. Read this, then the current phase file in `goals/`, then any ADR marked `proposed`, before writing code.

## Identity

Argelander is the proper name; AGE (Acquisition Geometry Engine) is the functional identity. Requirement IDs are AGE-01 through AGE-20 in `REQUIREMENTS.md` and they do not churn. The product line: Cosmolabe is what you see, Bessel is what computes, Argelander is what surveys.

## The three seams (contracts, never code shared by copy)

1. Inbound state: everything enters through a StateProvider-shaped interface (`specs/SPEC-PROVIDER.md`), a strict subset of the Bessel StateProvider contract. Standalone providers: SGP4 in a worker, pre-sampled SPICE states from a service, CZML.
2. Outbound product: strips are publishable as typed AnalysisProduct records carrying the provenance authority field (`specs/SPEC-STRIP.md`).
3. Render surface: adapters consume strips and nothing else. One Three adapter core serves LithoSphere (MMGIS Globe) and Cosmolabe.

## Hard non-goals

- No propagation, no orbit determination, no frames math beyond analytic ellipsoid intersection for rendering-grade footprints. Analysis-grade intercepts delegate through the pluggable intercept service.
- Never embed a CSPICE build. A second WASM SPICE recreates the highest-risk seam of the Bessel/Cosmolabe merge in a second place. States arrive from providers.
- No new runtime dependencies in `argelander-core`. It ships with zero. A proposed dependency is an ADR, not a package.json edit.
- Do not modify `apps/atlas` behavior except by re-rendering tiles through the engine (Phase 1 exit). The atlas is the reference behavior and the visual regression corpus.

## Style rules (enforced by `pnpm verify`)

- No em dashes anywhere: not in prose, not in comments, not in strings, not as the HTML entity. Use commas, colons, semicolons, parentheses.
- Documentation is dense prose. Tables are welcome. Bullet lists only where structure genuinely demands them.
- TypeScript strict. Tuples over objects in hot paths (segments are typed-array friendly).

## Workflow

Session ritual: read the current `goals/PHASE-N.md`, read open ADRs, state the plan in one short paragraph, then execute. Definition of done for any task: `pnpm verify` green, new behavior covered by a test, spec updated in the same change if the contract moved, commit message in conventional-commit form with a `Refs: AGE-xx` trailer naming the requirement(s) touched. If a change wants a new seam, a schema field, or a dependency: stop, draft the ADR, ask.

Commands: `pnpm install`, `pnpm verify`, `pnpm -r test`, `pnpm -r typecheck`, `node scripts/check-style.mjs`, `pnpm docs:build` (builds dist/site: survey, specs, ADRs, API reference, atlas).

## Current phase

Phase 6. Subject: The model corrections. Implement the two accepted corrections the platform-and-payload study derived: the optics-first instrument model (ADR-0016, intrinsic collecting geometry as data with a rendering-grade spherical derivation, a JSON loader and a catalog manifest, structured provenance replacing the prose note) and the attitude epistemic envelope (ADR-0015, measured attitude made first-class so suborbital and balloon render on real pointing rather than a collapsed velocity-derived one, a confirmed delivery target). Governed by ADR-0014, ADR-0015, and ADR-0016. Exit criteria in `goals/PHASE-6.md`; the ordered slices, prompts, and verification are in `goals/PHASE-6-implementation.md`. The PHASE-5 state slices OEM and the SPK recipe remain independent and may interleave. Foundational references: `docs/what-the-engine-must-know.md` and `docs/acquisition-geometry-survey.md`.
