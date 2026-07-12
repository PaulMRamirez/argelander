# Configuring acquisition layers

This guide takes a developer from a first footprint on a Leaflet map to the full configuration surface the live demo exercises: providers, footprint postures, treatments, the engine clock, level-of-detail, palettes, and layer config as data. It documents `argelander-leaflet` and the two seams it sits between. States enter through a StateProvider (SPEC-PROVIDER), strips travel as typed AnalysisProduct records (SPEC-STRIP), and the layer consumes strips and nothing else. The adapter never propagates, never touches SPICE, and never invents geometry; if a strip does not say it, the layer does not draw it.

## The shape of the pipeline

```
StateProvider ──states()──▶ StateBatch ──trackStrip()──▶ Strip ──▶ AcquisitionLayer ──▶ pixels
   (worker,                                (argelander-core)         (argelander-leaflet)
    service,
    or inline)
```

Three packages, three responsibilities. `argelander-providers` answers epoch queries with position and velocity. `argelander-core` turns one target's states into a strip: nadir track, swath edges, beads, scan sub-structure, and the per-segment acquisition state. `argelander-leaflet` paints strips onto a canvas overlay through whatever CRS the host map runs. Nothing in the chain is shared by copy; each stage speaks only the frozen contract of its neighbor. The packages resolve by name inside this workspace; the npm names are registry claims (ADR-0005) and are not yet published with content, so external consumers build from the repository for now.

## Minimal example

One satellite, one instrument, one pass, painted with the default treatment. This runs on the main thread to stay short; the worker posture below is what production hosts should use. Leaflet is the one peer you bring yourself: import its CSS, and give the map container a real height, or the map renders zero pixels tall and nothing appears.

```ts
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { trackStrip } from 'argelander-core';
import { AcquisitionLayer } from 'argelander-leaflet';
import { Sgp4Provider, parseTle } from 'argelander-providers';

const LINE1 = '1 25544U 98067A   26192.31485778  .00005525  00000+0  10843-3 0  9998';
const LINE2 = '2 25544  51.6302 180.6822 0006688 282.4935  77.5305 15.48978902575497';

const provider = new Sgp4Provider([{ line1: LINE1, line2: LINE2, name: 'ISS' }]);
const epochEt = parseTle(LINE1, LINE2, 'ISS').epochEt;

const batch = await provider.states({
  targets: ['ISS'],
  observer: 'EARTH',
  frame: 'ITRF93',
  correction: 'NONE',
  epochs: { start: epochEt, end: epochEt + 5400, step: 15 },
});

const strip = trackStrip(batch, 0, {
  id: 'iss-pass-0',
  body: 'EARTH',
  bodyRadiusKm: 6371,
  instrumentId: 'ISS/demo-scanner',
  authority: provider.id,
  generatedBy: 'my-app',
  swathHalfWidthKm: 80,
});

const map = L.map('map').setView([25, 0], 2);   // #map must have a height
new AcquisitionLayer([strip]).addTo(map);
```

Everything after this section is optional refinement. A strip with a swath half-width paints as a ribbon; the default `flat-fill` treatment hues each segment by its acquisition state using the atlas palette.

Three fields deserve a note before moving on. `authority` is provenance, not decoration: it names the computing authority that produced the states (AGE-20), and the convention is to pass the provider's own `id`. `bodyRadiusKm` is explicit because a StateBatch does not carry one; the geometry is an analytic spherical footprint, rendering grade by design. And `trackStrip` applies a state rule at build time: its `nowEtSec` option defaults to the batch's last epoch, so a freshly built strip arrives fully committed with the final segment acquiring. Hosts that drive a live clock re-state segments later (the clock section below); hosts that render a finished pass can leave the default alone.

## Getting states

The minimal example runs SGP4 inline, which blocks the main thread for exactly as long as propagation takes. The engine posture (AGE-05) is that the main thread only paints, so real hosts put the provider behind a worker using the port pair from `argelander-providers`:

```ts
// sgp4-worker.ts, the propagation side of the seam
import { Sgp4Provider, serveStateProvider } from 'argelander-providers';
import type { StatePortLike } from 'argelander-providers';

const LINE1 = '1 25544U 98067A   26192.31485778  .00005525  00000+0  10843-3 0  9998';
const LINE2 = '2 25544  51.6302 180.6822 0006688 282.4935  77.5305 15.48978902575497';

serveStateProvider(
  globalThis as unknown as StatePortLike,
  new Sgp4Provider([{ line1: LINE1, line2: LINE2, name: 'ISS' }]),
);
```

