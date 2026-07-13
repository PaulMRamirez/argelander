# Instrument catalog

Real, source-cited instruments as data (AGE-18: models as data, not code). Each file is one `InstrumentModel` in the frozen SPEC-INSTRUMENT-MODEL shape, mapped to one of the 21 geometry families, with the source of its optics cited in `params.sourceUrl` and `params.sourceNote`.

This directory is deliberately separate from `../fixtures/models/`, which stays exactly the 21 conformance anchors (one worked example per family, the family list itself); `fixtures.test` asserts that set is exactly 21. The catalog grows with real instruments without disturbing those anchors.

Seeded from HyPlan (github.com/ryanpavlick/hyplan): the airborne line scanners AVIRIS-3, AVIRIS-5, HyTES, PRISM (pushbroom) and MASTER (whiskbroom); the LVIS and G-LiHT ALS scanning lidars (whiskbroom, carrying the 1/cos-squared footprint growth); UAVSAR L, P, and Ka band (stripmap-sar); and the 15 satellites of the HyPlan SATELLITE_REGISTRY as symmetric nadir swath models, where `swathHalfWidthKm` is `swath_width_km / 2`.

Nominal-altitude disclosure. An airborne swath is altitude-dependent, so for the airborne instruments `swathHalfWidthKm` (and any footprint size) is derived from the instrument's real cited field of view or scan angle at a nominal platform altitude stated in each model's `sourceNote`, a demonstration value rather than the instrument's only platform. The intrinsic optic, the field of view or scan half-angle, is the cited quantity; the units policy keeps angles out of the model in degrees, so the degree value lives in the `sourceNote` prose. Where a value is nominal rather than sourced (a lidar scan rate, AVIRIS-5's provisional optics) the note says so.

No schema change and no new contract. Citations ride `params`, the spec-sanctioned optional-parameter extension point (a model may add optional parameters beyond the required set; samplers ignore parameters they do not know), so the frozen envelope does not move and no manifest or index format is introduced.
