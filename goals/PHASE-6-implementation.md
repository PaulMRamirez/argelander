# PHASE-6 implementation guide

The ordered slices that deliver `goals/PHASE-6.md`, each a copy-paste prompt for a fresh Claude Code session plus the verification to run. Work one slice at a time, in order: 0016-B derives from the optics 0016-A adds, and the 0015 slices run 0015-A then 0015-B then 0015-C because the sampler cannot consume attitude the seam does not yet carry. Each slice is its own branch, its own adversarial review, and its own merge ritual.

Standing constraints, true of every slice and not repeated in each prompt: sign commits (`git commit -s`), conventional-commit form with a `Refs: AGE-xx` trailer; no em dashes anywhere (enforced by `node scripts/check-style.mjs`); `pnpm verify` green from the repo root is the gate; the charter holds (argelander-core zero runtime dependencies, no propagation or orbit determination, no frames math beyond the analytic sphere of ADR-0014, no embedded CSPICE); a change that touches a frozen contract lands with its spec revision in the same commit; the merge ritual is verify green, `git merge --no-ff`, push, watch CI, confirm the Pages deploy. Governing decisions: `adr/0014-frame-boundary.md`, `adr/0015-attitude-epistemic-envelope.md`, `adr/0016-optics-first-instrument-model.md`. Definition of done for a slice: new behavior covered by a test, the spec or docs updated in the same change if a contract moved, the adversarial review run and its confirmed findings fixed, `pnpm verify` green, the merge ritual complete.

Independent of this phase: the PHASE-5 state slices OEM and the SPK recipe (`goals/PHASE-5-implementation.md`, slices 2 and 3) touch neither the instrument model nor attitude, so they may interleave with these whenever convenient; they respect ADR-0014 already.

## Slice 0016-A: the instrument-model data shape, loader, and manifest

Goal: make the intrinsic optics and the provenance queryable data, and let a host load the catalog as data, additively, so no frozen contract moves.

Prompt:

```
Session on the argelander repo. Read adr/0016-optics-first-instrument-model.md (rules 1, 4, 5, 7), docs/what-the-engine-must-know.md sections 4 and 6, specs/SPEC-INSTRUMENT-MODEL.md, packages/argelander-core/src/model.ts (validateInstrumentModel, FAMILY_REQUIRED_PARAMS), and packages/argelander-core/catalog (the 25 models and README, note the swathHalfWidthKm baked at a nominal altitude and the optics in sourceNote prose). Goal, the data half of ADR-0016, additive so the frozen envelope and required-parameter table do not move. First, define the intrinsic collecting-geometry optional parameters per modality, riding the spec's optional-parameter extension point, in radians per the units policy: a cross-track field of view and detector count for the imaging scanners, a near and far incidence angle for the side-lookers, a scan half-angle and beam divergence for the scanning lidars, and the platform nominal altitude the derived value was baked at. Second, replace the free-text sourceNote with a structured provenance value carried in params (a source name, a citation or datasheet reference, a retrieved date, and the intrinsic quantities as named fields), and keep a short human note. Third, add a JSON instrument-model loader and a catalog manifest to argelander-core: a loader that validates a document and returns InstrumentModel records, and a manifest (an index of the catalog's models) so a host loads the catalog as data (AGE-18); this manifest is a new interchange contract, so add its shape to a spec (a short SPEC section or a manifest schema) in the same change. Migrate the 25 catalog models to carry the intrinsic optics and the structured provenance, keeping the existing baked parameter so the samplers still render unchanged. Do not add a runtime dependency; do not change FAMILY_REQUIRED_PARAMS or the strip schema; do not touch the 21 fixtures/models anchors. Tests: every migrated model still passes validateInstrumentModel and still renders through its sampler; the loader loads a model and the manifest enumerates the catalog; the intrinsic optics and the structured provenance are present and typed as data, not prose. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-18.
```

Verification:

```bash
pnpm --filter argelander-core test        # catalog + loader + manifest tests pass
grep -L 'crossTrackFovRad\|nearIncidenceRad\|scanHalfAngleRad' packages/argelander-core/catalog/*.json  # each real model carries optics
git --no-pager diff main -- packages/argelander-core/package.json  # no new dependency
node -e "1" # confirm fixtures/models/ unchanged: git diff main --stat -- packages/argelander-core/fixtures is empty
pnpm verify
```

## Slice 0016-B: the spherical optics-to-geometry derivation

Goal: derive the swath, footprint, and near and far ground range from the optics and the per-segment altitude, spherically, so the geometry is altitude-correct rather than baked.