```ts
// main thread: same StateProvider interface, zero propagation here
import { remoteStateProvider } from 'argelander-providers';

const worker = new Worker('./sgp4-worker.js');
const provider = remoteStateProvider(worker, 'sgp4');
```

A `Worker` assigns to the port parameter directly. The one cast lives on the worker side: `globalThis` is only typed with `postMessage` when the TypeScript config includes the `webworker` lib, so the cast bridges a tsconfig gap, not the seam. Bundle the worker as its own entry point (the demo gives esbuild `main.ts` and `sgp4-worker.ts` as sibling entries) and pass `new Worker` a URL relative to the served page. `remoteStateProvider` returns an object satisfying the same interface as the inline class, so the `trackStrip` code above does not change; batches cross the port as transferable Float64Arrays. The `id` argument names the provider for provenance and error messages; it is an assertion by the caller, not something the port verifies.

Two provider families ship today. `Sgp4Provider` propagates near-earth TLEs from source; deep-space elements (period 225 minutes and up) are refused at construction with a `DeepSpaceUnsupportedError`, so a bad element set fails when the provider is built, not later inside a query. `PresampledProvider` serves states sampled elsewhere, which is how non-Earth bodies and analysis-grade ephemerides arrive; `parsePresampledCsv` loads its table format.

Query-time refusals are `CoverageRefusalError`, and handling one is part of configuring a constellation honestly. Every provider enforces the same contract: queries are atomic (a refusal mutates nothing), oversized queries name the 65536-epoch ceiling, and epochs outside the provider's fence are refused rather than extrapolated. The error carries `body`, `requested`, and `covered` fields naming the window it could not serve, and it round-trips the worker port structurally. Anchor clocks to `parseTle(..).epochEt` and the fence takes care of itself; and when building many layers, isolate the failure the way the demo does, one try/catch per instrument, so a single refused query does not take the constellation down.

## Shaping the footprint

`trackStrip` turns one target's block of a batch into one strip. The posture options:

| Option | Geometry | Typical instrument |
| --- | --- | --- |
| `swathHalfWidthKm` | Symmetric ribbon about the nadir track | Pushbroom and whiskbroom imagers |
| `offsetRangeKm: { nearKm, farKm, side }` | Side-looking ribbon; nadir is never imaged | Stripmap SAR |
| `beadOffsetsKm: [..]` | Sparse cross-track bead chains, never ribboned | Laser altimeters, nadir sounders |
| `scan: {..}` | Footprint ellipses sweeping a ribbon on the whiskbroom triangle law, revealed by LOD | Scanning radiometers |
| none of the above | Zero-width track | Bare ground track |

The combination rules follow the physics. `offsetRangeKm` is exclusive with `swathHalfWidthKm` and `scan`: a side-looking ribbon has no nadir swath to sweep. `scan` requires a positive `swathHalfWidthKm`, because the ellipses sweep that ribbon; it never stands alone (`trackStrip` throws if it does). `beadOffsetsKm` combines freely with any envelope, ribbons included, since beads are per-segment sub-structure rather than an envelope of their own.

Two instrument shapes are not single strips at all, and the decomposition is the configuration:

**Bilateral swaths** (SWOT KaRIn, ASCAT) are two side-looking strips sharing a `passId`, one per side of the nadir gap:

```ts
const common = { body: 'EARTH', bodyRadiusKm: 6371, instrumentId: 'SWOT/karin',
  authority: provider.id, generatedBy: 'my-app', passId: 'pass-0' } as const;
const left  = trackStrip(batch, 0, { ...common, id: 'karin-left',
  offsetRangeKm: { nearKm: 10, farKm: 60, side: 'left' } });
const right = trackStrip(batch, 0, { ...common, id: 'karin-right',
  offsetRangeKm: { nearKm: 10, farKm: 60, side: 'right' } });
new AcquisitionLayer([left, right]).addTo(map);
```

**Tasked acquisition** (SAR imaging slots, pointed scenes) is one strip per commanded window, sharing a `passId`, built from separate batch queries so the gaps between windows are real. SPEC-STRIP forbids interpolating across time gaps, and the painter honors that: it will never ribbon over a gap you left in the data. If you query one continuous batch and slice it, you have created a lie; query per window instead.

