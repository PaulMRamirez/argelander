# PHASE-5 implementation guide

The ordered slices that deliver `goals/PHASE-5.md`, each a copy-paste prompt for a fresh Claude Code session plus the verification to run afterward. Work one slice at a time, in order: slices 4 and 6 depend on the parsers from slices 1 and 2, and slice 7 reviews everything, so the sequence matters. Each slice is its own branch, its own adversarial review, and its own merge ritual.

Standing constraints, true of every slice and not repeated in each prompt: sign commits (`git commit -s`), conventional-commit form with a `Refs: AGE-xx` trailer; no em dashes anywhere (enforced by `node scripts/check-style.mjs`); `pnpm verify` green from the repo root is the gate; the charter holds (argelander-core zero runtime dependencies, the frozen strip schema and SPEC-PROVIDER do not move, no propagation beyond the existing SGP4, no orbit determination, no frames math above the rendering-grade provider level of ADR-0014, no embedded CSPICE); anything that fixes a new wire shape draws its own ADR first; the merge ritual is verify green, `git merge --no-ff`, push, watch CI, confirm the Pages deploy. Governing decision for the whole phase: `adr/0014-frame-boundary.md`.

Definition of done for a slice: new behavior covered by a test, the spec or docs updated in the same change if a contract moved, the adversarial review run and its confirmed findings fixed, `pnpm verify` green, and the merge ritual complete.

Blocked on ADR A. Two items below are held until the attitude epistemic envelope (`adr/0015-attitude-epistemic-envelope.md`, proposed) lands, because they would otherwise ship suborbital and balloon geometry on the velocity-derived pointing that collapses for those classes (the study `docs/what-the-engine-must-know.md`, section 9). Slice 5, the live-telemetry contract, is where attitude push is specified, so it depends on ADR A directly. Slice 6's planetary-orbiter example may proceed, but its suborbital and balloon examples wait for ADR A so they show measured or explicitly-assumed pointing rather than the overconfident version. Build the unblocked slices (1, 2, 3, 4) first, and return to the held items once ADR A is accepted.

## Slice 1: parseOmm, the modern element container

Goal: parse a satellite's orbital mean elements from the containers Celestrak and Space-Track publish, so their exports feed `Sgp4Provider` unchanged and TLE stops being the only way in.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5.md, adr/0014-frame-boundary.md, and in packages/argelander-providers/src read tle.ts (parseTle and parseTles), sgp4-provider.ts, and sgp4.ts (sgp4Init and the element fields it consumes). Goal: an OMM parser beside parseTle. Export parseOmm, and parseOmms for a multi-object document, accepting CCSDS OMM in KVN and XML and the flat Celestrak and Space-Track GP JSON; all three reduce to the same mean elements (epoch, mean motion, eccentricity, inclination, RAAN, argument of perigee, mean anomaly, bstar, and the element-set metadata). Return the exact shape parseTle produces so the SGP4 path is untouched, no new wire shape and no schema change, so no new ADR is needed (ADR-0014 rule 7). Angles are radians inside the model, per the units policy. Do not add a runtime dependency: parse the XML and KVN by hand, these are small bounded formats. Tests: an OMM XML, an OMM KVN, and a Celestrak GP JSON for the ISS each parse and, built through Sgp4Provider, render the same ground track as the object's TLE within tolerance; a malformed document and a deep-space element set are refused the way parseTle refuses them. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-04.
```

Verification:

```bash
pnpm --filter argelander-providers test          # a new omm test file passes
grep -n 'parseOmm' packages/argelander-providers/src/index.ts   # exported
git --no-pager diff main -- packages/argelander-providers/package.json  # no new dependency
pnpm verify                                       # green
```

## Slice 2: the OEM reader, body-fixed only

Goal: decode CCSDS Orbit Ephemeris Messages into the pre-sampled path, covering precision LEO, deep-space, suborbital, and Space-Track special-perturbations ephemerides, refusing inertial input per ADR-0014 rather than drawing a confidently wrong footprint.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5.md, adr/0014-frame-boundary.md (rules 3 and 5), and in packages/argelander-providers/src read presampled.ts (PresampledProvider and parsePresampledCsv), czml.ts and geojson-state.ts (the sibling parsers and how they refuse inertial), and time.ts (the Et conversions). Goal: an OEM reader that decodes CCSDS Orbit Ephemeris Messages into the pre-sampled path as a sibling of the CSV, CZML, and GeoJSON providers. Export parseOem, KVN and XML, and an oemProvider convenience over PresampledProvider. Read the tabulated position and velocity state vectors, the time system converted to Et (UTC, TAI, TT), the reference frame, and the interpolation metadata (respect the stated method and degree, or fall back to the provider cubic Hermite with a disclosed provenance note). Per ADR-0014 the reader is body-fixed only: an OEM whose reference frame is inertial (EME2000, ICRF, GCRF, J2000, TEME) is refused with a named error that tells the caller to sample it body-fixed through the SPK service; a body-fixed frame (ITRF, an IAU body frame) is accepted. No propagation, no frames math, no new dependency, parse by hand. Tests: a body-fixed OEM renders a strip through the pre-sampled path; an inertial OEM is refused with the named error naming the SPK service; the time-system conversion round-trips against time.ts; a Space-Track SP-ephemeris-shaped document parses. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-04, AGE-06.
```

