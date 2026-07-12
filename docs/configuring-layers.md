# Configuring acquisition layers

This guide takes a developer from a first footprint on a Leaflet map to the full configuration surface the live demo exercises: providers, footprint postures, treatments, the engine clock, level-of-detail, palettes, and layer config as data. It documents `argelander-leaflet` and the two seams it sits between. States enter through a StateProvider (SPEC-PROVIDER), strips travel as typed AnalysisProduct records (SPEC-STRIP), and the layer consumes strips and nothing else. The adapter never propagates, never touches SPICE, and never invents geometry; if a strip does not say it, the layer does not draw it.

## The shape of the pipeline

```
StateProvider ──states()──▶ StateBatch ──trackStrip()──▶ Strip ──▶ AcquisitionLayer ──▶ pixels
   (worker,                                (argelander-core)         (argelander-leaflet)
    service,
    or inline)
```

Three packages, three responsibilities. `argelander-providers` answers epoch queries with position and velocity. `argelander-core` turns one target's states into a strip: nadir track, swath edges, beads, scan sub-structure, and the per-segment acquisition state. `argelander-leaflet` paints strips onto a canvas overlay through whatever CRS the host map runs. Nothing in the chain is shared by copy; each stage speaks only the frozen contract of its neighbor.

## Minimal example

One satellite, one instrument, one pass, painted with the default treatment. This runs on the main thread to stay short; the worker posture below is what production hosts should use.

```ts
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

const map = L.map('map').setView([25, 0], 2);
new AcquisitionLayer([strip]).addTo(map);
```

Everything after this section is optional refinement. A strip with a swath half-width paints as a ribbon; the default `flat-fill` treatment hues each segment by its acquisition state using the atlas palette.

Two fields deserve a note before moving on. `authority` is provenance, not decoration: it names the computing authority that produced the states (AGE-20), and the convention is to pass the provider's own `id`. `bodyRadiusKm` is explicit because a StateBatch does not carry one; the geometry is an analytic spherical footprint, rendering grade by design.

## Getting states

The minimal example runs SGP4 inline, which blocks the main thread for exactly as long as propagation takes. The engine posture (AGE-05) is that the main thread only paints, so real hosts put the provider behind a worker using the port pair from `argelander-providers`:

```ts
// sgp4-worker.ts, the propagation side of the seam
import { Sgp4Provider, serveStateProvider } from 'argelander-providers';
import type { StatePortLike } from 'argelander-providers';

serveStateProvider(
  globalThis as unknown as StatePortLike,
  new Sgp4Provider([{ line1: LINE1, line2: LINE2, name: 'ISS' }]),
);
```

```ts
// main thread: same StateProvider interface, zero propagation here
import { remoteStateProvider } from 'argelander-providers';
import type { StatePortLike } from 'argelander-providers';

const worker = new Worker('./sgp4-worker.js');
const provider = remoteStateProvider(worker as unknown as StatePortLike, 'sgp4');
```

`remoteStateProvider` returns an object satisfying the same interface as the inline class, so the `trackStrip` code above does not change. Batches cross the port as transferable Float64Arrays.

Two provider families ship today. `Sgp4Provider` propagates near-earth TLEs from source (deep-space elements are refused, honestly, with a CoverageRefusalError). `PresampledProvider` serves states sampled elsewhere, which is how non-Earth bodies and analysis-grade ephemerides arrive; `parsePresampledCsv` loads its table format. Every provider enforces the same contract: queries are atomic (a refusal mutates nothing), oversized queries name the 65536-epoch ceiling, and epochs outside the provider's fence are refused rather than extrapolated.

## Shaping the footprint

`trackStrip` turns one target's block of a batch into one strip. The posture options are mutually exclusive where physics says they are:

| Option | Geometry | Typical instrument |
| --- | --- | --- |
| `swathHalfWidthKm` | Symmetric ribbon about the nadir track | Pushbroom and whiskbroom imagers |
| `offsetRangeKm: { nearKm, farKm, side }` | Side-looking ribbon; nadir is never imaged | Stripmap SAR |
| `beadOffsetsKm: [..]` | Sparse cross-track bead chains, never ribboned | Laser altimeters, nadir sounders |
| `scan: {..}` | Ribbon plus footprint ellipses sweeping the whiskbroom triangle law, revealed by LOD | Scanning radiometers |
| none of the above | Zero-width track | Bare ground track |

`swathHalfWidthKm`, `offsetRangeKm`, and `scan` describe one physical mechanism each, so a strip carries at most one of them; `beadOffsetsKm` may not combine with a ribbon either. Two instrument shapes are not single strips at all, and the decomposition is the configuration:

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

## Treatments

A treatment is a named rendering recipe. The layer takes one at construction (`treatment` option) and switches at runtime with `setTreatment`; the exported `TREATMENTS` array and `TREATMENT_LABELS` map are what a host UI should render rather than hard-coding names.

| Treatment | Label | What it encodes |
| --- | --- | --- |
| `outline` | OUTLINE ONLY | Envelope edges only, states as hue |
| `flat-fill` | FLAT FILL | Constant-alpha fill, states as hue |
| `now-trail` | NOW + FADING TRAIL | The engine clock: a bright now line, committed coverage decaying behind it |
| `mechanism` | MECHANISM TEXTURE | Instrument identity: faint fill, cross-track hatching in the instrument's dash pattern, scan sub-structure behind the LOD gate |
| `quality-gradient` | QUALITY GRADIENT | Per-segment quality as a cross-swath alpha gradient |
| `time-gradient` | TIME GRADIENT | Segment age as hue, early to late through the pass |

