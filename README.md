# Argelander

Acquisition geometry engine (functional identity: AGE). Instrument models and ephemerides in, time-tagged footprint strips out. Renderer adapters paint them.

The product line: Cosmolabe is what you see, Bessel is what computes, Argelander is what surveys. Named for Friedrich Argelander, Bessel's pupil at Konigsberg, whose Bonner Durchmusterung surveyed the sky in drift-scan declination zones: the ur-pushbroom, 324,198 stars accumulated into the first comprehensive modern catalog.

## What lives here

| Path | Purpose |
| --- | --- |
| `packages/argelander-core` | Renderer-agnostic engine: strip schema, instrument models, validation. Zero runtime dependencies. |
| `packages/argelander-leaflet` | Leaflet adapter (MMGIS 2D Map first target). Phase 1. |
| `packages/argelander-three` | Three.js adapter (MMGIS Globe and Cosmolabe hosts). Phase 2, blocked on ADR-0006. |
| `packages/argelander` | Umbrella package re-exporting core (claims the npm name). |
| `apps/atlas` | The Acquisition Geometry Atlas: 21 geometry families, 6 treatments. Day-one public demo and the visual regression corpus. |
| `apps/demo-leaflet` | First host-shaped demo: SGP4-driven live footprints over open tiles. Phase 1. |
| `specs/` | SPEC-STRIP, SPEC-INSTRUMENT-MODEL, SPEC-PROVIDER. Source of truth; code follows spec. |
| `adr/` | Architecture decision records 0001-0006. |
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
