# ADR-0017: the pluggable intercept service seam

Status: proposed, deferred. Date: 2026-07-13.

## Context

The charter names a seam it never fixes. CLAUDE.md states as a hard non-goal that there is no frames math beyond analytic ellipsoid intersection for rendering-grade footprints, and that analysis-grade intercepts delegate through the pluggable intercept service. The survey names it as one of the three seams: the engine computes rendering-grade footprints by analytic intersection internally and exposes a pluggable intercept service so analysis-grade, terrain-true footprints delegate to the sincpt path in Bessel, or a DEM service, when precision matters. ADR-0013 already leans on it. Yet no ADR records the seam's shape, so the boundary the whole rendering-grade posture rests on is asserted in prose and implemented nowhere. This ADR records the seam so the boundary has a home; it is proposed and deferred, because the concrete interface lands only when a host needs analysis-grade footprints, and recording it now keeps the corpus honest about a charter seam rather than fixing a wire shape prematurely.

## Decision (proposed)

The engine computes rendering-grade footprint geometry internally, the analytic sphere intersection bounded by the rendering-grade error budget (ADR-0018), and never performs a terrain-true or ellipsoid-precise or oblateness-corrected intercept itself. Those are delegated across a pluggable intercept service seam, a StateProvider-shaped boundary on the outbound geometry side: a host supplies an intercept function that takes a boresight or a look ray, a body, and an epoch, and returns a body-fixed surface point at analysis grade, or a structured refusal, resolved against whatever shape model or DEM the host has (the Bessel sincpt path, a DEM ray-cast service). The seam is pull-based and pure like the state seam, and a strip records on its provenance whether its edges are rendering grade (internal) or analysis grade (delegated), so the two never blur. The engine ships with no intercept service and does not require one; a rendering-grade strip is complete without it. The concrete interface (the exact function signature, the batch shape, the refusal contract) is specified when the first host requires analysis-grade footprints, at which point this ADR flips to accepted with that interface; until then it fixes only the boundary and the delegation targets.

## Rationale

The boundary is load-bearing and already assumed by the charter, the survey, and ADR-0013, so leaving it with no ADR is the gap the corpus review found: a reader cannot tell where rendering grade ends and analysis grade begins except by inference. Recording it as a proposed, deferred seam, in the manner of ADR-0006, matches its real maturity, no host needs it yet, without either overreaching into a premature interface or leaving the charter's third seam undocumented. Keeping the engine free of any intercept service preserves the standalone-first posture and the zero-dependency core; the seam is a place to delegate, not a dependency to carry.

## Consequences

The rendering-grade-versus-analysis-grade boundary the charter asserts now has a recorded home and a named delegation target, and the strip provenance carries which grade produced its edges. Anything requiring better than the analytic sphere, terrain, oblateness, ellipsoid-precise geolocation, crosses this seam (ADR-0018 is the budget that says when). The interface itself is deferred, so no wire shape is frozen before a host needs it.

References: CLAUDE.md hard non-goals; the acquisition geometry survey section on the three seams; ADR-0002; ADR-0013; ADR-0018; SPEC-STRIP; requirement AGE-19.