Verification:

```bash
pnpm --filter argelander-providers test          # oem test passes, including the inertial refusal
grep -rn 'SPK' packages/argelander-providers/src/*oem* # the refusal names the SPK service
git --no-pager diff main -- packages/argelander-providers/package.json  # no new dependency
pnpm verify                                       # green
```

## Slice 3: the SPICE-first path, a recipe and a thin reference sampler

Goal: make the charter's primary state authority concrete without embedding CSPICE, so SPICE-first is exercised end to end rather than only named.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5.md, adr/0002-no-second-spice.md, adr/0014-frame-boundary.md, packages/argelander-providers/src/http.ts (serveStateRequest and httpStateProvider), and the HTTP service wire section of docs/configuring-layers.md. Goal: make the SPICE-first path real as a documented recipe plus a thin reference sampler that answers the serveStateRequest shape by returning body-fixed states sampled from a SPICE backend (spiceypy or NAIF WebGeocalc), so a host points httpStateProvider at it. The sampler is a reference, not a shipped provider and not a server package: keep it minimal and clearly labeled in an examples or docs location, and it always returns body-fixed states because it asks SPICE for the body-fixed frame (ADR-0014). No CSPICE in the repo, no new runtime dependency in argelander-core or argelander-providers. Deliver: the reference sampler, a test that it answers a StateQuery with a body-fixed batch that httpStateProvider consumes and renders a strip, and a recipe documenting the spiceypy call (spkezr in the body-fixed frame) and the WebGeocalc alternative. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-04, AGE-19.
```

Verification:

```bash
grep -rniE 'cspice|spice.*wasm' packages/ | grep -v node_modules   # nothing embedded
pnpm -r test                                      # the reference sampler test passes
pnpm verify                                       # green
# read the recipe: it shows the spkezr body-fixed call and the WebGeocalc alternative
```

## Slice 4: catalog retrieval, credential-free

Goal: an optional retrieval helper for the two element catalogs, kept at the edge, with Space-Track credentials never handled by the library.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5.md, adr/0014-frame-boundary.md (rule 7), packages/argelander-providers/src/tle.ts, and the parseOmm added in Slice 1. Goal: an optional credential-free retrieval helper for the two element catalogs, at the edge and never in the core. For Celestrak, a public GET, a small celestrakGp(query) helper that fetches a GP export and hands it to parseOmm or parseTle. For Space-Track, do not handle a username or password anywhere in the library: accept at most a session token or cookie the host already obtained, and otherwise document retrieval as a recipe. All network code lives in its own optional module or an examples location, so the pure providers and the zero-dependency core are untouched. Tests: a mocked-fetch test that celestrakGp retrieves and parses to elements that build Sgp4Provider; a test or assertion that no username or password field appears in the library surface. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-04.
```

Verification:

```bash
pnpm -r test                                      # mocked-fetch retrieval test passes
grep -rniE 'password|username|identity=' packages/argelander-providers/src | grep -v node_modules  # empty: no credential handling
pnpm verify                                       # green
```

## Slice 5: the live-telemetry contract, specified not built

Blocked on ADR A. This contract carries platform and mount attitude, so it must incorporate the attitude epistemic envelope of `adr/0015`; draft it only after ADR A is accepted.

