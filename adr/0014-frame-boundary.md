# ADR-0014: the frame boundary, and how inertial states enter the seam

Status: proposed. Date: 2026-07-13.

## Context

The state source build-out (OMM elements, OEM ephemerides, an SPK sampling service, a live telemetry bridge, and the framing that presents these as one seam rather than SGP4 with extras) forces a question the charter has answered only implicitly: who converts an inertial state into the body-fixed frame the engine renders in. Today the answer is visible in the code. `argelander-core` contains no frame rotation of any kind; SPEC-PROVIDER section 1 has the engine name the body-fixed frame in the request so that no frame math occurs above the seam. The single inertial-to-body-fixed rotation in the repository is `temeToEarthFixedInto` in `argelander-providers/earth.ts`, the rendering-grade IAU 1982 GMST spin used only by `Sgp4Provider` (ADR-0008), and the CZML and GeoJSON providers (ADR-0011) already refuse inertial reference frames outright. OEM and raw SPK differ from those: they commonly arrive in the J2000-fixed inertial frames (EME2000, ICRF, GCRF for Earth, and J2000 relative to the body elsewhere), so ingesting them makes the boundary explicit rather than incidental.

## Decision

Three levels of frame handling name the boundary. Level 0 is no rotation: consume body-fixed states and render. Level 1 is a bounded, analytic, rendering-grade inertial-to-body-fixed rotation that needs no external orientation data. Level 2 is full precession, nutation, polar motion, and per-body kernel orientation, which is CSPICE.

| Level | What it does | Where it may live |
| --- | --- | --- |
| 0 | none; body-fixed in, render | `argelander-core`, and every provider by default |
| 1 | analytic rendering-grade rotation (a sidereal angle for Earth, IAU pole and prime-meridian polynomials elsewhere) | a provider only, isolated and deletable |
| 2 | precession, nutation, polar motion, CK and PCK orientation | nowhere in Argelander (ADR-0002) |

The rules, numbered because they are a contract:

1. The core stays at Level 0. `argelander-core` performs no frame conversion and consumes body-fixed states only, exactly as SPEC-PROVIDER section 1 already requires. This ADR moves no frozen contract; it records the boundary and the one permitted exception.

2. Rotation lives in the provider layer, never the core, and never above Level 1. A provider may convert inertial states to body-fixed internally, as `Sgp4Provider` already does for TEME to ITRF. Any such rotation is analytic, carries the stated rendering-grade budget of rule 5, is labeled rendering grade in code and in strip provenance, and is isolated so it can be removed when a Bessel frames binding lands. Level 2 is never implemented here.

3. Interchange parsers refuse inertial input by default. OEM ingestion accepts body-fixed states only and refuses an inertial reference frame with a named error that points the caller at the SPK sampling service, which owns full frames, or at pre-rotating the data. This is the stance CZML and GeoJSON already take. The default answer to a J2000 ephemeris is to sample it body-fixed through the service, not to have the engine rotate it.

4. Inertial ingestion, if ever built, is an optional and separate provider adapter, and it is out of scope for the first build. OEM ingestion in this build is body-fixed only, with the named refusal of rule 3; the adapter is not one of the five state-source items. Analytic Level-1 rotation for inertial ephemerides (Earth precession and nutation by a documented series, other bodies by the IAU pole right ascension, declination, and prime meridian polynomials) is an opt-in adapter in `argelander-providers`, and the trigger to build it is specific: a named, real input source that Argelander intends to support arrives inertial and cannot be routed through the SPK sampling service. When that condition is met and not before, the adapter ships with the arcminute budget of rule 5 as a passing test, in its own isolated module, labeled rendering grade and deletable at the Bessel binding. It is never a default and never in the core, and no Earth special case grandfathers inertial OEM ahead of the trigger. The SGP4 GMST rotation is the canonical example of an allowed Level-1 provider rotation, not a precedent for putting rotation in the core.

5. Rendering grade is a number, and J2000 fails it cheaply. A frame conversion must contribute less than roughly one arcminute of arc on the body, about 1.85 kilometers at the Earth surface and the corresponding arc on any other body. The budget is an angle on purpose: an arc is body-agnostic, so one number holds everywhere, and it is the same arcminute survey tolerance the engine is named for, the arcminute positions of the Bonner Durchmusterung. A single sidereal angle meets this for TEME by a wide margin, because TEME is referred to the mean equinox of date and only arcsecond terms (the equation of the equinoxes, polar motion) are dropped. It fails for the J2000-fixed frames: the accumulated general precession since J2000 is about 22 arcminutes by 2026, roughly 22 times the budget and near 40 kilometers at the Earth surface, wider than a whole low-Earth-orbit footprint. That is the concrete reason rule 3 refuses inertial input rather than approximating it, and why rule 4 requires a real series rather than a reused GMST. The budget bounds the frame conversion's own contribution; the analytic sphere and the other rendering-grade approximations are accounted for separately.

