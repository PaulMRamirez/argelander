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

## The minimal example off Earth: the Moon and Mars

Nothing in the pipeline is Earth-shaped. The strip contract's `body` is any SPICE body name, the footprint math takes whatever radius you hand it, and the painters derive their scale from the strip's own geometry, so the entire Earth example above becomes a lunar one by swapping the provider and three constants. Off Earth there are no TLEs; states arrive through `PresampledProvider`, sampled by whatever computes them (a SPICE-backed service, a file, an ephemeris kernel pipeline). The loop below stands in for that table; a real host receives it, it does not compute it.

```ts
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { trackStrip } from 'argelander-core';
import { AcquisitionLayer } from 'argelander-leaflet';
import { PresampledProvider } from 'argelander-providers';

// An LRO-like circular polar pass, 50 km over the Moon, sampled in the
// MOON_ME body-fixed frame: n blocks of (x, y, z, vx, vy, vz) km, km/s.
const R = 1737.4 + 50;
const W = (2 * Math.PI) / 6786;
const N = 361;
const epochs = new Float64Array(N);
const states = new Float64Array(N * 6);
for (let i = 0; i < N; i++) {
  const t = i * 15;
  epochs[i] = t;
  states.set([
    R * Math.cos(W * t), 0, R * Math.sin(W * t),
    -R * W * Math.sin(W * t), 0, R * W * Math.cos(W * t),
  ], i * 6);
}

const provider = new PresampledProvider([{
  body: 'LRO', observer: 'MOON', frame: 'MOON_ME', correction: 'NONE',
  epochs, states,
}], { id: 'my-ephemeris-service' });

const batch = await provider.states({
  targets: ['LRO'],
  observer: 'MOON',
  frame: 'MOON_ME',
  correction: 'NONE',
  epochs: { start: 0, end: 5400, step: 15 },
});

const strip = trackStrip(batch, 0, {
  id: 'lro-pass-0',
  body: 'MOON',
  bodyRadiusKm: 1737.4,
  instrumentId: 'LRO/lroc-wac',
  authority: provider.id,
  generatedBy: 'my-app',
  swathHalfWidthKm: 30,
});

// Planetary tile sets are equirectangular: plate carree CRS, and the NASA
// Trek WMTS pyramid matches Leaflet's EPSG:4326 tiling (2 by 1 at zoom 0).
const map = L.map('map', { crs: L.CRS.EPSG4326, minZoom: 1 }).setView([0, 0], 2);   // #map must have a height
L.tileLayer(
  'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
  { maxNativeZoom: 7, maxZoom: 9 },
).addTo(map);
new AcquisitionLayer([strip]).addTo(map);
```

Mars is the same code with Mars numbers: an MRO-like table (orbit radius `3389.5 + 290`, period about 6770 s) served as `body: 'MRO', observer: 'MARS', frame: 'IAU_MARS'`, a strip built with `body: 'MARS', bodyRadiusKm: 3389.5`, and Trek Mars tiles:

```ts
L.tileLayer(
  'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
  { maxNativeZoom: 7, maxZoom: 9 },
);
```

| Body | `bodyRadiusKm` | Body-fixed frame | Tiles |
| --- | --- | --- | --- |
| Earth | 6371 | `ITRF93` | OSM and friends, Web Mercator |
| Moon | 1737.4 | `MOON_ME` | NASA Moon Trek (LRO WAC), plate carree |
| Mars | 3389.5 | `IAU_MARS` | NASA Mars Trek (Viking MDIM 2.1, MGS MOLA), plate carree |

The provider's `id` option matters more here than anywhere: it is what `authority: provider.id` writes into every strip's provenance (AGE-20), and states that were received rather than computed should name their real computing authority, not the default 'presampled'.

Two boundaries to respect. Tile credits are license and courtesy obligations, so surface them somewhere real (the demo renders them in its panel footer per world and basemap; Mars alone has two credits). And the analytic sphere is rendering grade by charter: oblateness (Mars flattens nearly twice Earth) and irregular bodies (Phobos, comets) exceed it, and the declared path for analysis-grade footprints is the pluggable intercept service seam, not frames math in the engine. The live demo ships all three worlds behind its world control, the whole planetary path exercised end to end: presampled tables, plate carree maps, polar orbits over the poles.

## Getting states