Hue belongs to acquisition state by default (AGE-08): teal committed, cyan acquiring, amber planned, in every treatment that shows state. The two explicit overrides are `time-gradient`, where hue encodes age, and a custom palette (below). Instrument identity is a dash pattern derived stably from `instrumentId` by `dashPatternFor`, which is also the right function for drawing legend swatches.

## The clock and the state rule

Strips are static data; liveness is a clock applied to them. Two calls with two distinct jobs:

`layer.setNow(etSec)` drives the paint clock. In `now-trail` it advances the trail and the now marker; in `time-gradient` it re-anchors the age ramp. It repaints only what depends on the clock.

`layer.updateStates(strips)` replaces the strips with re-stated copies of the same geometry, without resetting the view or the trail history. Pair it with `withStateRule` from `argelander-core`, which returns a new strip whose segments follow the engine rule: the last segment at or before the clock is `acquiring`, earlier segments are `committed`, later ones are `planned`.

```ts
let tauSec = 0;
function tick(dtSec: number): void {
  tauSec += dtSec * speed;
  layer.setNow(epochEt + tauSec);                       // clock first
  layer.updateStates(baseStrips.map((s) => withStateRule(s, epochEt + tauSec)));
}
```

Order matters: clock first, then states, or the now marker lags the state front by one segment. States only change on segment boundaries, so a host can re-emit them on a coarser cadence than the paint clock (the demo re-emits when `floor(tauSec / stepSec)` changes). `setPaused(true)` freezes animation (start paused when `prefers-reduced-motion` matches; the demo does), and `setSpeedScale(n)` scales the trail-fade clock to match a host running faster than wall time.

## Level of detail

The `mechanism` treatment carries an LOD gate: when a strip's median projected swath width is below `mechanismMinWidthPx` (default 8), it falls back to a plain envelope; at or above, the hatching and scan sub-structure reveal. Set it at construction or at runtime with `setMechanismMinWidthPx(px)`. Lower values reveal the mechanism earlier as the user zooms in, higher values later; the demo exposes exactly this as its Early (6), Standard (16), Late (40) stops. Two deliberate boundaries: the gate applies only to the `mechanism` treatment, because `now-trail` paints sub-structure with the trail unconditionally (the atlas behavior), and zero-width strips (bead chains) always paint their beads, because a bead chain has no envelope to fall back to.

## Palette

Pass `palette` to override the four state hues, for hosts with their own design system or colorblind-safe modes:

```ts
new AcquisitionLayer(strips, {
  palette: { committed: '#4FAEBC', acquiring: '#66DBF8', planned: '#F0B255', guide: '#94B0CD' },
});
```

The default is `ATLAS_PALETTE`, transcribed from the atlas so the adapter and the visual regression corpus agree. Overriding hue is an AGE-08 decision, not a whim: state hue is the one channel every treatment shares, so keep the three states distinguishable.

## Layer config as data

Everything above is per-layer imperative calls. Hosts that manage many layers should hold one plain record per layer and treat the DOM, the map, and the layers as renders of that array; the demo's panel is a working prototype of the pattern (AGE-12). A workable record shape:

```ts
interface LayerConfig {
  id: string;                       // "SWOT/karin"
  strips: readonly Strip[];         // geometry, state rule not yet applied
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

Every UI handler writes a field and calls `reconcile` plus a render; nothing queries the map for truth. Keep updating states for disabled layers too, so enabling one lands on the current clock instead of a stale one.

## Advanced: painting without Leaflet

The painters are pure modules over two small abstractions: a `Projector` (geographic point to container pixels) and a `Canvas2DLike` (the subset of CanvasRenderingContext2D the painters call). `AcquisitionLayer` is a thin binding that supplies both from a Leaflet map; a different host, a test, or a server-side renderer supplies its own:

```ts
import { paintStrip, stripToGeo } from 'argelander-leaflet';

const geo = stripToGeo(strip);
paintStrip(ctx, geo, myProjector, { treatment: 'flat-fill', worldCopies: [0] });
```

`worldCopies` is the one duty a custom host inherits: pass the longitude offsets its view can see (`[0]`, plus `360` or `-360` when the view crosses the antimeridian), or point features vanish at the seam. The Leaflet binding computes this from map bounds automatically. Projectors that round to integer pixels are safe; the painters measure scale over a half-degree baseline for exactly that reason.

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| CoverageRefusalError on load | Query outside the TLE fence or the pre-sampled table | Anchor the clock to `parseTle(..).epochEt`; query inside the fence |
| Ribbon drawn across an ocean the instrument never imaged | One continuous batch sliced into windows | One `states()` query per tasked window, strips share a `passId` |
| Mechanism texture never appears | Treatment is not `mechanism`, or swath projects below `mechanismMinWidthPx` | Switch treatment; zoom in or lower the threshold |
| Now marker one segment behind the acquiring band | States re-emitted before the clock advanced | Call `setNow` before `updateStates` each tick |
| Amber baked into the fading trail | Host repainting trail from live state | Nothing: `paintTrailWindow` paints committed hue by construction; report if seen |
| Features missing at the antimeridian in a custom host | `worldCopies` not passed | Compute offsets from the view; the Leaflet binding does this for you |
