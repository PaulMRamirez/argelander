# ADR-0009: pass orchestration helpers and the provider growth set

Status: proposed. Date: 2026-07-12.

## Decision

Two orchestration helpers and four provider additions, all beneath or beside the frozen seams, none touching them.

`passStrips` (argelander-core): an async helper that turns one instrument's pass into its strips by running the canonical loop hosts keep rewriting: one atomic `states()` query per tasked window, `trackStrip` per window with strips sharing a `passId`, the bilateral pair decomposed into two side-looking strips, provenance defaulted to the provider's `id`. Core already owns both interfaces this helper speaks (StateProvider on one side, `trackStrip` on the other), so nothing new crosses a seam; the helper is the bridge the demo wrote twice (Earth, then the worlds) promoted to the package that owns the bridge. Failure isolation stays with hosts: `passStrips` throws what the provider throws, and a constellation loop wraps it per instrument, which is policy, not plumbing. Core stays zero-dependency and propagation-free; the helper computes nothing, it orchestrates.

`AcquisitionClock` (argelander-leaflet): a driver that owns the animation loop the live demo proved and two field bugs shaped: the pass-fraction clock, `setNow` per frame, segment-boundary-gated `updateStates` through `withStateRule` (clock before states, the SWOT ordering lesson), pause and speed, and a `seek` for scrubbing (AGE-13 groundwork). The frame scheduler is injectable so the class tests headlessly. The adapter package already depends on argelander-core at runtime, so importing `withStateRule` adds nothing.

Provider growth (argelander-providers), each item inside the ADR-0008 charter:

- `parseTles(text)`: the multi-TLE text parser (3-line named sets and bare 2-line sets) feeding `Sgp4Provider`, because every host has a Celestrak-shaped file and was writing this loop by hand.
- A self-registering worker entry (`argelander-providers/sgp4-worker`) plus `connectSgp4Worker(port, tles)`: the host's worker file collapses to one import; TLEs travel to the worker in an init message, the worker builds `Sgp4Provider` and serves it, and the connect helper resolves only after a ready handshake so no query can race the setup. Construction failures (a deep-space TLE) reject the connect promise with the worker's message instead of hanging.
- CZML playback, the provider ADR-0008 explicitly deferred here: `parseCzmlStates` reads position packets (ISO epoch plus offset-seconds cartesian samples, meters converted to kilometers) into pre-sampled tables, and `czmlProvider` wraps them in a `PresampledProvider`. Velocities are derived by central finite differences over the samples, rendering grade and stated as such. Scope is honest and narrow: `referenceFrame` FIXED only, because INERTIAL positions would need a rotation model, which is frames math, the non-goal; inertial packets refuse with an error naming the boundary. `cartographicDegrees` and sampled-interpolation exotica refuse likewise rather than approximating silently.
- An HTTP flavor of the port wire, the "states from a service" posture: `serveStateRequest(provider, request)` is a pure request-in, response-out function a host mounts on any server, and `httpStateProvider(url, id)` is the fetch client. Batches cross as JSON number arrays (rebuilt into Float64Arrays client-side) and `CoverageRefusalError` round-trips structurally exactly as it does over the message port. This is the Phase 3 convergence shape from ADR-0008's rationale: a live Bessel binding is one more provider against the identical seam, and now also one more transport.

## Rationale

The developer guide's review cycles kept confirming the same finding from different lenses: the friction is not in the seams but in the choreography around them, written identically by every host. Promoting the two choreographies with field-tested shapes (the demo's `instrumentStrips` and its tick loop) removes the places the known traps live without hiding a single seam: hosts still see providers, strips, and layers, they just stop hand-rolling the glue. The provider additions grow the package exactly along ADR-0008's stated lines (CZML deferred to Phase 1, service binding as the convergence path) with zero new dependencies. Declined again: a runtime Horizons provider (inertial frames only, and the conversion is the frames-math non-goal; an offline fetch into pre-sampled CSV is the honest tooling shape) and basemap or tile helpers in a versioned library (third-party tile URLs rot; they stay in the guide and the demo).

Refs: AGE-04, AGE-05, AGE-12, AGE-13
