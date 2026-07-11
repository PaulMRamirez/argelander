# Requirements: AGE-01 through AGE-20

Verbatim from the survey (docs/acquisition-geometry-survey.md, v1.3). Every commit that changes behavior carries a `Refs: AGE-xx` trailer.

| ID | Requirement |
| --- | --- |
| AGE-01 | The core shall be renderer-agnostic, with no DOM, Leaflet, or three.js dependency, and shall run headlessly under Node for tests and report rendering. |
| AGE-02 | The core shall represent all coverage as time-tagged strips: cross-track segments with edges in body-fixed coordinates, optional sub-structure, and a state field of planned, acquiring, or committed. |
| AGE-03 | The instrument model schema shall express, at minimum, the 21 geometry families of the atlas: pushbroom, whiskbroom, step-scan, conical, framing, push-frame, multi-angle, profiler, stripmap, TOPS/ScanSAR, spotlight, SweepSAR, bistatic formation, fan-beam and pencil-beam scatterometry, bilateral swath with nadir gap, limb and occultation, GEO raster with sectors, agile tasking, target stare, and flyby variable-range swath. |
| AGE-04 | Ephemeris inputs shall include SPICE kernels (primary), SGP4/TLE, and CZML or GeoJSON interchange; live state via a telemetry bridge (Yamcs first) shall extrude the committed strip in real time. All state shall enter through a StateProvider-shaped interface. |
| AGE-05 | All propagation and strip generation shall run off the main thread; the main thread shall only paint. |
| AGE-06 | The engine shall support non-Earth bodies as first-class: arbitrary body radii, body-fixed frames from SPICE, and non-repeating flyby trajectories. |
| AGE-07 | The six treatments (outline, flat fill, now plus trail, mechanism texture, quality gradient, time gradient) shall be pure styling policies over the strip schema, selectable per layer at runtime. |
| AGE-08 | Hue shall be reserved for state (instantaneous, committed, planned) by default; instrument identity shall default to texture. Defaults shall be overridable but the override shall be explicit. |
| AGE-09 | Level of detail shall switch between envelope and mechanism rendering by projected swath width in pixels; sparse geometries (beads, events) shall never be inflated to ribbons. |
| AGE-10 | The Leaflet adapter shall handle antimeridian splitting, polar strips, and MMGIS CRS configurations, painting into a persistent trail canvas with exponential decay. |
| AGE-11 | The three.js adapter shall render strips on the MMGIS Globe with trail decay performed in a framebuffer pass. |
| AGE-12 | The MMGIS layer configuration shall declare acquisition layers (source, instrument model, treatment, palette) without MMGIS core changes beyond layer-type registration. |
| AGE-13 | The engine clock shall bind to the MMGIS time UI; scrubbing shall replay coverage and future time shall preview planned strips. |
| AGE-14 | Accumulated coverage, look count, and gap products shall be exportable as computed layers (raster and H3 aggregates, GeoJSON strip outlines) with provenance metadata per strip: mission, instrument, mode, pass or encounter ID, and quality ranges. |
| AGE-15 | Performance budget: 60 fps with 20 animated layers on reference hardware in the Leaflet adapter; graceful degradation by LOD before frame-rate loss. |
| AGE-16 | Reduced-motion preference shall pre-render one pass and pause; all animation shall be pausable and speed-scalable. |
| AGE-17 | Each geometry class shall ship with a golden-image visual test and a numeric strip test; the atlas is the visual regression corpus. |
| AGE-18 | License shall be Apache-2.0, with the repository structured for community contribution of instrument models as data, not code. |
| AGE-19 | The state interface shall be contract-compatible with the Bessel StateProvider. AGE shall not embed an independent CSPICE build; SPICE-quality states arrive from a provider (a pre-sampled service standalone, cspice-wasm when hosted with Bessel). |
| AGE-20 | Strips shall be publishable as typed AnalysisProduct records carrying the provenance authority field, so acquisition products flow through the same product plumbing as other Bessel results. |
