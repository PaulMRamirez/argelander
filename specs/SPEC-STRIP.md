# SPEC-STRIP

Status: frozen (Phase 0, 2026-07-11). Changes to this contract require an ADR. The strip is the data spine: everything the engine emits, every adapter consumes, and every export serializes is a strip.

## 1. Definition

A strip is a time-ordered sequence of cross-track segments over one body, produced by one instrument in one mode during one pass or encounter, carrying acquisition state and provenance. TypeScript shapes are normative and live in `packages/argelander-core/src/types.ts`; the JSON Schema in `schemas/strip.schema.json` is their serialization twin (section 6).

A `StripSegment` carries `etSec` (seconds past J2000 TDB), `left` and `right` edge positions as body-fixed Cartesian kilometers (`Vec3` tuples, typed-array friendly), an acquisition `state` of `planned`, `acquiring`, or `committed`, optional `sub` sub-structure (section 3), and optional `quality` (section 4). Zero-width geometries (lidar beads, occultation events, sounder profiles) set `left` equal to `right`. `left` and `right` are edge labels assigned consistently along one strip by its generator; they do not promise a global handedness.

A `Strip` carries `id`, `body` (SPICE body name), `frame` (body-fixed frame name), `instrumentId`, optional `missionId`, `mode`, and `passId`, the `segments` array, and `provenance` (section 5). Geometries wider than one ribbon decompose into multiple strips sharing `passId`: TOPS is three interleaved strips with burst sub-structure, a bilateral altimeter is two swath strips plus the nadir chain, a bistatic pair is one strip carrying the baseline. The strip stays the unit of bookkeeping (the flyby noodle rule).

## 2. Invariants (enforced by `validateStrip`)

`id`, `body`, `frame`, and `instrumentId` nonempty; segments nonempty; `etSec` finite and monotonically nondecreasing; edges finite; `state` in the enum; every `sub` entry one of the section 3 kinds with finite coordinates and valid fields; `quality` ranges finite with min at most max and `lookCount` a nonnegative integer; `provenance.authority` and `provenance.generatedBy` nonempty. Width may vary per segment (flyby). Gaps in time are legal and meaningful (bursts, dwell windows, frame chains); adapters must not interpolate across them.

## 3. Sub-structure

`sub` is an optional array of entries from a discriminated union on `kind`. Eight kinds cover the mechanism detail of all 21 families; a family may use several, and the plain envelope (no `sub`) is always legal at rendering grade. Positions inside sub-structure are body-fixed kilometers like the edges.

| kind | fields | carries | typical families |
| --- | --- | --- | --- |
| `sub-swath` | `index`, optional `burstId` | membership in a numbered sub-swath, receive beam, view station, or framelet band; `burstId` names the burst for quilted modes | scansar-tops, sweepsar-dbf, push-frame, multi-angle, bilateral-swath |
| `beads` | `points` | bead, shot, or sample center positions | profiler, pencil-beam-scatterometer, bilateral-swath (nadir chain), limb-occultation |
| `footprint` | `center`, `semiMajorKm`, `semiMinorKm`, `rotationRad` | one resolved sample footprint ellipse; `rotationRad` turns the semi-major axis from local east, counterclockwise seen from outside the body | whiskbroom, step-scan-sounder, conical-radiometer |
| `frame` | `corners` (4 positions), optional `frameId` | a discrete exposure, tasked patch, or sector box outline | framing, spotlight-sar, agile-tasking, target-stare, geo-raster meso boxes |
| `event` | `center`, optional `radiusKm`, optional `eventId` | a point measurement event that pops into existence rather than being swept; `radiusKm` is the ground radius of the event footprint when the model carries one (ADR-0010) | limb-occultation |
| `look` | `index`, `azimuthRad` | an azimuth look direction contributing to the segment | fan-beam-scatterometer |
| `baseline` | `companion` | the companion platform position; the baseline is the measurement | bistatic-formation |
| `sector` | `sectorId`, optional `refreshSec` | a named raster sector with its own refresh clock | geo-raster |

Pushbroom, stripmap-sar, and flyby-swath carry no sub-structure at envelope grade; the flyby signature (width varying continuously) lives in the segments themselves.

## 4. Quality

The quality vocabulary is frozen at three fields, all optional: `incidenceDeg`, a `[min, max]` tuple in degrees; `resolutionM`, a `[min, max]` tuple in meters; `lookCount`, a nonnegative integer count of independent looks accrued. Tuples are ordered (min at most max) and a point value is expressed as `[v, v]`. Per-segment quality serves the quality-gradient treatment and per-strip hover metadata (AGE-14); aggregation across segments is the consumer's business.

## 5. Provenance

`authority` names the computing authority (the provider `id` or engine identity) per the Bessel AnalysisProduct posture (AGE-20). `generatedBy` names the producing component or process. Optional `correction` records the aberration correction requested at the provider seam (SPEC-PROVIDER section 1) and is always present on provider-derived strips, `'NONE'` for rendering-grade body-fixed footprints. Optional `inputs` carries input identities; when a Bessel-backed provider serves the strip, `inputs` carries the `KernelSetInfo.setHash`.

## 6. Canonical JSON serialization

A strip serializes as UTF-8 JSON validating against `schemas/strip.schema.json` (draft-07). Tuples serialize as fixed-length arrays. All numbers are finite JSON numbers; NaN and infinities are unrepresentable and therefore invalid. Optional fields are omitted, never null. The schema is closed (`additionalProperties: false` throughout): unknown fields are a validation error, which is what makes the freeze enforceable. The schema and `validateStrip` check the same invariants at two grades; the schema is structural, the validator adds the cross-field rules (monotonic time, ordered ranges).

## 7. Size and chunking

Guidance, not wire limits: a strip should stay at or below 10000 segments, roughly 1 MiB serialized for plain envelope segments, matching the provider-side batch ceiling (SPEC-PROVIDER section 4) so one query window maps to one strip comfortably. Longer passes split at natural boundaries (burst seams, dwell gaps, fixed time windows) into multiple strips sharing `passId` with unique `id`s; consumers reconstruct pass order by first-segment `etSec`. Sub-structure-heavy strips (beads, footprints) should chunk earlier, at roughly the same serialized size rather than the same segment count.

## 8. AnalysisProduct mapping (AGE-20)

A strip publishes as an AnalysisProduct record: `kind: "acquisition-strip"` with the strip as payload (`StripProduct` in `types.ts`); the provenance authority field carried inside the strip names the computing engine, per ADR-0004. Field-level alignment of the product envelope with the Bessel product contract is explicitly deferred by ADR-0007: the Bessel ADR on product contracts had not landed in the pinned tree as of this freeze. The envelope is additive around the frozen strip payload, so the deferral cannot move the strip schema.