6. Earth Orientation Parameters are host-supplied and optional. UT1 minus UTC and polar motion enter only through a caller-provided value, as the existing `deltaUt1Sec` knob on `Sgp4Provider` already does, and the rendering-grade default is zero. The library never fetches EOP. Anything better than rendering grade is a number the host passes in.

7. Element catalogs are format first and fetch at the edge. Celestrak and Space-Track element data is supported as a format: `parseOmm` decodes CCSDS OMM in KVN and XML and the flat Celestrak and Space-Track JSON, all reducing to the mean elements the SGP4 path already consumes, and it lives beside `parseTle` in `argelander-providers`. Retrieval is a separate optional adapter or a documented recipe, never the core. Celestrak is a public GET; Space-Track authentication is the host's, and the library accepts at most a session token the host already obtained, never a username or password. Space-Track special-perturbations ephemerides are tabulated state vectors and enter through the OEM path, inheriting rules 3 through 5.

## Rationale

The division of labor is the whole product line. The survey settles it in section 9.8: Bessel owns time, frames, and state, the SPICE seam stays the single authority, and it is never duplicated here. A frames tier grown inside Argelander is code Bessel already owns, so it is duplicated risk that must be reconciled at the merge, which is exactly the failure mode Decision F names. Keeping rotation out of the core, and any Level-1 rotation isolated in a provider, makes convergence a binding rather than a port, and keeps the merge's highest-risk seam in one place (ADR-0002).

The breadth goal survives untouched because it never depended on engine frames. Non-Earth bodies are first class through body-fixed frames from SPICE (AGE-06), delivered by the sampling service, and the core is already body-agnostic in the Moon and Mars demonstrations. Aircraft, drones, balloons, and sounding-rocket tracks are geographic by nature, so they are body-fixed before they reach the seam and never touch this boundary at all. The only source class that touches it is an inertial-frame ephemeris, and rule 3 gives that a clean home in the service rather than in the engine.

The precession number is what turns a matter of taste into a decision. The tempting shortcut, reusing the SGP4 GMST for any inertial input, is wrong precisely where it would be used most: it is correct for TEME and tens of kilometers wrong for the J2000 frames that OEM and SPK actually carry. Refusing inertial input by default is therefore not conservatism, it is correctness, and it keeps the door from opening onto a real precession and nutation series that would grow toward Level 2.

The catalog and EOP rules keep two liabilities outside the library. Fetching is I/O and, for Space-Track, a credential and a usage agreement, none of which belong in a pure pull-based provider or in a zero-dependency core; the format parser is the durable part, and retrieval is a thin edge the host owns. EOP as a host-supplied number keeps the Earth rotation at Level 0 or 1 and prevents a data feed from being smuggled into the engine.

## Alternatives rejected

General frames in the core is rejected: it recreates the SPICE seam in a second place, contradicts AGE-19 and ADR-0002, and duplicates Bessel at the merge. Reusing the SGP4 GMST for all inertial input is rejected on the precession error of rule 5. A WASM SPICE for frames is rejected by ADR-0002. Requiring body-fixed everywhere with no escape hatch was considered and softened into rule 4: body-fixed is the default and the refusal is named, but an isolated optional adapter is the sanctioned path for inertial ingestion when a real source needs it, so the stance does not permanently strand legitimate OEM data.

## Consequences

The core stays clean, body-agnostic, and testable, and the SGP4 GMST is grandfathered as the one allowed Level-1 example rather than a precedent. OEM and the SPK service ship quickly because they accept body-fixed states and lean on the service for frames. A caller holding an inertial OEM must pre-sample it through the service or wait for the optional adapter, which is real friction acknowledged here rather than hidden. If the optional adapter is built, it is a small analytic frames module to maintain, mitigated by its isolation, its stated error budget, and its deletability at the Bessel binding. Security posture stays simple: no credentials and no data feeds inside the library.

References: ADR-0002, ADR-0008, ADR-0011; SPEC-PROVIDER sections 1 and 2; AGE-04, AGE-06, AGE-19; survey sections 9.2 and 9.8, Decisions D and F.
