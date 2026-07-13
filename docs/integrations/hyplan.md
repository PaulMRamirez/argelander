# HyPlan and Argelander: Integration Analysis

*Analysis of [HyPlan](https://github.com/ryanpavlick/hyplan) (commit 9504ef1, examined 2026-07-12) against the Argelander contracts as of Phase 1. HyPlan is a separate Apache-2.0 project; nothing here proposes a code dependency in either direction. The three seams and hard non-goals in CLAUDE.md govern; a path tagged violates-charter is recorded to be refused, not adopted.*

## 1. What HyPlan is, and the thesis

HyPlan (Pavlick/NASA, Python, PyPI) is a mature airborne-and-satellite mission planner built on the scientific geo stack (geopandas, shapely, pyproj, skyfield, pymap3d, pint). Its center of gravity is airborne campaign planning: flight lines, winds, Dubins paths, aircraft endurance, airports, terrain-aware DEM swaths, plus a competent spaceborne overpass module (`satellites.py`: CelesTrak TLE fetch, Skyfield SGP4, cross-track swath polygons, solar-zenith usability gating, pass segmentation). It carries a real, source-cited instrument catalog (`instruments/`: AVIRIS, HyTES, PRISM, MASTER, UAVSAR, LVIS, G-LiHT, framing cameras) as intrinsic optics (`half_angle`, `fov`, `near_range_angle`, `scan_rate`). What it renders weakly: Cartopy statics, Folium/Leaflet HTML, KML, ForeFlight/ICARTT exports, all one-shot and unanimated.

Thesis: HyPlan and Argelander are complementary, not competing, and the only sound coupling is a one-directional data interchange (HyPlan produces coverage, Argelander animates it) across the frozen strip contract, with zero shared code, because the Python/TypeScript boundary and Argelander's zero-runtime-dependency core forbid a code merge and its charter forbids absorbing HyPlan's propagation, frames, and terrain math.

## 2. The correspondence

The strongest point-for-point overlaps across all five facets. Note that the sharpest overlaps (rows 1 to 5) are the satellite pipeline, where "sharp" means redundant, not valuable; the integration value lives in the rows where Argelander has a genuine gap (airborne trajectory, rendering, catalog).

| HyPlan component | Argelander contract / family / seam | Nature of the overlap |
| --- | --- | --- |
| `satellites.py` `fetch_tle` / `_is_valid_tle` (CelesTrak fetch, 24h cache, loose validate) | `argelander-providers/src/tle.ts` `parseTles` (strict mod-10 checksum, no fetch) | HyPlan owns the network fetch Argelander deliberately declined (ADR-0009); same 3-line CelesTrak blob, opposite validation posture |
| `satellites.py` `compute_ground_track` (Skyfield SGP4 to geodetic subpoint + `solar_zenith`) | `sgp4.ts` + `sgp4-provider.ts` (Vallado WGS-72 SGP4 from source to TEME then ECEF `Float64Array`) | Sharpest duplication: two independent SGP4s; ICESat-2 is a named target on both sides; opposite dependency and precision grade |
| `satellites.py` `compute_swath_footprint` port/starboard edge arrays (`vreckon` offset by half-swath perpendicular to heading) | `track.ts` `trackStrip` `StripSegment.left`/`right` (great-circle offset along orbit normal `position x velocity`) | Single cleanest geometric bridge: per-station port/star arrays are exactly per-segment left/right before HyPlan closes them into a Polygon |
| `satellites.py` `_segment_passes` (split on time gap, pole reversal, antimeridian jump) | `pass.ts` `passStrips` (explicit windows sharing `passId`) + `geo.ts` `gapFactor` | Both make the pass the unit of accumulation and refuse to ribbon across gaps; HyPlan discovers passes, Argelander is told the windows |
| `swath.py` `generate_swath_polygon` / `calculate_swath_widths` | `argelander-leaflet/src/geo.ts` `stripToGeo` + `GeoSegment.widthKm` | Inverse representations: HyPlan is polygon-first-then-measures-width; Argelander is edge-first-then-reconstructs-polygon |
| `SATELLITE_REGISTRY` / `SatelliteInfo` (`norad_id`, `swath_width_km`, `max_sza`, 15 LEO EO sats) | `Sgp4TleInput` + `TrackStripOptions.swathHalfWidthKm`; `fixtures/models/*.json` | Ready-made instrument catalog as data (AGE-18): `norad_id` to TLE target, `swath_width_km / 2` to `swathHalfWidthKm`; `max_sza` has no engine counterpart |
| `instruments/line_scanner.py` `LineScanner` (AVIRIS/HyTES/PRISM: `half_angle`, `fov`, pixels) | `pushbroom` and `whiskbroom` families (`types.ts` `GeometryFamily`) | LineScanner collapses two Argelander families into one; bridge is `swathHalfWidthKm = altitude_agl * tan(half_angle)`; whiskbroom adds bowtie `footprintGrowthFactor` HyPlan lacks |
| `instruments/radar.py` `SidelookingRadar` UAVSAR (near/far incidence angles, `look_direction`) | `stripmap-sar` family (`nearRangeKm 43.2`, `farRangeKm 81.6`, `side`) | Very direct; HyPlan defines the ribbon by incidence angles through altitude, Argelander freezes ground-range km edges |
| `instruments/frame_camera.py` `FrameCamera`/`MultiCameraRig` (corner polygons; deliberately not a `ScanningSensor`) | `framing` family + `SubFrame` corners (SPEC-STRIP section 3) | Both put framing as discrete exposures on corners, off the left/right swath pipeline; HyPlan's `tilt_angle` obliques are richer than the nadir fixture |
| `instruments/als_lidar.py` fore/aft pitch-tilted VQ-480i rig; mount `pitch_tilt`/`roll_tilt`, radar `look_direction` | `multi-angle` family (`stationLeadsSec`) + `MountElement` chain (fixed/gimbal/scan-mirror/spin) | Fore/aft two-angle imaging is the MISR-like multi-angle geometry; HyPlan's flat Euler tilts map onto the composable platform-outward mount chain |
| `line_scanner.ground_sample_distance` (nadir/center/edge) + radar near/far incidence | `QualityRange` `resolutionM [min,max]` / `incidenceDeg [min,max]` per `StripSegment` (SPEC-STRIP section 4) | Direct: HyPlan's near/center/far GSD and near/far incidence map onto the ordered [min,max] quality tuples |
| `flight_line.py` `FlightLine.track` / `planning/engine.py` `compute_flight_plan` (geodetic LineString, `groundspeed_kts`, `altitude_msl`); `waypoint.py` `Waypoint` | Inbound seam `types.ts` `StateProvider.states` / `StateBatch` / `StateSample` (ECEF x,y,z,vx,vy,vz at Et TDB) | The airborne provider bridge: right source, wrong representation; HyPlan holds the trajectory Argelander has no provider for |
| `terrain/intersection.py` `ray_terrain_intersection` (DEM ray-march) | `track.ts` `surfacePoint` (spherical) + the pluggable intercept service | Deliberate fidelity boundary, not a shared implementation; DEM footprints exceed the analytic-ellipsoid charter |
| `exports/kml.py`, `plotting.py` Folium/Cartopy (static, one-shot) | `layer.ts` `AcquisitionLayer` + `clock.ts` + `paint.ts` six treatments (now-trail, mechanism, quality-gradient) | The complementarity: Argelander's live, animated, treatment-driven render surface is exactly what HyPlan's static output lacks |
| `flight_line.to_geojson` / GeoDataFrame EPSG:4326 | `schemas/strip.schema.json` (frozen draft-07) + `validate.ts` `validateStrip` | The wire contract a bridge targets: closed `additionalProperties:false` strip schema vs open GeoJSON properties |

## 3. Integration paths, ranked

Every viable path runs one direction: HyPlan produces, Argelander consumes. `argelander-core` never depends on HyPlan. The ranking is by leverage over risk, and it deliberately demotes the satellite-state feed that the sharpest overlaps might suggest, because Argelander self-serves TLE states already.

### Path 1 (lead, highest leverage, lowest risk): HyPlan emits strips, Argelander animates them

- Seam: outbound strip contract (`schemas/strip.schema.json`, seam 2) consumed by the render surface (seam 3). A HyPlan-side `hyplan/exports/argelander.py` maps `compute_swath_footprint`'s pre-polygon `port_lats/lons` and `star_lats/lons` (and, for airborne, `swath.py` `edge1/edge2` arrays) plus timestamps into `StripSegment.left`/`right`, `etSec`, and `state`; an Argelander-side reader (a small adapter, anticipated by AGE-04 GeoJSON/CZML input and AGE-14 GeoJSON outlines) does `JSON.parse` plus `validateStrip` and renders through the existing Leaflet/Three adapters.
- Direction: HyPlan to Argelander, one-way data across a versioned file format.
- Unlocks: live, animated, treatment-rich web and MMGIS rendering of all HyPlan coverage (satellite and airborne alike), with planned/acquiring/committed states, now-trail, quality gradient, and mechanism LOD that HyPlan's Folium/KML/Cartopy stack cannot produce. Crucially, because the strip carries HyPlan's exact DEM-intersected edges verbatim, terrain fidelity is preserved in the data while Argelander never computes it; this is the charter's "precision deferred to producers" working exactly as designed, and it is higher fidelity for airborne coverage than any provider path (which would re-derive footprints spherically and discard the terrain).
- Effort: moderate, concentrated on the HyPlan side (the exporter reuses geometry HyPlan already computes and lives next to `to_kml`/`to_gpx`); the Argelander reader is small and dependency-free.
- Charter check: FITS cleanly. Argelander never depends on HyPlan, core stays zero-dependency, and it renders edges as given. The one hard rule: serialize the pre-polygon edge arrays, never the closed Shapely Polygon (the ring re-pairs fragilely, `calculate_swath_widths` already special-cases odd point counts, and the closed polygon imports HyPlan's already-broken antimeridian geometry that Argelander's `geo.ts` `unwrapLon`/`worldCopyOffsets` would otherwise handle). UTC to Et and geodetic-to-spherical-latitude approximations must be recorded in the strip, not hidden.

### Path 2: Registry-as-data for satellites, let Argelander self-serve

- Seam: instrument-model-as-data (AGE-18) plus the native `Sgp4Provider`. Export `SATELLITE_REGISTRY` as JSON so an Argelander host builds TLE targets and `trackStrip({ swathHalfWidthKm: swath_width_km / 2 })` instead of hand-authoring fixtures.
- Direction: HyPlan to Argelander, pure config handoff, no code dependency either way.
- Unlocks: Argelander renders HyPlan's 15-satellite catalog from TLEs natively, replacing its atlas-derived demonstration constants with source-cited values. No satellite state is transferred.
- Effort: low.
- Charter check: FITS. Two traps: the factor-of-2 (`swath_width_km` is a full width, `swathHalfWidthKm` is a half), and the deep-space cliff (Argelander's from-source SGP4 raises `DeepSpaceUnsupportedError` at construction; all 14 registry birds are LEO, so near-Earth SGP4 covers them). Do not run both propagators on the same satellite expecting agreement.

### Path 3: Airborne flight-line StateProvider

- Seam: inbound `StateProvider` (seam 1, SPEC-PROVIDER). A `HyPlanFlightLineProvider` implements `states()`, emitting ECEF x,y,z,vx,vy,vz (km, km/s, ITRF93) at Et; `trackStrip` already treats the platform as an above-surface point (`nadir = position/|position|`, `cross = position x velocity`), so airborne footprints render through the identical pipeline as satellites with no new sampler.
- Direction: HyPlan to Argelander states.
- Unlocks: airborne coverage as a reusable, altitude-parametric provider Argelander can re-render with any `InstrumentModel` and any treatment, filling a genuine gap (every current provider is spaceborne).
- Effort: higher. Requires geodetic-to-ECEF, UTC-to-Et (leap seconds plus 32.184 s), velocity reconstruction from HyPlan's `(heading, groundspeed, climb_rate)`, mapping trajectory validity to `CoverageWindow`, and explicit handling of loiter/hover samples where `position x velocity` is degenerate (`trackStrip` throws `RangeError` on parallel state vectors).
- Charter check: FITS (a new provider below the frozen seam, only analytic geodetic-to-ECEF, no propagation because HyPlan supplies the path). But note it is strictly lower fidelity than Path 1 for airborne coverage: it re-projects footprints on the ellipsoid and discards HyPlan's DEM terrain intersection. Prefer this path only when you specifically want the reusable, altitude-parametric, re-renderable provider rather than a frozen strip.

### Path 4 (low value): Pre-sampled CSV / CZML / HTTP satellite state feed

- Seam: `PresampledProvider.parsePresampledCsv` (`et,x,y,z,vx,vy,vz[,lt]`, ADR-0008), `czmlProvider` (FIXED frame only, INERTIAL refused), or `httpStateProvider` (ADR-0009).
- Direction: HyPlan to file/service to Argelander.
- Honest assessment: lower value than it looks, because `Sgp4Provider` self-serves Earth TLE states. The one real use is deep-space birds that Argelander's from-source SGP4 refuses: Skyfield's SDP4 can pre-sample those into CSV that Argelander then renders through the frozen seam with no new dependency. ADR-0009 explicitly names "an offline fetch into pre-sampled CSV" as the honest shape.
- Charter check: FITS (offline tooling; a runtime network-fetch provider was declined by ADR-0009). Principal risk: frame or time mislabeling. `PresampledProvider` refuses mismatches it is told about but cannot detect a wrong-but-consistently-labeled frame; TEME or inertial Cartesian tagged as ITRF93 renders as a confidently wrong footprint.

### Path 5 (lowest value, reverse direction): strips to a Python reader for cross-validation

Argelander publishes `StripProduct`; a Python reader could rebuild a GeoDataFrame for the same TLE and window as a visual-regression oracle. Useful only as a check, never at runtime. Be careful reading any diff: HyPlan and Argelander diverge by construction at the dateline (HyPlan warns and leaves a possibly-invalid EPSG:4326 polygon; Argelander unwraps) and at pole crossings (HyPlan splits passes; Argelander ribbons by `gapFactor`), so a diff there is a methodology difference, not an Argelander defect. HyPlan has no runtime reason to consume strips.

## 4. What Argelander would need to support

| Addition | Verdict | Notes |
| --- | --- | --- |
| Foreign-strip ingest adapter (strip-JSON/GeoJSON/CZML to in-memory `Strip`) | Fits-charter | Anticipated by AGE-04 and AGE-14; lives in an adapter or the providers package; `JSON.parse` plus `validateStrip`, zero core dependency. Reading a strip-shaped payload is anticipated, not a new seam; a direct FlightLine-to-strip constructor inside core would be a new seam and would require an ADR |
| Airborne geodetic flight-line `StateProvider` emitting ECEF at Et | Fits-charter | A new provider below the frozen seam; only analytic geodetic-to-ECEF, no propagation since HyPlan supplies the path; must handle degenerate `position x velocity` (loiter/hover) that `trackStrip` rejects |
| UTC-to-Et and geodetic-to-spherical boundary conversions co-located at the bridge | Fits-charter | Boundary concern; the SGP4 provider already sets the rendering-grade precedent (Et approximated as TT, UT1 as UTC). The geodetic-vs-geocentric latitude difference must be recorded, not hidden |
| Provenance synthesis for HyPlan-sourced strips (`authority='hyplan'`, `generatedBy`, `inputs` = flight-line/DEM identity) | Fits-charter | Additive; `Provenance.authority` is already a free string per AGE-20; `correction:'NONE'` already means rendering-grade body-fixed |
| Instrument catalog as fixtures (transcribe HyPlan intrinsic FOV, incidence, pixel counts into `fixtures/models/*.json`) | Fits-charter | AGE-18 "models are data, not code"; the intrinsic angular params are altitude-independent and portable. Bridge airborne swath via `swathHalfWidthKm = altitude_agl * tan(half_angle)`, done in the adapter, not the frozen schema |
| Terrain-aware footprints carried as HyPlan's pre-computed DEM edges in a strip | Fits-charter | The strip carries edges only; Argelander renders them verbatim and guarantees nothing about their precision |
| Terrain-aware footprints computed inside `argelander-core` (import `hyplan/terrain`, shapely, pymap3d, DEM) | Violates-charter | Breaks both the analytic-ellipsoid-only non-goal and the zero-runtime-dependency rule; must instead route through the pluggable intercept service as an external delegate |
| Merged/co-designed instrument schema unifying HyPlan optics with the 21 families | Violates-charter | Reopens frozen SPEC-INSTRUMENT-MODEL/SPEC-STRIP; yields a lowest-common-denominator serving neither. Keep the seam a data format, never a shared schema |
| A dedicated scanning-lidar family for LVIS/ALSLidar | Violates-charter | AGE-03 enumerates exactly 21 families and the spec is frozen; model these as `whiskbroom` (scan-mirror mount plus `footprintGrowthFactor`, which is the exact 1/cos^2 physical basis of ALSLidar footprint growth) carrying `SubBeads`/`SubFootprint` |
| Solar-zenith / glint / `is_usable` fields on strips | Violates-charter | The quality vocabulary is closed at `incidenceDeg`/`resolutionM`/`lookCount`; adding a sun-angle slot is a schema change requiring an ADR. Drop them at the boundary or file the ADR. Note HyPlan's off-nadir tilt-from-nadir does map onto existing `incidenceDeg` with no schema change |
| Campaign / persistence container (multi-pass library, revision counter, folder persistence) | Fits-charter as bookkeeping, out of scope now | Additive around the frozen strip payload; `passId` is the only current analog. New scope beyond Phase 0; needs an ADR if it defines a new persisted contract. HyPlan's `campaign.json` plus revision model is a ready template, but not for this phase |

## 5. What NOT to do

Do not headline this as "HyPlan feeds Argelander satellite states." That is the low-value framing precisely because the overlap is sharpest there: `Sgp4Provider` already computes Earth TLE states natively, so a satellite-state feed is redundant. Scope it as HyPlan-produces-coverage, Argelander-animates.

Do not run two SGP4 propagators on the same bird expecting agreement. Argelander's rendering-grade Vallado WGS-72 near-Earth branch and Skyfield's official SGP4/SDP4 target different grades and disagree at the sub-kilometer level (MEMORY already tracks an eccentricity-proportional velocity residual). Pick one producer per satellite; if HyPlan produces, Argelander consumes its states and does not re-run its own SGP4 on that data.

Do not import HyPlan geometry, propagation, or terrain code into `argelander-core`. It would drag in skyfield, pymap3d, shapely, and geopandas plus a second propagator, violating the zero-runtime-dependency rule, the "no second SPICE" posture (a second acquisition-geometry authority in a second place), and the analytic-ellipsoid non-goal. The Python/TypeScript boundary usefully forbids this; do not fight it. Every seam must bind at a versioned file format, never a code merge, which also keeps the two release cadences (NASA/Pavlick vs the Cosmolabe/Bessel/Argelander line) decoupled.

Do not try to render HyPlan's airborne physics (AGL slant geometry, crab angle, winds, Dubins tracks, DEM intersection) inside Argelander. The strip carries edges only; flatten HyPlan geometry to edges at the exporter and drop the physics.

Do not serialize HyPlan's closed swath Polygon. Serialize the pre-polygon `port`/`star` (or `edge1`/`edge2`) arrays. The closed ring mispairs into twisted quads when NaN-filtered terrain intersections drop stations asymmetrically, and it imports already-broken antimeridian geometry.

Do not forget the `swath_width_km / 2` conversion to `swathHalfWidthKm`; the factor-of-2 doubles every footprint.

Do not add families (LVIS/ALSLidar scanning lidar, AWP dual-LOS) or widen the strip for solar/glint fields; both unfreeze Phase 0 contracts. Map onto existing families and existing quality tuples.

Do not pull `find_overpasses`, solar-zenith gating, or AOI-intersection into the engine. That turns Argelander into a planner and crosses the three-seam charter. Region-intersect-strip and usability logic belong above the seam as host/consumer code; illumination modeling belongs nowhere in the engine.

## 6. Recommendation

Build Path 1 and nothing else first: a HyPlan-side `hyplan/exports/argelander.py` that serializes its pre-polygon port/starboard edge arrays plus timestamps into strip-schema JSON, paired with a small Argelander foreign-strip reader (anticipated by AGE-04/AGE-14) that validates via `validateStrip` and animates through the existing Leaflet/Three surface. This unlocks live, treatment-rich rendering of HyPlan's coverage (satellites first via Path 2's registry-as-data, airborne next) with zero new `argelander-core` dependency and zero contract churn; treat the airborne StateProvider (Path 3) as a later, optional, lower-fidelity alternative and file an ADR only if the reader turns out to define a new ingest contract.