Goal: write down the live-telemetry provider shape as a contract for PHASE-3 to implement. A push or subscription shape is a new wire shape, so it is a proposed ADR, drafted and confirmed before it lands.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5.md, goals/PHASE-3.md, specs/SPEC-PROVIDER.md, and section 9.2 of docs/acquisition-geometry-survey.md (the four input paths, telemetry fourth). Goal: specify, do not build, the live-telemetry provider shape the PHASE-3 Yamcs bridge will implement: how a real-time source subscribes to platform and mount state and extrudes the committed strip forward while the planned strip ahead of now stays amber, expressed as a contract over the frozen StateProvider seam. A push or subscription shape is a new wire shape, so draft it as a proposed ADR and add a pointer to it from goals/PHASE-3.md, per the PHASE-5 exit clause. No implementation, no Yamcs code, no dependency. Draft the proposed ADR, then ask me to confirm it before the merge ritual. Commit signed with Refs: AGE-04.
```

Verification:

```bash
ls adr/ | tail -3                                 # a new proposed ADR exists
grep -n 'Status: proposed' adr/00*-*telemetry*.md # it is proposed, awaiting your acceptance
grep -n 'telemetry' goals/PHASE-3.md              # PHASE-3 points to it
node scripts/check-style.mjs                       # style clean (this slice ships no code)
```

## Slice 6: rewrite the docs to lead with the seam

Partially blocked on ADR A. The planetary-orbiter example may proceed, but the suborbital and balloon examples wait for `adr/0015` so they show measured or explicitly-assumed pointing, not the velocity-derived pointing that collapses for those classes.

Goal: rebalance the documentation so the source-agnostic seam leads and SGP4/TLE is one authority among many, with the breadth of platforms shown by real examples.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5.md, adr/0014-frame-boundary.md, section 9.2 of docs/acquisition-geometry-survey.md, the Getting states and Other providers sections of docs/configuring-layers.md, the See it use it section of README.md, and the parseOmm, OEM reader, and SPK recipe added in the earlier slices. Goal: rewrite the state-source documentation so the seam leads. In the guide, restructure Getting states and Other providers around the four input paths in priority order: SPICE first through the sampling recipe, then orbital elements via TLE and OMM including Celestrak and Space-Track, then OEM and the CZML and GeoJSON interchange, then live telemetry as the PHASE-3 contract; present SGP4 as the zero-backend near-Earth demonstration rather than the face of the engine. Add three worked examples that show the breadth the seam already serves: a suborbital sounding-rocket arc, a stratospheric balloon float, and a planetary orbiter, each a body-fixed state table rendered through PresampledProvider or the OEM or SPK path. In the README, lead See it use it with the seam and the four paths. Keep the frame boundary honest throughout: inertial input is refused (ADR-0014). Dense prose, no em dashes, tables welcome, every code snippet typechecked against the real API. Tests: the doc-snippet compile check, drop the snippets into a temporary typecheck file under the repo strict flags and confirm zero errors; the guide on-this-page table of contents includes the new sections; the style gate passes. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-04.
```

Verification:

```bash
grep -niE 'SPICE first|four (input )?paths|sounding|balloon|planetary orbiter' docs/configuring-layers.md
pnpm docs:build                                   # renders; the guide ToC lists the new sections
grep -c 'class="toc"' dist/site/configuring-layers.html
node scripts/check-style.mjs                       # clean
pnpm verify                                       # green
```

## Slice 7: the review cycle with the new alignment

Goal: an adversarial DX/UX review over the whole PHASE-5 change, checking that the new state-authority framing and ADR-0014 hold everywhere, then the final merge.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5.md and adr/0014-frame-boundary.md. Goal: run the full review cycle over the whole PHASE-5 change, the diff of all the state-authority work against the phase start, aligned with the new framing. Launch the adversarial workflow: parallel Opus lenses then Sonnet adversarial verify. Lenses: one, doc and example correctness, every new snippet compiles against the real API under the repo strict flags. Two, frame-boundary conformance, no path accepts inertial input or does frames math above the rendering-grade provider level, and every refusal names the SPK service (ADR-0014). Three, alignment, the docs and code lead with the seam and the SPICE-first priority and SGP4 and TLE are no longer predominant, with the four paths consistent between the guide, the README, and the survey. Four, charter and consistency, argelander-core still zero-dependency, the frozen strip schema and SPEC-PROVIDER unmoved, no new runtime dependency, no em dashes, terminology consistent. Verify each finding yourself against the code, fix the confirmed ones, run pnpm verify, then the merge ritual. Commit signed with Refs: AGE-04.
```

Verification:

```bash
pnpm verify                                       # green
gh run list --branch main --limit 1               # CI success after the merge
# read the guide, README, and survey: the four paths and the SPICE-first priority read consistently
```