The Earth minimal example runs SGP4 inline, which blocks the main thread for exactly as long as propagation takes. The engine posture (AGE-05) is that the main thread only paints, so real hosts put the provider behind a worker. The worker file is one import of the shipped entry, and the main thread connects with a handshake:

```ts
// sgp4-worker.ts, the whole file
import 'argelander-providers/sgp4-worker';
```

```ts
// main thread: same StateProvider interface, zero propagation here
import { connectSgp4Worker } from 'argelander-providers';

const worker = new Worker('./sgp4-worker.js');
const provider = await connectSgp4Worker(worker, [{ line1: LINE1, line2: LINE2, name: 'ISS' }]);
```

The element sets travel to the worker in an init message, the worker builds `Sgp4Provider` and serves it over the port protocol, and `connectSgp4Worker` resolves only after the worker acknowledges, so no query can race the setup; a construction failure there (a deep-space element set) rejects the promise with the worker's message instead of hanging. Bundle the worker as its own entry point (the demo gives esbuild `main.ts` and `sgp4-worker.ts` as sibling entries) and pass `new Worker` a URL relative to the served page. Batches cross the port as transferable Float64Arrays. For a Celestrak-shaped file, `parseTles(text)` splits 3-line and bare 2-line sets into exactly the array this takes. The lower-level pieces stay exported for custom topologies: `serveStateProvider(port, provider)` serves any provider from any worker or MessagePort, and `remoteStateProvider(port, id)` is the raw proxy; the `id` there is an assertion by the caller, not something the port verifies.

Two provider families ship today, plus two adapters over them. `Sgp4Provider` propagates near-earth TLEs from source; deep-space elements (period 225 minutes and up) are refused at construction with a `DeepSpaceUnsupportedError`, so a bad element set fails when the provider is built, not later inside a query. `PresampledProvider` serves states sampled elsewhere, the planetary path the Moon example above already walked; `parsePresampledCsv` loads its table format from files. The adapters are the section "Other providers" below: CZML playback and the HTTP service wire.

Query-time refusals are `CoverageRefusalError`, and handling one is part of configuring a constellation honestly. Every provider enforces the same contract: queries are atomic (a refusal mutates nothing), oversized queries name the 65536-epoch ceiling, and epochs outside the provider's fence are refused rather than extrapolated. The error carries `body`, `requested`, and `covered` fields naming the window it could not serve, and it round-trips the worker port structurally. Anchor clocks to the fence and it takes care of itself: `parseTle(..).epochEt` for a TLE, the table's first epoch for a pre-sampled table, and both shipped providers implement the contract's optional `coverage(body)`, which returns the servable windows outright (a provider that omits it is treated as unbounded until it refuses). When building many layers, isolate the failure the way the demo does, one try/catch per instrument (and one per provider construction), so a single refusal does not take the constellation down.

## Other providers

**CZML playback** (`czmlProvider`, `parseCzmlStates`), the interchange format ops tools already emit. Position packets become pre-sampled tables and `PresampledProvider` does the serving:

```ts
import { czmlProvider } from 'argelander-providers';

const provider = czmlProvider(czmlText, { observer: 'EARTH', frame: 'ITRF93' }, { id: 'ops-czml' });
```

Scope is honest and narrow. Supported: packets carrying an ISO `epoch` plus time-tagged `cartesian` samples (offset seconds, meters, converted to kilometers), `referenceFrame` FIXED, which is the CZML default and the body-fixed reading the seam wants. Refused, each with a plain `Error` whose message names the boundary (not a typed class, unlike `CoverageRefusalError` above): INERTIAL frames (rotating them body-fixed is frames math, the non-goal), `cartographicDegrees`, constant positions, and ISO-string sample times. A zone-less epoch is read as UTC to match Cesium, and declared interpolation hints are not honored: the samples are re-interpolated by `PresampledProvider`'s cubic Hermite, and velocities are derived from them by weighted central differences, rendering grade and stated as such. Each packet's `id` is the target name you query.

**The HTTP service wire** (`serveStateRequest`, `httpStateProvider`), the states-from-a-service posture. The server side is a pure request-in, response-out function you mount on any framework; the client is a `StateProvider` over `fetch`:

```ts
// server, any framework: the body in, the JSON-safe response out
import { serveStateRequest } from 'argelander-providers';
app.post('/states', async (req, res) => res.json(await serveStateRequest(localProvider, req.body)));

// client
import { httpStateProvider } from 'argelander-providers';
const provider = httpStateProvider('https://svc.example/states', 'bessel-service');
```

The wire speaks the same three ops as the worker port; batches cross as JSON number arrays rebuilt into Float64Arrays client-side, and `CoverageRefusalError` round-trips structurally with its `body`, `requested`, and `covered` fields intact, so refusal handling is identical whether the provider is inline, in a worker, or behind a service.

## Shaping the footprint

`trackStrip` turns one target's block of a batch into one strip. The posture options:

| Option | Geometry | Typical instrument |
| --- | --- | --- |
| `swathHalfWidthKm` | Symmetric ribbon about the nadir track | Pushbroom and whiskbroom imagers |
| `offsetRangeKm: { nearKm, farKm, side }` | Side-looking ribbon; nadir is never imaged | Stripmap SAR |
| `beadOffsetsKm: [..]` | Sparse cross-track bead chains, never ribboned | Laser altimeters, nadir sounders |
| `scan: {..}` | Footprint ellipses sweeping a ribbon on the whiskbroom triangle law, revealed by LOD | Whiskbroom radiometers |
| `stepScan: {..}` | Cross-track ellipse rows, positionsPerRow per segment, growing off-nadir | Cross-track sounders (ATMS, CrIS) |
| `conical: {..}` | One forward crescent footprint per segment on a constant-incidence circle | Conical radiometers (GMI, AMSR2) |
| none of the above | Zero-width track | Bare ground track |

The combination rules follow the physics. `offsetRangeKm` is exclusive with `swathHalfWidthKm`, `scan`, and `stepScan`: a side-looking ribbon has no nadir swath to sweep. `scan` and `stepScan` each require a positive `swathHalfWidthKm`, because they populate that ribbon; `scan` never stands alone. `conical` is a standalone posture, its own forward-circle geometry, exclusive with the swath, `scan`, `stepScan`, `offsetRangeKm`, and `beadOffsetsKm`. `beadOffsetsKm` otherwise combines freely with any envelope, ribbons included, since beads are per-segment sub-structure rather than an envelope of their own. The six exotic families of the atlas (step-scan, conical, limb, geo-raster, agile, target-stare) also have conformance-plane samplers in argelander-core; `stepScan` and `conical` bring the two scanning ones onto live ground tracks.

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

Both decompositions, the window loop, and the provenance defaults are packaged as `passStrips` in argelander-core, the loop hosts kept rewriting until it moved into the package that owns both sides of it. One call replaces everything above:

```ts
import { passStrips } from 'argelander-core';

const strips = await passStrips(provider, {
  target: 'ISS',
  observer: 'EARTH',
  frame: 'ITRF93',
  bodyRadiusKm: 6371,
  instrumentId: 'SWOT/karin',
  generatedBy: 'my-app',
  bilateralKm: { gapKm: 10, outerKm: 60 },
  windows: [[epochEt + 480, epochEt + 1080], [epochEt + 2040, epochEt + 2580]],
  stepSec: 15,
});
```

One `states()` query runs per window (atomic, so a refusal poisons nothing), every strip shares the `passId` (default `'pass-0'`), `authority` defaults to the provider's `id`, and the posture options are the `trackStrip` ones plus `bilateralKm` for the pair, with the same exclusivity: `bilateralKm` cannot combine with a single-strip posture, and empty `windows` throws. Strip ids default to `${instrumentId with '/' folded to '-'}-${passId}-w${n}` (the fold is lossy, so give `idPrefix` explicitly when sibling instruments would collapse to the same prefix). `passStrips` takes any `StateProvider`, so the identical call builds the Moon and Mars layers over a `PresampledProvider`, just with that world's `observer`, `frame`, and `bodyRadiusKm`. Errors propagate as thrown: isolating failures across a constellation is host policy, one try/catch per instrument, exactly as before.

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

That whole loop is packaged as `AcquisitionClock`, the driver the demo proved and two field bugs shaped. It owns the frame loop for any number of layers, applies clock before states with boundary-gated re-emission, and adds pause, speed, and a scrub:

```ts
import { AcquisitionClock } from 'argelander-leaflet';

const clock = new AcquisitionClock(
  // Each entry is a ClockEntry: the layer, its pass anchor, and the strips
  // before the state rule (the clock re-states them per boundary).
  [{ layer, epochEt, baseStrips }],
  { windowSec: 5400, stepSec: 15, speed: 60, paused: reduceMotion,
    onTick: (tau) => label.textContent = `${tau.toFixed(0)} s` },
);
clock.setPaused(true);     // forwards to every layer and freezes the loop
clock.setSpeed(300);
clock.seek(2700);          // scrub to mid-pass and apply immediately (AGE-13)
const at = clock.tauSec;   // read the pass offset, e.g. to carry across a reload
clock.dispose();           // terminal: cancels the loop, resume will not restart
```

The clock applies an opening frame even when constructed `paused` (a paused clock shows the pass at tau zero, not a blank map), the first resumed frame carries no wall-clock gap (a long pause never teleports the clock), and tau wraps at the window. It is re-entrancy safe: calling `setPaused(true)` or `dispose()` from inside `onTick` (the stop-at-end-of-pass pattern) stops cleanly, and `dispose()` is terminal. One browser fact to know: hidden tabs suspend `requestAnimationFrame`, so the clock freezes with the tab and jumps forward on the next visible frame; pass a custom `schedule` (with its matching `cancel`, since the pair must agree on handle identity) if you need different pacing. Hand-rolling the loop stays fully supported; the clock is the loop, packaged.

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
  epochEt: number;                  // pass anchor, also the clock entry's
  baseStrips: readonly Strip[];     // geometry before the state rule
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

The record carries `epochEt` and `baseStrips` precisely so it also feeds the clock: `new AcquisitionClock(configs.map(({ layer, epochEt, baseStrips }) => ({ layer, epochEt, baseStrips })), ...)` drives every layer from the same array the panel renders. The demo's `SatLayer` record is this shape, feeding both.

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
| DeepSpaceUnsupportedError building the provider (inline), or `connectSgp4Worker` rejecting with it | TLE with a period of 225 minutes or more | Serve that object from a `PresampledProvider`; SGP4 here is near-earth only. Over the worker the message and `name` survive (match on `err.name === 'DeepSpaceUnsupportedError'`); only `CoverageRefusalError`, which carries queryable fields, is reconstructed as its class |
| `connectSgp4Worker` promise never settles | Worker file missing its one-import of `argelander-providers/sgp4-worker`, wrong worker URL (404), or a CSP block | Fix the worker entry; on a real `Worker` the load failure rejects via its `error` event, and `timeoutMs` is the backstop for ports without one |
| CZML packet rejected with an `Error` | INERTIAL frame, `cartographicDegrees`, a constant position, or ISO-string sample times | These are out of the honest scope; supply FIXED-frame time-tagged cartesian samples. The message names the boundary (a plain `Error`, not a typed class) |
| HTTP provider throws a plain status Error instead of `CoverageRefusalError` | The refusal body was not returned to the client | `httpStateProvider` revives a refusal whatever the status, but the server must return the `serveStateRequest` body (do not swallow it on a 4xx) |
| CoverageRefusalError on load | Query outside the TLE fence or the pre-sampled table | Anchor to `parseTle(..).epochEt` for TLEs, the table's first epoch for pre-sampled; `coverage(body)` names the servable window |
| Ribbon drawn across an ocean the instrument never imaged | One continuous batch sliced into windows | One `states()` query per tasked window, strips share a `passId` |
| Mechanism texture never appears | Treatment is not `mechanism`, or swath projects below `mechanismMinWidthPx` | Switch treatment; zoom in or lower the threshold |
| Trail history lost on a data refresh | `setStrips` used for a pure state change | `updateStates` re-states geometry in place; `setStrips` is for new geometry |
| Coverage vanishes past 85 degrees latitude | Web Mercator's cutoff on the Earth basemap, not the engine | Run a plate carree map (`L.CRS.EPSG4326`) with an EPSG:4326 tile source (OSM serves Web Mercator only; NASA GIBS publishes EPSG:4326 Earth layers); the painters are tested through both poles |
| Amber baked into the fading trail | Host repainting trail from live state | Nothing: `paintTrailWindow` paints committed hue by construction; report if seen |
| Features missing at the antimeridian in a custom host | `worldCopies` not passed | Compute offsets from the view; the Leaflet binding does this for you |
