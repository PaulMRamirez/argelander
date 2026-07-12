# Changelog

## Unreleased

Phase 1 second slice: samplers for the six along-track families. Whiskbroom (mirror sweep with bowtie footprints), framing (keystone frame outlines on the exposure clock), push-frame (lunar swath with filter-band markers), multi-angle (station sub-swaths with per-station looks), and profiler (zero-width bead rows on the distance clock) join the Phase 0 pushbroom anchor, each with a frozen atlas-tile scene and a model fixture round-trip test; the five worked-example strip fixtures retire in favor of regenerated sampler anchors.

Phase 1 first slice: ADR-0008 and the argelander-providers package with the near-earth SGP4 provider (from-source, Spacetrack Report #3 verification corpus, rendering-grade GMST earth-fixed frames, TLE coverage fence), the pre-sampled provider (Hermite state interpolation, slerped orientation, CSV ingestion), and worker port marshalling with transferable batches and structured refusal round-trip.

Seed scaffold: specs (draft), ADRs 0001-0006, phase goals, core types and validation with pushbroom fixture, atlas as day-one demo, CI with Pages deploy, style gate.
