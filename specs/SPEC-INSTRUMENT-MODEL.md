# SPEC-INSTRUMENT-MODEL

Status: frozen (Phase 0, 2026-07-11). Changes require an ADR. Frozen here: the family list, the common envelope, the mount composition, the units policy, the per-family parameter vocabulary, and the numeric conformance scenes for the two anchor families. Models are contributed as data, not code (AGE-18); the engine maps each `kind` to a sampler that emits strip segments (SPEC-STRIP).

## 1. Common envelope

An instrument model is declarative data (`InstrumentModel` in `packages/argelander-core/src/types.ts`; one JSON file per worked example under `packages/argelander-core/fixtures/models/`). The envelope: `kind`, one of the 21 families, with the normative union in `types.ts` and its machine form in `model.ts`; `name`, a human-readable label; `instrumentId`, the stable identity carried into `Strip.instrumentId`; `mount`, the composition chain of section 3; `timing`, with `segmentStepSec` (segment emission cadence, seconds) and optional `subStepSec` (sub-sample cadence within a segment where the mechanism requires one); optional `validity`, a `start`/`end` window in Et, where sampling outside validity is a structured refusal mirroring SPEC-PROVIDER section 4; and `params`, the family-specific vocabulary of section 4. `validateInstrumentModel` in `model.ts` enforces the envelope and the presence of each family's required parameters.

## 2. The 21 families

pushbroom, whiskbroom, step-scan-sounder, conical-radiometer, framing, push-frame, multi-angle, profiler, stripmap-sar, scansar-tops, spotlight-sar, sweepsar-dbf, bistatic-formation, fan-beam-scatterometer, pencil-beam-scatterometer, bilateral-swath, limb-occultation, geo-raster, agile-tasking, target-stare, flyby-swath.

## 3. Mount composition

`mount` is a chain of `MountElement`s ordered platform-outward, each of kind `fixed`, `gimbal`, `scan-mirror`, or `spin`, with optional `axis` (unit vector in the frame of the previous element, platform body frame for the first), `halfRangeRad` (articulation half-range), and `rateRadS` (rotation rate). Composition applies in order: element n articulates relative to element n-1, which is how a gimballed spectrometer on a rolled platform (the CRISM dichotomy) is expressed. The empty chain means body-fixed nadir. Phase 0 freezes the shape; Phase 1 samplers interpret at most one articulated element, and deeper chains are legal data awaiting Phase 2 samplers (ADR-0007).

## 4. Units and parameter vocabulary

Units policy: kilometers for length, seconds for time, radians for angles, hertz for rates, meters only for resolution-like quality quantities; every numeric field name carries its unit suffix (Km, Sec, Rad, Hz, M). Angles never appear in degrees inside models; degrees are display-side only. Dimensionless counts, factors, and exponents carry no suffix.

The table below freezes each family's required parameters. Values in worked examples descend from the atlas tiles read at the nominal conformance scale of section 5 (1 km per pixel of the nominal 320 by 240 tile) and are demonstration constants, not mission values. `model.ts` carries the machine form (`FAMILY_REQUIRED_PARAMS`); a model may add optional parameters beyond the required set, and samplers ignore parameters they do not know.

| family | required params | meaning |
| --- | --- | --- |
| pushbroom | `swathHalfWidthKm` | half-width of the continuous ribbon |
| whiskbroom | `swathHalfWidthKm`, `scanRateHz`, `footprintSemiMajorKm`, `footprintSemiMinorKm`, `footprintGrowthFactor` | cross-track sweep extent and rate; nadir sample ellipse; bowtie growth with scan angle (grow = 1 + factor times the squared normalized offset) |
| step-scan-sounder | `swathHalfWidthKm`, `positionsPerRow`, `footprintRadiusKm`, `crossGrowthFactor`, `alongGrowthFactor` | discrete beam positions per row; nadir footprint radius; off-nadir elongation factors |
| conical-radiometer | `scanRadiusKm`, `sectorHalfAngleRad`, `spinPeriodSec`, `footprintSemiMajorKm`, `footprintSemiMinorKm` | ground radius of the cone trace; swept forward sector; spin period; sample ellipse |
| framing | `framePeriodSec`, `frameHalfAlongKm`, `frameHalfCrossKm`, `overlapFactor` | shutter cadence; frame half-extents; leading-edge overlap factor |
| push-frame | `swathHalfWidthKm`, `frameletHalfAlongKm`, `bandCount`, `framePeriodSec` | swath half-width; framelet along-track half-extent; bonded filter band count; exposure cadence |
| multi-angle | `swathHalfWidthKm`, `stationLeadsSec` | common corridor half-width; per-station lead times (positive fore, zero nadir, negative aft) |
| profiler | `beamOffsetsKm`, `pairSplitKm`, `beadStepKm` | cross-track beam group offsets; within-pair split; along-track bead spacing |
| stripmap-sar | `nearRangeKm`, `farRangeKm`, `side` | offset ribbon edges; imaged side (`left` or `right`), because nadir is never imaged |
| scansar-tops | `subSwathRangesKm`, `burstPeriodSec` | flat list of near/far pairs per sub-swath, cycled in bursts |
| spotlight-sar | `patchHalfAlongKm`, `patchHalfCrossKm`, `dwellSec` | tasked patch half-extents; dwell duration |
| sweepsar-dbf | `nearRangeKm`, `farRangeKm`, `beamCount` | full-swath edges; simultaneous receive sub-beams |
| bistatic-formation | `nearRangeKm`, `farRangeKm`, `alongTrackSepKm`, `crossTrackAmpKm` | shared swath edges; companion separation (along-track offset, cross-track helix amplitude) |
| fan-beam-scatterometer | `nearRangeKm`, `farRangeKm`, `azimuthLooksRad`, `beamPeriodSec` | per-side swath edges; azimuth look angles (fore, mid, aft); beam cycling period |
| pencil-beam-scatterometer | `innerRadiusKm`, `outerRadiusKm`, `spinPeriodSec`, `beamPhaseOffsetRad` | two conically scanned beam radii; spin period; phase offset between beams |
| bilateral-swath | `gapHalfWidthKm`, `outerEdgeKm`, `nadirBeadStepKm` | nadir gap half-width and outer swath edge (per side); bead spacing of the nadir altimeter chain in the gap |
| limb-occultation | `tangentLeadSec`, `tangentBeadStepKm`, `eventRadiusKm` | tangent-point lead ahead of the platform; tangent chain spacing; occultation event marker radius |
| geo-raster | `diskRadiusKm`, `fullDiskSec`, `mesoHalfWidthKm`, `mesoRevisitSec` | fixed disk radius; full-disk raster cadence; mesoscale box half-width and revisit clock |
| agile-tasking | `fieldOfRegardHalfKm`, `taskTypes` | plannable field-of-regard half-width; admissible task types (`point`, `strip`, `stereo`, `corridor`) |
| target-stare | `patchHalfAlongKm`, `patchHalfCrossKm`, `dwellStartSec`, `dwellEndSec`, `stretchMaxFactor` | tracked patch half-extents; dwell window within the pass; slant-range stretch ceiling |
| flyby-swath | `nearEdgeOffsetKm`, `minWidthKm`, `widthGrowthKm`, `widthExponent` | near-edge standoff; closest-approach width; width growth toward the trajectory ends; growth exponent |