## Layer options and treatments

The `AcquisitionLayer` constructor takes the strips and an options object; each option that makes sense to change after construction has a setter.

| Option | Default | Runtime setter | Effect |
| --- | --- | --- | --- |
| `treatment` | `flat-fill` | `setTreatment` | Which rendering recipe paints (table below) |
| `palette` | atlas hues | `setPalette` | The four state hues (AGE-08 override) |
| `trailTauSec` | 15 | `setTrailTau` | Trail decay time constant, wall-clock seconds |
| `mechanismMinWidthPx` | 8 | `setMechanismMinWidthPx` | LOD threshold for the mechanism grade |
| `paused` | false | `setPaused` | Freeze animation (start paused under `prefers-reduced-motion`) |
| `speedScale` | 1 | `setSpeedScale` | Engine seconds per wall second, scales the trail fade |
| `fillAlpha` | 0.35 | none | Constant fill alpha for the fill treatments |
| `lineWidthPx` | 1.5 | none | Envelope stroke width |

Geometry itself is replaced with `setStrips(strips)`, which resets the view and the trail history; that is the call for loading a different pass or constellation. Its sibling `updateStates` (next section) is for re-stating the same geometry and deliberately resets nothing.

A treatment is a named rendering recipe. The exported `TREATMENTS` array and `TREATMENT_LABELS` map are what a host UI should render rather than hard-coding names.

| Treatment | Label | What it encodes |
| --- | --- | --- |
| `outline` | OUTLINE ONLY | Envelope edges only, states as hue |
| `flat-fill` | FLAT FILL | Constant-alpha fill, states as hue |
| `now-trail` | NOW + FADING TRAIL | The engine clock: a bright now line, committed coverage decaying behind it |
| `mechanism` | MECHANISM TEXTURE | Instrument identity: faint fill, cross-track hatching in the instrument's dash pattern, scan sub-structure behind the LOD gate |
| `quality-gradient` | QUALITY GRADIENT | Per-segment quality as a cross-swath alpha gradient |
| `time-gradient` | TIME GRADIENT | Segment age as hue, early to late across the pass span |

Hue belongs to acquisition state by default (AGE-08): teal committed, cyan acquiring, amber planned, in every treatment that shows state. The two explicit overrides are `time-gradient`, where hue encodes age over the strip's own time span, and a custom palette. Instrument identity is a dash pattern derived stably from `instrumentId` by `dashPatternFor`, which is also the right function for drawing legend swatches.

## The clock and the state rule

Strips are static data; liveness is a clock applied to them. Two calls with two distinct jobs, both safe to drive at whatever cadence suits the host:

`layer.setNow(etSec)` drives the paint clock. In `now-trail` it extrudes the trail and advances the now marker every call. In every other treatment the clock's only visible element is the now marker, which sits on a segment and expires 1.5 median steps after the last one, so the layer repaints exactly when the marker would move and skips the call otherwise. Driving `setNow` per animation frame is therefore cheap in every treatment, and the marker never goes stale.

`layer.updateStates(strips)` replaces the strips with re-stated copies of the same geometry, without resetting the view or the trail history. Pair it with `withStateRule` from `argelander-core`, which returns a new strip whose segments follow the engine rule: the last segment at or before the clock is `acquiring`, earlier segments are `committed`, later ones are `planned`.

Putting them together, with every binding shown: `baseStrips` are the strips as built (their build-time states about to be overridden), `epochEt` is the element epoch anchoring the clock, and `speed` is the host's time compression.

```ts
const baseStrips = [strip];                  // from the minimal example
let tauSec = 0;                              // seconds into the pass
const speed = 60;                            // engine seconds per wall second

function tick(dtSec: number): void {
  tauSec = (tauSec + dtSec * speed) % 5400;
  layer.setNow(epochEt + tauSec);
  layer.updateStates(baseStrips.map((s) => withStateRule(s, epochEt + tauSec)));
}
```

States only change on segment boundaries, so `updateStates` can run on a coarser cadence than `setNow`; the demo re-emits when `floor(tauSec / stepSec)` changes and drives `setNow` every frame. Keep updating states for layers that are toggled off, so enabling one lands on the current clock instead of a stale one.

## Level of detail

