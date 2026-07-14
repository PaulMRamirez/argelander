# ADR-0018: the rendering-grade error budget

Status: proposed. Date: 2026-07-13.

## Context

Rendering grade is the load-bearing term that separates what the engine does from what the intercept service does (ADR-0017), and it is self-certified locally in ADR after ADR with no unifying budget. ADR-0008 quotes meter-level GMST terms, ADR-0011 calls its geographic conversion rendering grade, ADR-0013 bins coverage at a stated resolution, ADR-0014 rule 5 defines a number but scopes it strictly to frame conversion (a frame conversion must contribute less than roughly one arcminute of arc, and it says the analytic sphere and the other rendering-grade approximations are accounted for separately), and ADR-0016 adds an optics-to-geometry derivation it calls rendering grade. Nowhere is the separate accounting ADR-0014 defers actually written. This ADR records the budget as one contract so that a reader, and the derivation of ADR-0016, has a single definition to check against rather than five local self-certifications.

## Decision (proposed)

The budget has one datum and one bound, and they are different in kind.

1. The datum is the analytic sphere. The engine draws footprints by analytic intersection of the look geometry with a sphere of the body's reference radius. The gap between that sphere and the body's true figure, its oblateness and its terrain, is not a term in the budget; it is the definition of the rendering-grade level itself, the deliberate and disclosed approximation the charter makes, and the line a product crosses to reach the intercept service (ADR-0017). It is by far the largest deviation from an analysis-grade intercept (the geocentric-to-geodetic latitude difference reaches about eleven arcminutes at Earth mid-latitudes, and more on a flatter body like Mars), and it is accepted by charter rather than bounded by this budget.

2. The bound is one arcminute, and it governs everything the engine adds on top of the sphere. Each auxiliary approximation, the frame conversion (ADR-0014), the epoch and body-rotation quantization, the optics-to-geometry derivation (ADR-0016, which is itself the sphere intersection and so is consistent with the datum by construction), and the coverage-accumulation binning (ADR-0013), contributes less than roughly one arcminute of arc on the body, about 1.85 kilometres at Earth and the corresponding arc elsewhere, the arcminute survey tolerance the engine is named for. These terms compose by summation and stay within a small multiple of an arcminute, so that no approximation the engine introduces rises to dominate, or even approach, the deliberate spherical simplification that is the datum.

3. Anything requiring better than the analytic sphere delegates. Oblateness, terrain, an ellipsoid-precise geolocation, and any product whose error would exceed the sphere level, cross the intercept-service seam of ADR-0017; the engine never narrows the sphere gap itself, because doing so is the frames and analysis math the charter keeps out of core.

## Rationale

Separating the datum from the bound is what makes the budget honest. The analytic sphere is coarse by design and coarser than an arcminute against the ellipsoid, so a budget that claimed one arcminute of total ground accuracy would be false; the truth is that the sphere is the accepted rendering-grade datum and the arcminute bounds only what the engine adds to it. Written this way the arcminute of ADR-0014 finds its correct place as the auxiliary bound rather than a total, the meter-level terms of ADR-0008 sit comfortably under it, and the derivation of ADR-0016 is consistent with the datum because it is the same sphere intersection. The budget is one contract the whole rendering-grade posture can be checked against, which the corpus review found missing, and it is the definition ADR-0016's derivation checks against, so it lands before that derivation is built.

## Consequences

The derivation of ADR-0016 and any future approximation check against this one budget rather than self-certifying, and the intercept-service seam of ADR-0017 is precisely what a product crosses when it needs better than the sphere. The arcminute stays the namesake survey tolerance, coherent with the whole rendering-grade thesis, and the largest deviation, the sphere against the true figure, is named as the deliberate charter approximation it is rather than hidden inside a total that would misrepresent it.

References: CLAUDE.md hard non-goals; the acquisition geometry survey; ADR-0008; ADR-0011; ADR-0013; ADR-0014; ADR-0016; ADR-0017; requirements AGE-01 and AGE-19.