Prompt:

```
Session on the argelander repo. Read adr/0016-optics-first-instrument-model.md (rules 2, 3, 7), adr/0014-frame-boundary.md, docs/what-the-engine-must-know.md section 5 (the spherical intersection formulas), the intrinsic optics added in Slice 0016-A, and the samplers in packages/argelander-core/src that consume swathHalfWidthKm, nearRangeKm/farRangeKm, and the footprint parameters. Goal, the derivation half of ADR-0016. Add a rendering-grade optics-to-geometry derivation to argelander-core: from a look angle theta at a platform of radius R plus h over a sphere R, compute the ground arc s = R (asin(((R+h)/R) sin theta) - theta), with the limb bound, and the flat-earth h tan theta as the airborne small-angle fast path; from that derive the swath half-width from a field of view, the near and far ground range from incidence angles, and the footprint size and off-nadir growth. The samplers prefer the intrinsic optics when a model carries them, reading the platform altitude from the state per segment so the swath is correct along the pass, and fall back to the baked parameter otherwise. This is the analytic sphere intersection the engine already does; introduce no frames math and no analysis-grade geometry, and do not import HyPlan's flat-earth as the orbital path. Tests: one instrument derives two different swaths at two platform altitudes; a catalog model renders through its sampler from the optics and matches the baked value at the nominal altitude within tolerance; the atlas conformance replay still matches its committed fixtures; the limb bound refuses a look past the horizon rather than returning a garbage arc. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-06, AGE-18.
```

Verification:

```bash
pnpm --filter argelander-core test        # derivation tests pass, conformance replay unchanged
pnpm -r test                              # no adapter regressions
pnpm verify
```

## Slice 0015-A: verify the Bessel orientation contract

Goal: confirm the attitude facets are subset-compatible with the owned Bessel contract before touching the frozen seam.

Prompt:

```
Session on the argelander repo. Read adr/0015-attitude-epistemic-envelope.md, specs/SPEC-PROVIDER.md (sections 1, 3, 4, the frozen QuatBatch and orientation shape and the Bessel subset alignment), and the memory note on the Bessel pin. Goal: verify, do not yet change the seam. Check out the owned Bessel repository locally (a sibling checkout, not inside this tree), read its StateProvider and orientation and QuatBatch contract at the pinned commit, and determine whether the proposed additive facets, an attitude source and quality tag, an attitudeCoverage window and refusal, and an angular velocity on QuatBatch, are already present, are cleanly additive as id and coverage were, or require a Bessel-side change. Produce a short written finding: for each facet, its Bessel status and the exact additive or coordinated change needed, so Slice 0015-B implements against a known contract rather than guessing. If a Bessel-side change is needed, draft it as a note for the Bessel owners. No change to this repo's seam yet. Commit the finding as a doc under docs/ or an addendum to the ADR. Commit signed with Refs: AGE-19.
```

Verification:

```bash
# a written finding exists mapping each attitude facet to its Bessel status and the change needed
grep -riE 'QuatBatch|angular velocity|attitudeCoverage' docs/ adr/ | head
node scripts/check-style.mjs
```

## Slice 0015-B: the attitude envelope on SPEC-PROVIDER

Goal: add the attitude epistemic envelope as additive facets, with its spec revision, verified against Bessel.

Prompt:

```
Session on the argelander repo. Read adr/0015-attitude-epistemic-envelope.md, the Slice 0015-A finding, specs/SPEC-PROVIDER.md, and packages/argelander-providers/src/sgp4-provider.ts and presampled.ts (the orientation implementations). Goal: add the attitude epistemic envelope as additive facets on the attitude side, exactly as the Bessel-verified finding permits. Add an attitude source and quality tag (measured, assumed-nadir, unknown), an attitudeCoverage(body) advertising the attitude windows, a structured refusal for orientation epochs outside them symmetric to CoverageRefusalError, and an optional angular-velocity component on QuatBatch. Update SPEC-PROVIDER in the same change (these touch the frozen, Bessel-subset seam), keeping the additions additive facets the way id and coverage are, and have a provider implement them (the pre-sampled provider can carry measured attitude and its coverage; the SGP4 provider keeps assumed-nadir with an assumed tag). Do not fuse attitude into the state batch; do not compute attitude; a quaternion is consumed, never derived. Tests: an orientation result carries a source tag and an angular rate; attitudeCoverage advertises a window and orientation refuses outside it; the refusal round-trips like the state refusal. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-19, AGE-04.
```

