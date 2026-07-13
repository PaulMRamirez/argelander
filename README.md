# Argelander

Acquisition geometry engine (functional identity: AGE). Instrument models and ephemerides in, time-tagged footprint strips out. Renderer adapters paint them.

The product line: Cosmolabe is what you see, Bessel is what computes, Argelander is what surveys.

## The name

Friedrich Wilhelm Argelander (1799 to 1875) was Bessel's doctoral student and assistant at Konigsberg, and the maker of the Bonner Durchmusterung, the survey that fixed 324,198 stars from the north celestial pole down to two degrees below the equator, complete to about magnitude 9.5, positions good to roughly an arcminute. It was the last great star map made without photography, and its method is why this engine carries his name. Argelander held a meridian telescope fixed at the mean declination of a zone and let the Earth's rotation carry stars across a stationary reticle line, recording each transit's time and where along the line it crossed. A fixed cross-track line, along-track motion supplied by the platform, coverage accumulated as time-tagged crossings: that is a pushbroom sensor, and the Bonner Durchmusterung is its ur-form. Atlas tile 1, the family every other family is measured against, is exactly this geometry.

What the engine provides is that method generalized and turned onto acquisition. Argelander swept one geometry across the sky to build a reproducible catalog; this engine models twenty-one acquisition geometries sweeping bodies to build reproducible coverage: time-tagged footprint strips, each carrying the provenance of the authority that produced its states, deterministic enough that the conformance suite replays the atlas numerically. It answers the surveyor's question (what did this instrument cover, and when) rather than the analyst's (what is that target), which is the division of labor the product line above names: compute below, survey here, render above.

The boundary is his too. Argelander accepted arcminute positions in exchange for comprehensive, systematic coverage and left sub-arcsecond precision to the lineage of his teacher, who measured the first stellar parallax. This engine makes the same trade by charter: rendering-grade analytic footprint geometry, with analysis-grade intercepts delegated to a pluggable service and the states themselves arriving from providers rather than computed here. Survey-grade coverage, provenance attached, precision deferred. That is what Argelander did with a fixed telescope and a clock, and it is what this repository does with instrument models and ephemerides.

## What lives here

| Path | Purpose |
| --- | --- |
| `packages/argelander-core` | Renderer-agnostic engine: strip schema, instrument models, family samplers, validation. Zero runtime dependencies. |
| `packages/argelander-providers` | Standalone StateProviders below the seam: near-earth SGP4 from source, pre-sampled playback, worker port marshalling (ADR-0008). |
| `packages/argelander-leaflet` | Leaflet adapter (MMGIS 2D Map first target). Phase 1. |
| `packages/argelander-three` | Three.js adapter (MMGIS Globe and Cosmolabe hosts). Phase 2, blocked on ADR-0006. |
| `packages/argelander` | Umbrella package re-exporting core (claims the npm name). |
| `apps/atlas` | The Acquisition Geometry Atlas: 21 geometry families, 6 treatments. Day-one public demo and the visual regression corpus. |
| `apps/demo-leaflet` | First host-shaped demo: SGP4-driven live footprints over open tiles. Phase 1. |
| `specs/` | SPEC-STRIP, SPEC-INSTRUMENT-MODEL, SPEC-PROVIDER. Source of truth; code follows spec. |
| `adr/` | Architecture decision records. |
| `goals/` | Phase goal files with exit criteria. Claude Code executes these. |

## Quickstart

```bash
corepack enable
pnpm install
pnpm verify        # style gate + typecheck + tests
```

Open `apps/atlas/index.html` in a browser for the demo. No build step, no server.

## Governance

Apache-2.0. DCO sign-off required (`git commit -s`). ADR discipline: any new runtime dependency in core, any seam change, any schema change gets an ADR first. Destination recorded in ADR-0001: NASA-AMMOS or the Open Mission Foundation scope; personal org until then.
