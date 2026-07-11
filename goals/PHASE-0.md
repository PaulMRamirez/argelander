# PHASE-0: Freeze the contracts

Subject: the three specs and their machine forms. No rendering code.

Tasks: extract the strip schema and instrument model schema from docs/acquisition-geometry-survey.md (Sections 9.1 through 9.6) into SPEC-STRIP and SPEC-INSTRUMENT-MODEL as frozen documents (resolve every Open Items entry or explicitly defer with an ADR note); finalize SPEC-PROVIDER section 1 and paste the Bessel draft into section 3 if available; generate `types.ts` to match the frozen specs; write `schemas/strip.schema.json` as a complete draft-07 schema; produce one instrument model file and one fixture strip per geometry family (21 total) under `packages/argelander-core/fixtures/`; land the conformance test that regenerates tiles 1 (pushbroom) and 21 (flyby-swath) numerically from models and compares against fixtures within tolerance.

Exit criteria: `pnpm verify` green; all 21 fixtures validate; the two conformance replays pass; specs carry Status: frozen; every commit trails `Refs: AGE-xx`. Do not start Phase 1 in the same session as the freeze.
