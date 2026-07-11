# SPEC-INSTRUMENT-MODEL (draft, Phase 0 subject)

Status: draft. Phase 0 freezes the family list, the common envelope, and one worked example per family with a fixture.

## 1. Shape

An instrument model is declarative data: `kind` (one of the 21 geometry families, the normative union lives in `types.ts`), `name`, mount description, scan law and rate, beam or detector layout, timing, and family-specific parameters. Models are contributed as data, not code (AGE-18); the engine maps each `kind` to a sampler that emits strip segments.

## 2. The 21 families

pushbroom, whiskbroom, step-scan-sounder, conical-radiometer, framing, push-frame, multi-angle, profiler, stripmap-sar, scansar-tops, spotlight-sar, sweepsar-dbf, bistatic-formation, fan-beam-scatterometer, pencil-beam-scatterometer, bilateral-swath, limb-occultation, geo-raster, agile-tasking, target-stare, flyby-swath.

## 3. Worked examples (Phase 0 deliverable)

One model file plus one fixture strip per family, starting from the atlas tiles as reference behavior. Tiles 1 (pushbroom) and 21 (flyby-swath) are the conformance anchors: the numeric replay test regenerates their strips from models and compares against committed fixtures.

## 4. Open items

Parameter vocabulary per family; units policy (SI, kilometers, radians); mount composition (gimbal over platform); validity windows.