## 5. Conformance scenes (the two anchors)

Tiles 1 (pushbroom) and 21 (flyby-swath) of the atlas are the conformance anchors: `conformance.ts` regenerates their strips numerically from the model files and the scenes below, and the conformance test compares against the committed fixtures within 1e-6 km per coordinate. The atlas remains the visual reference; these scenes are the numeric reference.

The conformance plane is the atlas tile at its nominal 320 by 240 pixels, read as a 320 km by 240 km tangent patch (1 km per pixel). Plane coordinates (px, py) follow the canvas convention: origin top-left, py growing south. Embedding to body-fixed Cartesian: east = px - 160, north = 120 - py, position = R times the unit vector of (R, east, north), with body-fixed axes x through longitude 0 latitude 0 and z north. Both scenes run one pass of the atlas clock: 10 seconds, 41 segments at sf = i/40, etSec = 10 sf, cross-track repeat offset zero. State rule: segments 0 through 27 committed, segment 28 acquiring (28 = floor of 0.7 times 40), segments 29 through 40 planned.

Tile 1, pushbroom, on EARTH in ITRF93 with R = 6371.0: track direction (sin 0.20, cos 0.20) in plane axes, cross-track normal (-cos 0.20, sin 0.20), track length 426 km (1.4 times the tile height plus 90) centered on the tile center (160, 120); the platform plane position at sf is center plus (sf - 0.5) times track length along the direction. Edges sit at plus and minus `swathHalfWidthKm` (62.4) along the normal; `left` is the negative-normal edge.

Tile 21, flyby-swath, on TITAN in IAU_TITAN with R = 2575.0: quadratic Bezier trajectory with control points (-30, 43.2), (160, 120), (350, 43.2) in plane km (the tile's seeded pass offset pinned to zero); hyperbolic pacing u(sf) = sf - (0.6 / 2 pi) sin(2 pi sf); position is the Bezier at u; the tangent is the analytic derivative 2(1-u)(P1-P0) + 2u(P2-P1), normalized; the cross-track normal is the perpendicular oriented toward the body-center point (160, 283.2); nd = min(1, 2 abs(u - 0.5)); width W = `minWidthKm` + `widthGrowthKm` times nd to the power `widthExponent` (7, 31.2, 1.2); the near edge (`left`) sits `nearEdgeOffsetKm` (5) along the normal and the far edge at that offset plus W. Each segment carries quality `resolutionM = [3 W, 4.5 W]`, a demonstration scaling of resolution with local width. Recorded deviations from the atlas source: the analytic tangent replaces the finite-difference tangent, and the seeded random pass offset is not replayed.

## 6. Worked examples

One model file and one fixture strip per family live under `packages/argelander-core/fixtures/models/` and `fixtures/strips/`, both named `<family>.json`. The two anchors are regenerated by the conformance test (`UPDATE_FIXTURES=1` rewrites them from the samplers); the remainder retire progressively as Phase 1 samplers land, regenerated as sampler anchors by their family tests (UPDATE_FIXTURES=1); families whose samplers have not yet landed remain Phase 0 worked examples at the same conformance scale (see ADR-0007 addendum). Every fixture validates against `validateStrip` and the strip JSON Schema; every model validates against `validateInstrumentModel`.
