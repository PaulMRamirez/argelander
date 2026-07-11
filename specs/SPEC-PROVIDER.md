# SPEC-PROVIDER

Status: frozen (Phase 0, 2026-07-11). Changes to this contract require an ADR. This interface is a strict subset of the Bessel StateProvider contract (AGE-19) plus two additive Argelander facets (`id` and `coverage`, section 1). Argelander consumes states; it never computes them.

## 1. Interface (normative shape in `packages/argelander-core/src/types.ts`)

The seam is async and flat-batch. A provider answers a `StateQuery` with a `StateBatch` and answers a separate `orientation` call with a `QuatBatch`; the TypeScript declarations in `types.ts` transcribe the pinned Bessel contract quoted in section 3, and where prose and code could ever disagree, the code governs.

A `StateQuery` names `targets`, an `observer`, the `frame` the answer must be expressed in, an explicit and never-defaulted `correction`, and `epochs` as either an explicit `Et[]` list or an inclusive `{start, end, step}` range. Frame rides the request, not the provider: Argelander asks for the body-fixed frame directly, so no frame math occurs above the seam. Argelander queries platform state with `observer` set to the target body center, and rendering-grade body-fixed footprints request `correction: 'NONE'`; the requested value is recorded in strip provenance (SPEC-STRIP section 5).

A `StateBatch` is the wire shape: flat, transferable `Float64Array`s (AGE-05). `states` holds `targets.length` blocks of `n` samples of 6 doubles (x, y, z in kilometers then vx, vy, vz in kilometers per second); the state of `targets[t]` at `epochs[i]` begins at `states[(t * n + i) * 6]`, and `lightTimes[t * n + i]` holds one-way light time in seconds. Epochs are `Et`, TDB seconds past J2000, the one time scale of the seam. Units are km and km/s at the contract; conversions stay at the render boundary.

Orientation is a separate, scalar-first call: `orientation(body, frame, epochs)` returns a `QuatBatch` of quaternions in the SPICE m2q layout (w, x, y, z), each rotating vectors expressed in `frame` into the body-fixed frame named by `bodyFrame`. Platform attitude arrives as a CK-frame `bodyFrame`; mount and scan-law composition happen above the seam in Argelander.

`StateSample` is a decoder view over a batch, not the seam: `decodeState(batch, targetIndex, epochIndex)` in `provider.ts` materializes one object-shaped sample for call sites that want it, and `decodeQuat` does the same for orientation. Nothing above the seam holds arrays of samples as the wire form.

Two facets are additive relative to the Bessel contract and are not subset violations. `id` names the provider instance and feeds `Strip.provenance.authority`. `coverage(body)` is optional and advertises validity windows (section 4). Providers are pull-based and pure; caching is the provider's business.

## 2. Standalone providers (Phase 1)

SGP4/TLE in a worker; pre-sampled SPICE states from a service (CSV or CZML ingestion); CZML document playback. Never an embedded CSPICE (ADR-0002). Standalone providers implement the same subset shape: single-target queries, geometric correction, flat batches. Convergence to a live Bessel binding is then the Phase 3 diff this section exists to keep small.

## 3. Bessel contract alignment

Pinned reference: `bessel/packages/frames/src/contracts.ts` at `668ed07`, 2026-07-10, the
published seam contract of Bessel ADR M-0002 (the docs/design/02 section 2 sketch and the
code are transcriptions of each other; the code governs). Everything above the Bessel
frames tier consumes state through this contract and nothing above it calls CSPICE, which
is exactly the posture ADR-0002 requires of Argelander.

Quoted contract (types compacted; layout and convention comments retained because they
are load-bearing):

```ts
export type BodyId = string;   // NAIF body name or numeric id string ('CASSINI', '699')
export type FrameId = string;  // SPICE frame name ('J2000', 'IAU_SATURN', a CK frame)
export type Et = number;       // TDB seconds past J2000, the one time scale of the tier
export type Seconds = number;

/** Aberration correction, explicit at every call site and never defaulted. */
export type Correction = 'NONE' | 'LT' | 'LT+S' | 'CN' | 'CN+S';

export interface StateQuery {
  targets: BodyId[];
  observer: BodyId;
  frame: FrameId;
  correction: Correction;
  epochs: Et[] | { start: Et; end: Et; step: Seconds };
}

/**
 * Zero-copy batch; flat arrays are JS owned and transferable. states holds
 * targets.length blocks of n samples of 6 doubles (x, y, z km then vx, vy, vz km/s);
 * the state of targets[t] at epochs[i] begins at states[(t * n + i) * 6];
 * lightTimes[t * n + i] holds one-way light time in seconds.
 */
export interface StateBatch {
  readonly targets: readonly BodyId[];
  readonly observer: BodyId;
  readonly frame: FrameId;
  readonly correction: Correction;
  readonly epochs: Float64Array;
  readonly states: Float64Array;
  readonly lightTimes: Float64Array;
}

/**
 * Orientation quaternions for one body: n samples of 4 doubles, SPICE
 * scalar-first (w, x, y, z, the m2q layout); each sample rotates vectors
 * expressed in `frame` into the body-fixed frame in `bodyFrame`.
 */
export interface QuatBatch {
  readonly body: BodyId;
  readonly frame: FrameId;
  readonly bodyFrame: FrameId;
  readonly epochs: Float64Array;
  readonly quats: Float64Array;
}

export interface StateProvider {
  states(q: StateQuery): Promise<StateBatch>;
  orientation(body: BodyId, frame: FrameId, epochs: Et[]): Promise<QuatBatch>;
}
```