The `mechanism` treatment carries an LOD gate: when a strip's median projected swath width is below `mechanismMinWidthPx` (default 8), it falls back to a plain envelope; at or above, the hatching and scan sub-structure reveal. Lower values reveal the mechanism earlier as the user zooms in, higher values later; the demo exposes exactly this as its Early (6), Standard (16), Late (40) stops. Two deliberate boundaries: the gate applies only to the `mechanism` treatment, because `now-trail` paints sub-structure with the trail unconditionally (the atlas behavior), and zero-width strips (bead chains) always paint their beads, because a bead chain has no envelope to fall back to.

## Palette

Override the four state hues for a host with its own design system or a colorblind-safe mode, at construction or at runtime:

```ts
const HIGH_CONTRAST = { committed: '#7B9E89', acquiring: '#FFFFFF', planned: '#C287E8', guide: '#5C6B7A' };
const layer = new AcquisitionLayer(strips, { palette: HIGH_CONTRAST });
layer.setPalette({ ...HIGH_CONTRAST, acquiring: '#FFE066' });   // repaints in place
```

The default is `ATLAS_PALETTE`, transcribed from the atlas so the adapter and the visual regression corpus agree. Overriding hue is an AGE-08 decision, not a whim: state hue is the one channel every treatment shares, so keep the three states distinguishable.

## Layer config as data

Everything above is per-layer imperative calls. Hosts that manage many layers should hold one plain record per layer and treat the DOM, the map, and the layers as renders of that array; the demo's panel is a working prototype of the pattern (AGE-12). A workable record shape:

```ts
interface LayerConfig {
  id: string;                       // "SWOT/karin"
  strips: readonly Strip[];         // geometry, the live state rule applied per tick
  layer: AcquisitionLayer;
  enabled: boolean;
  treatment: Treatment;
}

function reconcile(map: L.Map, configs: readonly LayerConfig[]): void {
  for (const c of configs) {
    const on = map.hasLayer(c.layer);
    if (c.enabled && !on) c.layer.addTo(map);
    else if (!c.enabled && on) map.removeLayer(c.layer);
  }
}
```

Every UI handler writes a field and calls `reconcile` plus a render; nothing queries the map for truth.

## Advanced: painting without Leaflet

The painters are pure modules over two small abstractions: a `Projector` (geographic point to container pixels) and a `Canvas2DLike` (the subset of CanvasRenderingContext2D the painters call). `AcquisitionLayer` is a thin binding that supplies both from a Leaflet map; a different host, a test, or a server-side renderer supplies its own:

```ts
import { paintStrip, stripToGeo } from 'argelander-leaflet';

const geo = stripToGeo(strip);
paintStrip(ctx, geo, myProjector, { treatment: 'flat-fill', worldCopies: [0] });
```

`PaintOptions` exposes the same knobs the layer options table listed (`palette`, `mechanismMinWidthPx`, `fillAlpha`, `lineWidthPx`, `nowEtSec`), plus two duties the Leaflet binding otherwise handles. `worldCopies` is the longitude offsets the view can see (`[0]`, plus `360` or `-360` when the view crosses the antimeridian); omit them and point features vanish at the seam. And a repaint policy: the pure painters repaint whatever you ask, so a host that wants the layer's economy can gate static repaints on `nowMarkerIndex(geo, etSec)`, repainting only when the marker's index changes. Projectors that round to integer pixels are safe; the painters measure scale over a half-degree baseline for exactly that reason.

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| DeepSpaceUnsupportedError building the provider | TLE with a period of 225 minutes or more | Serve that object from a `PresampledProvider`; SGP4 here is near-earth only |
| CoverageRefusalError on load | Query outside the TLE fence or the pre-sampled table | Anchor the clock to `parseTle(..).epochEt`; query inside the fence |
| Ribbon drawn across an ocean the instrument never imaged | One continuous batch sliced into windows | One `states()` query per tasked window, strips share a `passId` |
| Mechanism texture never appears | Treatment is not `mechanism`, or swath projects below `mechanismMinWidthPx` | Switch treatment; zoom in or lower the threshold |
| Trail history lost on a data refresh | `setStrips` used for a pure state change | `updateStates` re-states geometry in place; `setStrips` is for new geometry |
| Amber baked into the fading trail | Host repainting trail from live state | Nothing: `paintTrailWindow` paints committed hue by construction; report if seen |
| Features missing at the antimeridian in a custom host | `worldCopies` not passed | Compute offsets from the view; the Leaflet binding does this for you |
