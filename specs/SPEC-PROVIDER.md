# SPEC-PROVIDER (draft, Phase 0 subject)

Status: draft. This interface is a strict subset of the Bessel StateProvider contract (AGE-19). Argelander consumes states; it never computes them.

## 1. Interface (normative shape in `types.ts`)

A `StateProvider` exposes `id`, `frame` (the frame its states are expressed in), and `getState(etSec)` returning a `StateSample`: `etSec`, `positionKm`, `velocityKmS`, optional `attitude` quaternion. An optional batch `sample(t0, t1, dtSec)` exists for worker-side prefetch. Providers are pull-based and pure; caching is the provider's business.

## 2. Standalone providers (Phase 1)

SGP4/TLE in a worker; pre-sampled SPICE states from a service (CSV or CZML ingestion); CZML document playback. Never an embedded CSPICE (ADR-0002).

## 3. Bessel contract alignment

Paste the current Bessel StateProvider draft here read-only at bootstrap (SETUP step 6) and record deltas. Convergence is a binding, not a port: this section exists so the binding is a diff, not a discovery. Pin: Bessel ADR on the StateProvider contract; the spine bake-off outcome does not change this seam.

## 4. Open items

Attitude conventions (quaternion order, frame); light-time and aberration flags (owned by the provider, surfaced as metadata); error semantics outside validity windows.