Adjacent in the same file and relevant to provenance: `KernelSetInfo.setHash`, the sha256
of the sorted per-kernel content hashes, order-independent. When a Bessel-backed provider
serves a strip, `Strip.provenance.inputs` carries that setHash.

Subset and delta register (historical record of the Phase 0 alignment; section 1 is the
frozen result):

| Facet | Bessel contract | Argelander seed | Resolution |
| --- | --- | --- | --- |
| Epoch | `Et`, TDB seconds past J2000 | `etSec`, same scale | Aligned; `etSec` is a field-name spelling of `Et`, no conversion |
| Units | km, km/s at the contract (iron rule 9) | km, km/s | Aligned; conversions stay at the render boundary |
| Call shape | Async, batch, multi-target | Sync `getState`, optional batch | Argelander adopts the async batch as the seam; synchronous access exists only as an internal window over a prefetched batch |
| Batch layout | Flat `Float64Array`, transferable, indexed blocks | Array of sample objects | Adopt the flat layout as the wire shape (serves AGE-05 worker transfer); `StateSample` becomes a decoder view, not the seam |
| Epoch spec | `Et[]` or `{start, end, step}` | `(t0, t1, dt)` | Adopt the union verbatim |
| Observer | Required, explicit | Absent | Argelander queries platform state with `observer` = the target body center |
| Aberration | Explicit `Correction`, never defaulted | Absent (was open item 4) | Argelander passes `correction` explicitly at every call; rendering-grade body-fixed footprints request `'NONE'` (geometric), and the value is recorded in strip provenance |
| Frame | Per query, not per provider | `frame` field on the provider | Move frame to the request; Argelander asks for the body-fixed frame directly so no frame math occurs above the seam |
| Attitude | Separate `orientation()`, scalar-first (w, x, y, z), rotates `frame` into `bodyFrame` | Optional `attitude` on the sample, ordering unspecified (open item 4) | Adopt the separate call and the scalar-first convention; platform attitude arrives as a CK-frame `bodyFrame`, and mount and scan-law composition happen above the seam in Argelander |
| Provider identity | None on the interface | `id` field | Keep `id` on the Argelander wrapper for `provenance.authority`; it is additive, not a subset violation |
| Provenance | `KernelSetInfo.setHash` | `provenance.inputs: string[]` | `inputs` carries the setHash when Bessel-backed |

## 4. Resolutions (Phase 0; previously the open items)

Error semantics outside validity windows: when requested epochs fall outside kernel coverage, the TLE fence, or the pre-sampled span, the provider rejects with a structured refusal naming the covered windows, never silent NaN fills and never clamping, because a clamped state renders as a confidently wrong footprint. The normative shape is `CoverageRefusalError` in `provider.ts`: the `body`, the `requested` window, the `covered` windows (empty when none are advertised), and a human-readable message. A query is atomic: either every requested epoch is covered or the whole query refuses; partial batches are never returned.

Coverage advertisement: the provider interface carries an optional `coverage(body)` returning valid windows as `CoverageWindow[]` (`start` and `end` in `Et`), mapping to spkcov and ckcov when Bessel-backed and to epoch fences for SGP4 and pre-sampled providers. A provider that omits `coverage` is treated as unbounded until it refuses. This is what lets the engine paint planned strips amber beyond coverage instead of failing there.

Batch sizing: a soft ceiling of 65536 epochs per query, exported as `SOFT_MAX_EPOCHS_PER_QUERY` in `provider.ts`; at 6 doubles per sample that is 3 MiB of state data per target, comfortably one worker transfer inside a frame budget (AGE-05). Engines chunk longer spans into successive queries over adjacent windows and stitch strips at the boundary (SPEC-STRIP section 7); providers may refuse oversized queries, using the same structured refusal with the ceiling named in the message. The ceiling is sizing guidance with teeth on the provider side, not a wire-format constant: a batch of any size remains structurally valid.
