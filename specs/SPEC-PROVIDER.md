# SPEC-PROVIDER (draft, Phase 0 subject)

Status: draft. This interface is a strict subset of the Bessel StateProvider contract (AGE-19). Argelander consumes states; it never computes them.

## 1. Interface (normative shape in `types.ts`)

A `StateProvider` exposes `id`, `frame` (the frame its states are expressed in), and `getState(etSec)` returning a `StateSample`: `etSec`, `positionKm`, `velocityKmS`, optional `attitude` quaternion. An optional batch `sample(t0, t1, dtSec)` exists for worker-side prefetch. Providers are pull-based and pure; caching is the provider's business.

## 2. Standalone providers (Phase 1)

SGP4/TLE in a worker; pre-sampled SPICE states from a service (CSV or CZML ingestion); CZML document playback. Never an embedded CSPICE (ADR-0002).

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

Subset and delta register:

| Facet | Bessel contract | Argelander seed | Resolution |
| --- | --- | --- | --- |
| Epoch | `Et`, TDB seconds past J2000 | `etSec`, same scale | Aligned; `etSec` is a field-name spelling of `Et`, no conversion |
| Units | km, km/s at the contract (iron rule 9) | km, km/s | Aligned; conversions stay at the render boundary |
| Call shape | Async, batch, multi-target | Sync `getState`, optional batch | Argelander adopts the async batch as the seam; synchronous access exists only as an internal window over a prefetched batch (Phase 0 revision of section 1 and `types.ts`) |
| Batch layout | Flat `Float64Array`, transferable, indexed blocks | Array of sample objects | Adopt the flat layout as the wire shape (serves AGE-05 worker transfer); `StateSample` becomes a decoder view, not the seam |
| Epoch spec | `Et[]` or `{start, end, step}` | `(t0, t1, dt)` | Adopt the union verbatim |
| Observer | Required, explicit | Absent | Argelander queries platform state with `observer` = the target body center |
| Aberration | Explicit `Correction`, never defaulted | Absent (was open item 4) | Argelander passes `correction` explicitly at every call; rendering-grade body-fixed footprints request `'NONE'` (geometric), and the value is recorded in strip provenance |
| Frame | Per query, not per provider | `frame` field on the provider | Move frame to the request; Argelander asks for the body-fixed frame directly so no frame math occurs above the seam |
| Attitude | Separate `orientation()`, scalar-first (w, x, y, z), rotates `frame` into `bodyFrame` | Optional `attitude` on the sample, ordering unspecified (open item 4) | Adopt the separate call and the scalar-first convention; platform attitude arrives as a CK-frame `bodyFrame`, and mount and scan-law composition happen above the seam in Argelander |
| Provider identity | None on the interface | `id` field | Keep `id` on the Argelander wrapper for `provenance.authority`; it is additive, not a subset violation |
| Provenance | `KernelSetInfo.setHash` | `provenance.inputs: string[]` | `inputs` carries the setHash when Bessel-backed |

Standalone providers (SGP4, pre-sampled, CZML) implement the same subset shape:
single-target queries, geometric correction, flat batches. Convergence to a live Bessel
binding is then the Phase 3 diff this section exists to keep small.


## 4. Open items

Resolved by the section 3 pin (668ed07): attitude conventions, adopted as the separate
orientation call with SPICE scalar-first quaternions rotating `frame` into `bodyFrame`;
aberration flags, adopted as the explicit never-defaulted `Correction` at every call
site, `'NONE'` for rendering-grade body-fixed footprints, recorded in strip provenance.

Still open for Phase 0:

Error semantics outside validity windows: what a provider returns when requested epochs
fall outside kernel coverage, TLE fence, or pre-sampled span. Candidate resolution: a
structured refusal naming the covered window, never silent NaN fills or clamping,
because a clamped state renders as a confidently wrong footprint.

Coverage advertisement: whether the provider interface carries an optional
`coverage(body)` returning valid windows, mapping to spkcov and ckcov when
Bessel-backed and to epoch fences for SGP4 and pre-sampled providers. This is what
lets the engine paint planned strips amber beyond coverage instead of failing there.

Batch sizing: chunking guidance for long passes so Float64Array transfers to workers
stay within frame budget (AGE-05); a soft ceiling per transfer and a streaming pattern
for multi-orbit spans.