Verification:

```bash
pnpm --filter argelander-providers test   # attitude facet + refusal tests pass
grep -n 'attitudeCoverage\|assumed-nadir\|angular' specs/SPEC-PROVIDER.md  # spec updated
pnpm verify
```

## Slice 0015-C: sampler attitude consumption

Goal: let the samplers point from measured attitude, so the atmospheric and ballistic classes render honestly.

Prompt:

```
Session on the argelander repo. Read adr/0015-attitude-epistemic-envelope.md (rule 6), adr/0012-degenerate-track-policy.md, the attitude envelope added in Slice 0015-B, and packages/argelander-core/src trackStrip and its cross-track derivation (unit(position cross velocity)). Goal: give the samplers an attitude path. Where a provider supplies measured attitude with its coverage, the sampler points from the attitude quaternion and marks the segment by the attitude source tag; where the pointing is synthesized from velocity, it marks the segment assumed; where attitude is unavailable inside the pass, it plans or refuses rather than emitting a confident footprint. ADR-0012's degenerate-track policy remains the fallback for the assumed-nadir orbital path only. Add a demo or test rendering a sounding-rocket arc (velocity nulls at apogee) and a balloon float (station-keeping, free azimuth) on measured attitude, painted committed only where the attitude is real. No frames math; the sampler consumes the quaternion. Tests: a rocket-apogee segment points from measured attitude, not the null velocity; a balloon segment points from the gondola attitude, not the wind-driven track; a segment outside the attitude window is planned or refused, not committed. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-06, AGE-19.
```

Verification:

```bash
pnpm --filter argelander-core test        # attitude-consumption + rocket/balloon tests pass
pnpm -r test
pnpm verify
```

## Slice 6: rewrite the docs to lead with the seam (unblocked)

Goal: the PHASE-5 docs reframe, now that measured attitude exists, so the suborbital and balloon examples are honest.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-5-implementation.md Slice 6, adr/0015-attitude-epistemic-envelope.md, adr/0016-optics-first-instrument-model.md, docs/acquisition-geometry-survey.md section 9.2, docs/configuring-layers.md, and README.md. Goal: run the PHASE-5 docs reframe, now unblocked. Lead with the source-agnostic seam and the four input paths (SPICE first, then elements via TLE and OMM, then OEM and the CZML and GeoJSON interchange, then live telemetry), present SGP4 as the zero-backend near-earth demonstration, and add three worked examples: a planetary orbiter, and a suborbital sounding rocket and a stratospheric balloon that carry measured attitude with its source tag rather than velocity-derived pointing. Note that an instrument's geometry now derives from its cited optics at the platform altitude (ADR-0016). Dense prose, no em dashes, every snippet typechecked against the real API. Tests: the doc-snippet compile check; the on-this-page table of contents includes the new sections; the style gate passes. Run the adversarial workflow review cycle, fix findings, then the merge ritual. Commit signed with Refs: AGE-04.
```

Verification:

```bash
pnpm docs:build
grep -niE 'SPICE first|sounding rocket|balloon|measured attitude|cited optics' docs/configuring-layers.md
node scripts/check-style.mjs
pnpm verify
```

## Slice 7: the review cycle with the new alignment

Goal: an adversarial review over the whole phase, checking the model corrections landed coherently.

Prompt:

```
Session on the argelander repo. Read goals/PHASE-6.md and adrs 0014, 0015, 0016. Goal: run the full review cycle over the whole PHASE-6 change, the diff of the model-correction work against the phase start. Launch the adversarial workflow, parallel Opus lenses then Sonnet adversarial verify. Lenses: one, optics-first fidelity, the derived geometry matches the cited optics at the stated altitude and the derivation is spherical not flat-earth. Two, attitude honesty, no segment is painted committed on synthesized or unavailable attitude, and the refusal fires outside the attitude window. Three, contract discipline, the frozen strip schema and required-parameter table and the 21 anchors are unmoved, the SPEC revisions match the code, and the additions are additive facets checked against Bessel. Four, charter and consistency, zero dependencies, no frames math beyond the analytic sphere, no em dashes, terminology consistent. Verify each finding yourself, fix the confirmed ones, run pnpm verify, then the merge ritual. Commit signed with Refs: AGE-06, AGE-18, AGE-19.
```

Verification:

```bash
pnpm verify
gh run list --branch main --limit 1
# read the guide, README, survey, and a migrated catalog model: optics-first and measured-attitude read coherently
```
