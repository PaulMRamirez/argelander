# SPEC-STRIP (draft, Phase 0 subject)

Status: draft. Phase 0 freezes this document. The strip is the data spine: everything the engine emits, every adapter consumes, and every export serializes is a strip.

## 1. Definition

A strip is a time-ordered sequence of cross-track segments over one body, produced by one instrument in one mode during one pass or encounter, carrying acquisition state and provenance. Formally (TypeScript shapes are normative and live in `packages/argelander-core/src/types.ts`):

A `StripSegment` carries `etSec` (seconds past J2000 TDB), `left` and `right` edge positions as body-fixed Cartesian kilometers (tuples, typed-array friendly), optional `sub` sub-structure (sub-swath index, burst ID, bead or beam positions), an acquisition `state` of `planned`, `acquiring`, or `committed`, and optional `quality` ranges. Zero-width geometries (lidar beads, occultation events) set `left` equal to `right`.

A `Strip` carries `id`, `body` (SPICE body name), `frame` (body-fixed frame name), `instrumentId`, optional `missionId`, `mode`, `passId`, the `segments` array, and `provenance` with the authority field.

## 2. Invariants (enforced by `validateStrip`)

Segments nonempty; `etSec` monotonically nondecreasing; edges finite; state in the enum; body and frame nonempty. Width may vary per segment (flyby). Gaps in time are legal and meaningful (bursts, dwell windows); adapters must not interpolate across them.

## 3. AnalysisProduct mapping (AGE-20)

A strip serializes as an AnalysisProduct record: `kind: "acquisition-strip"`, payload as above, provenance authority naming the computing engine. Field-level alignment with the Bessel contract is a Phase 0 exit item; pin: Bessel ADR on product contracts.

## 4. Open items for Phase 0

Quality field vocabulary (incidence, resolution, look count); sub-structure discriminated union per family; canonical JSON serialization and the JSON Schema in `schemas/strip.schema.json`; size guidance and chunking for long passes.
