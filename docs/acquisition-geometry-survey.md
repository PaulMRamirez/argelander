> Repo-native rendering of the survey (v1.3, 2026-07-10). The Word deliverable is the shareable form; this file is the in-repo reference that goals/PHASE-0.md extracts from.

# Acquisition Geometry and Footprint Rendering for Mission Operations Maps

A survey of past, current, and upcoming instrument scan geometries, rendering treatments for 2D and globe surfaces, and a component architecture for NASA AMMOS MMGIS

*Companion to the Acquisition Geometry Atlas (interactive HTML, v2, 21 geometry families and 6 treatments)*

Draft v1.3, July 10, 2026


## 1. Purpose and scope

This document surveys the ways spaceborne instruments actually touch a planetary surface, the ways those touches can be rendered on a 2D map or a globe, and the architecture of a reusable rendering component intended for infusion into NASA AMMOS MMGIS. It exists because footprint rendering is usually treated as a solved problem (draw a polygon) when in practice the geometry space is wide, the visual encoding space is wider, and the wrong defaults quietly mislead operators about what was, is, and will be observed. The interactive atlas that accompanies this document animates twenty-one geometry families and six rendering treatments; this document supplies the literature grounding, the mission catalog across past, current, and upcoming systems, and the engineering path.

Scope covers Earth observation in low Earth orbit and geostationary orbit, and planetary remote sensing including flyby geometries, because MMGIS serves planetary missions first and any component built for it must treat non-Earth bodies as first-class. Scope excludes in-situ instruments, astronomy pointing, and radio science, though the component architecture in Section 8 deliberately leaves room for them.

Three decisions structure everything that follows. Decision A is geometry fidelity: whether a footprint layer draws the envelope of coverage or the mechanism that produced it. Decision B is rendering treatment: which visual encoding a layer uses, chosen by the operator question the layer answers. Decision C is the integration surface: how a renderer-agnostic engine binds to MMGIS through Leaflet and three.js adapters. Section 9 records recommended positions on all three plus two supporting decisions.

## 2. How to read acquisition geometry

Every spaceborne measurement is the composition of three motions: the platform along its trajectory, the mount or scan mechanism relative to the platform, and the detector sampling relative to the optics. The ground pattern is what that composition projects onto the surface. Four terms recur. The instantaneous field of view (IFOV) is the patch a single detector element sees at one instant. The footprint is the resolved ground cell of one sample. The swath is the strip accumulated as the platform moves. The field of regard is the region an agile or gimballed system could observe, as distinct from what it does observe; the difference between the two is exactly the difference between capability and commitment, and rendering that difference (amber versus teal in the atlas convention) is one of the highest-value things a footprint layer can do.

Repeat geometry matters as much as single-pass geometry. Sun-synchronous imagers revisit on fixed repeat cycles with cross-track offsets between passes; interferometric SAR depends on near-exact repeat tracks; altimeter constellations interleave ground tracks to densify sampling; flyby missions never repeat at all and accumulate coverage as a mosaic of independent strips. A rendering component therefore needs a native notion of the pass as its unit of accumulation, not just the frame.

Finally, geometry degrades gracefully or it lies. A swath rendered as a clean rectangle hides burst seams, nadir gaps, bowtie growth, and incidence-dependent quality that operators sometimes need and sometimes must not be distracted by. The resolution of that tension is level-of-detail: envelope at small scale, mechanism past a zoom threshold, and the instantaneous aperture always live. That is Decision A, and it is a display policy, not a data policy; the engine should always carry enough parameterization to reconstruct the mechanism.

## 3. Optical imaging geometries

### 3.1 Pushbroom

A linear detector array is swept by platform motion, producing a continuous ribbon. This is the default geometry of modern land imaging: Sentinel-2 MSI (290 km swath), Landsat 8/9 OLI (185 km), and imaging spectrometers such as EMIT and PRISMA. Upcoming systems extend rather than replace it: the Copernicus CHIME hyperspectral pair will image a 130 km swath at 30 m from a two-satellite constellation, and Landsat Next widens the band set while keeping the ribbon. Rendering implication: the envelope is honest for pushbroom, so a simple ribbon with a live cross-track sensing line captures nearly everything; the only mechanism worth exposing at high zoom is detector-module banding when it drives artifacts.

### 3.2 Whiskbroom

A mirror sweeps the IFOV cross-track while the platform advances, painting the swath line by line. MODIS, AVHRR, and the Landsat TM/ETM+ generation defined the type. Its rendering signature is the bowtie: footprints grow and overlap toward the swath edge as slant range increases, which matters for anyone judging edge-of-swath usability. A faithful renderer grows the stamped footprint with scan angle; an envelope renderer at least fades edge quality (treatment 5 in the atlas).

### 3.3 Framing and push-frame

Framing cameras expose a 2D detector per shutter event, producing discrete rectangles: SkySat, most CubeSat imagers, and Sentinel-1 wave-mode vignettes (20 km by 20 km scenes leapfrogging every 100 km along track) all read as chains of frames. The push-frame variant bonds filter strips directly onto the detector so each exposure yields narrow color framelets that butt into a continuous multi-band swath as the platform moves: LROC WAC at the Moon builds seven-band coverage from 1024 by 14 pixel framelets, MARCI at Mars uses the same design, and JunoCam is the spin-scan expression of it, building frames as the spacecraft rotates. Rendering implication: frames want discrete outlines with acquisition flashes; push-frame wants the swath envelope at low zoom and framelet banding at high zoom, since framelet seams are where reconstruction artifacts live.

### 3.4 Multi-angle along-track

Fixed fore, nadir, and aft view stations observe the same corridor minutes apart. Terra MISR is the canonical instance: nine pushbroom cameras at nadir and 26.1, 45.6, 60.0, and 70.5 degrees fore and aft, a 360 km common swath, with any ground point seen by all nine cameras within about seven minutes. Mars Express HRSC does it with nine CCD lines behind one lens; ASTER carried a backward-looking stereo channel. Rendering implication: this is the geometry that most rewards a look-count treatment, because value accrues per station over the same ground; the atlas renders it as three stations painting one corridor whose fill deepens with each look.

### 3.5 Agile pointing, target tracking, and stare

Agile platforms trade fixed geometry for a field of regard, typically about 30 degrees of roll and pitch on Pleiades-class and WorldView-class systems, inside which they execute point collects, strips, stereo and tri-stereo pairs, corridors, and area mosaics. A distinct sub-mode is target tracking or stare: the mount holds one ground point while the platform flies past, used for video (SkySat), point-source gas spectrometry (GHGSat), and gimballed spectrometer targeting, of which MRO CRISM is the planetary archetype, tracking a target through the flyover to build a high-resolution cube while its survey mode simply locks the gimbal to nadir. Rendering implication: agile layers are the strongest case for the amber-to-teal state convention, because the interesting object is the tasking plan; stare layers additionally want the footprint to visibly rotate and stretch with slant range so the operator sees dwell quality, not just dwell existence.

|                          |                  |                         |                       |                |                                                                                      |
|--------------------------|------------------|-------------------------|-----------------------|----------------|--------------------------------------------------------------------------------------|
| **Mission / instrument** | **Era**          | **Geometry**            | **Swath / footprint** | **Resolution** | **Notes**                                                                            |
| Landsat MSS / TM / ETM+  | Past             | Whiskbroom              | 185 km                | 80 / 30 m      | Defined the archive; ETM+ scan-line corrector failure is a rendering cautionary tale |
| Terra / Aqua MODIS       | Current (sunset) | Whiskbroom              | 2330 km               | 250 m to 1 km  | Bowtie overlap at edges; twice-daily global                                          |
| Sentinel-2 MSI           | Current          | Pushbroom               | 290 km                | 10 to 60 m     | 5-day pair revisit; 2C launched 2024                                                 |
| Landsat 8/9 OLI          | Current          | Pushbroom               | 185 km                | 15 to 30 m     | WRS-2 grid; 8-day interleave                                                         |
| EMIT (ISS)               | Current          | Pushbroom (pointed)     | 75 km                 | 60 m           | ISS orbit, targeted masks, mineral dust                                              |
| SkySat / PlanetScope     | Current          | Framing / push-frame    | scene chains          | 0.5 to 3 m     | Video stare on SkySat; daily global from Doves                                       |
| Terra MISR               | Current          | Multi-angle             | 360 km common         | 275 m          | 9 angles in 7 min; 9-day global                                                      |
| LROC WAC (Moon)          | Current          | Push-frame              | ~60 km                | 100 m          | 7 bands from 1024x14 framelets                                                       |
| JunoCam (Jupiter)        | Current          | Spin push-frame         | spin-built frames     | km-class       | Frames assembled from spacecraft rotation                                            |
| Pleiades Neo / WV Legion | Current          | Agile tasking           | FOR band, ~30 deg     | 0.3 m class    | Point, strip, stereo, corridor, mosaic modes                                         |
| CHIME A/B                | Upcoming 2028-30 | Pushbroom hyperspectral | 130 km                | 30 m           | Copernicus expansion, 200+ bands                                                     |
| LSTM A/B                 | Upcoming 2028-29 | Pushbroom thermal       | wide TIR              | ~50 m          | Evapotranspiration at field scale                                                    |
| Landsat Next             | Upcoming ~2030s  | Pushbroom triplet       | 185 km class          | 10 to 60 m     | Three satellites, superspectral                                                      |

*Table 1. Optical imaging geometries across eras. Swath and resolution values are representative operating points, not exhaustive mode lists.*

## 4. Radar and microwave geometries

### 4.1 SAR stripmap, ScanSAR, and TOPS

Side-looking SAR images a ribbon offset from the ground track, with incidence angle varying across it. Stripmap holds one elevation beam (Sentinel-1 SM, TerraSAR-X, ICEYE standard modes; historically Seasat in 1978 and Magellan at Venus). ScanSAR and its refinement TOPS widen coverage by cycling the beam across sub-swaths in bursts: Sentinel-1 IW covers 250 km from three sub-swaths whose burst quilt and seams are real data features, and EW covers about 400 km from five. Rendering implication: the envelope ribbon is fine at continental scale, but past a zoom threshold the burst quilt and sub-swath seams should surface, because they are where radiometric steps and processing boundaries live.

### 4.2 Spotlight and staring modes

Spotlight steers the beam to dwell on one scene, buying azimuth resolution with coverage: TerraSAR-X staring spotlight, ICEYE Spot and Dwell, Capella and Umbra spotlight products. The rendering object is the tasked patch and its state transitions, exactly as with optical agile tasking; the atlas paints planned patches amber, the live dwell cyan, and committed collections teal.

### 4.3 SweepSAR and digital beamforming

NISAR, launched July 30, 2025 into a 747 km sun-synchronous orbit and in its science phase since late November 2025, is the first spaceborne SweepSAR: transmit illuminates the full 242 km swath off a 12 m reflector, and receive beams sweep electronically across the feed array so the echo is tracked as it crosses the swath. The consequence is wide coverage without the resolution sacrifice of ScanSAR (L-band 3 to 48 m, S-band 3 to 24 m across the same 242 km, 12-day repeat). ROSE-L (around 2030) and Sentinel-1 Next Generation continue the digital-beamforming direction. Rendering implication: the swath is contiguous, so the envelope is honest, but showing the simultaneous receive sub-beams at high zoom communicates why this ribbon can be both wide and sharp, and the interferometric use case makes repeat-pass ghosting (prior-pass outlines under the live pass) a first-class treatment.

### 4.4 Bistatic and formation flying

TanDEM-X extended TerraSAR-X with a near-identical twin flying a helix formation at typical baselines of 250 to 1000 m, forming a single-pass cross-track interferometer that produced the global 12 m DEM; the helix combines out-of-plane separation at the equator with radial separation at the poles to avoid collision risk. SRTM did it in 2000 with a 60 m mast on one platform. ESA Harmony (planned for the late 2020s) flies two receive-only companions with a Sentinel-1 illuminator. Rendering implication: the measurement is the baseline, not just the footprint; a faithful layer draws both platforms, the baseline between them, and the shared swath, and treats baseline length as a quality dimension.

### 4.5 Scatterometry

Two families. Fixed fan-beam: ASCAT on MetOp illuminates two 550 km swaths, each seen by fore, mid, and aft beams at roughly 45, 90, and 135 degrees, so every wind cell accrues three azimuth looks separated in time; the SCA follow-on flies on MetOp-SG B. Rotating pencil-beam: QuikSCAT SeaWinds spun two beams at 18 rpm at 46 and 54 degree incidence, tracing a dual-helix sampling pattern across 1400 and 1800 km swaths, a design carried on by OSCAT and HY-2, with CFOSAT SWIM adding a six-beam rotating wave spectrometer. Rendering implication: these are the geometries where mechanism texture earns its keep, because the crosshatch of azimuth looks and the cycloid of pencil-beam samples are the data quality story.

### 4.6 Altimetry, wide-swath interferometry, and sounders

Classic radar altimetry is a nadir bead chain (TOPEX/Poseidon through Sentinel-6, and Sentinel-6B since November 2025), densified by interleaved and geodetic orbits. SWOT KaRIn broke the nadir constraint with two 50 km interferometric swaths separated by a 20 km nadir gap in which the Poseidon-3C altimeter continues the bead chain; rendering the gap honestly, rather than closing the ribbon, is the difference between a truthful and a misleading coverage map. CRISTAL (around 2028) returns to the nadir chain with a dual-frequency altimeter for ice. Radar sounders (SHARAD and MARSIS at Mars, RIME at the Galilean moons) are nadir profilers whose product is depth, so on a 2D map they render as bead chains with the depth dimension deferred to a linked profile view.

|                          |                     |                               |                        |                                                                 |
|--------------------------|---------------------|-------------------------------|------------------------|-----------------------------------------------------------------|
| **Mission / instrument** | **Era**             | **Geometry**                  | **Swath / pattern**    | **Rendering notes**                                             |
| Seasat SAR               | Past 1978           | Stripmap                      | 100 km                 | First civil SAR; archival strips                                |
| SRTM                     | Past 2000           | Bistatic (mast)               | 225 km ScanSAR         | 60 m fixed baseline; 11-day global                              |
| Magellan (Venus)         | Past                | Stripmap                      | per-orbit noodles      | Planetary stripmap mosaic precedent                             |
| Sentinel-1 A/C/D         | Current             | TOPS IW / EW / SM / WV        | 250 / 400 / 80 / 20 km | Burst quilt and seams at high zoom; WV vignettes as frame chain |
| TerraSAR-X + TanDEM-X    | Current             | Strip / spot / bistatic helix | baselines 250-1000 m   | Draw both platforms and the baseline                            |
| ICEYE / Capella / Umbra  | Current             | Spot, strip, dwell            | tasked patches         | Amber-to-teal tasking states                                    |
| ALOS-4 PALSAR-3          | Current             | ScanSAR wide                  | up to 700 km           | Wide-mode quilt                                                 |
| NISAR L/S                | Current 2025        | SweepSAR DBF                  | 242 km full-res        | First spaceborne SweepSAR; 12-day InSAR stacks                  |
| SWOT KaRIn               | Current 2022        | Bilateral InSAR swaths        | 2 x 50 km + 20 km gap  | Render the nadir gap honestly; altimeter beads inside it        |
| ASCAT / SCA              | Current / MetOp-SG  | Fan-beam scatterometer        | 2 x 550 km             | Three azimuth looks crosshatch                                  |
| QuikSCAT lineage         | Past to current     | Rotating pencil beams         | 1400 / 1800 km         | Dual-helix cycloid sampling                                     |
| ROSE-L                   | Upcoming ~2030      | DBF wide swath                | wide L-band            | Copernicus expansion radar                                      |
| Harmony                  | Upcoming late 2020s | Bistatic companions           | with Sentinel-1        | Two receive-only spacecraft                                     |
| EnVision VenSAR          | Upcoming ~2030s     | Stripmap (Venus)              | targeted strips        | Planetary SAR returns to Venus                                  |

*Table 2. Radar geometries. SweepSAR values per NISAR mission documentation; TanDEM-X baseline range per DLR mission papers.*

## 5. Radiometers, lidar profilers, and limb geometries

### 5.1 Conical and step-scan microwave radiometry

Conically scanning radiometers hold incidence constant by spinning the antenna about the vertical: GMI sweeps a 140 degree forward sector at a 48.5 degree cone half-angle for an 885 km swath at about 32 rpm, AMSR2 covers 1450 km, and SSMIS continues the DMSP line; CIMR (around 2029) widens the class for polar monitoring. Cross-track step-scan sounders (ATMS, AMSU-A, IASI, CrIS, with IASI-NG on MetOp-SG) place discrete beam positions in rows, with footprints elongating off-nadir. Rendering implication: crescents of overlapping ellipses for conical, ellipse rows for step-scan; both compress acceptably to envelopes at small scale but the arc and row structure explains sampling density questions instantly at large scale.

### 5.2 Lidar and sparse profilers

Photon-counting and waveform lidars sample sparse tracks rather than swaths. ICESat-2 ATLAS carries six beams in three pairs, pairs separated about 3.3 km across track and 90 m within a pair; GEDI samples eight tracks of 25 m footprints from the ISS; CALIPSO and EarthCARE ATLID profile a single nadir line, and Aeolus (2018 to 2023) pointed its wind lidar 35 degrees off-nadir so its measurement line ran parallel to but offset from the ground track. Rendering implication: never inflate these to ribbons; bead chains at true spacing, with beam-pair structure visible at high zoom, are the honest form, and the strongest argument for Decision A being a display policy rather than a geometry simplification.

### 5.3 Limb sounding and occultation

Limb sounders (MLS, OMPS-LP) observe the atmosphere tangentially ahead of or behind the platform, so the measurement location is displaced hundreds to thousands of kilometers from the sub-satellite point along the ground track. GNSS radio occultation (COSMIC-2 and the commercial fleets) produces measurement events wherever a GNSS satellite sets or rises through the limb, scattered with respect to any single ground track. Rendering implication: decouple the measurement chain from the platform track visually, and render occultation as events popping into existence rather than as anything swept.

|                          |                |                        |                             |                                   |
|--------------------------|----------------|------------------------|-----------------------------|-----------------------------------|
| **Mission / instrument** | **Era**        | **Geometry**           | **Pattern scale**           | **Rendering notes**               |
| SMMR / SSM/I             | Past           | Conical                | 1400 km class               | Established the crescent form     |
| GMI                      | Current        | Conical 140 deg sector | 885 km, ~32 rpm             | Arc stacks; constant incidence    |
| AMSR2 / AMSR3            | Current        | Conical                | 1450 km                     | Wide crescents                    |
| ATMS / IASI / CrIS       | Current        | Cross-track step scan  | 2200 km rows                | Ellipse rows, off-nadir growth    |
| ICESat-2 ATLAS           | Current        | 6-beam lidar           | pairs 3.3 km / 90 m         | Bead chains at true spacing       |
| GEDI                     | Current (ISS)  | 8-track lidar          | 25 m footprints             | Sparse sampling, latitude-limited |
| EarthCARE CPR + ATLID    | Current 2024   | Nadir profilers        | single line                 | Doppler radar + lidar curtain     |
| Aeolus ALADIN            | Past 2018-23   | Slant lidar            | 35 deg off-nadir line       | Offset measurement line           |
| MLS / OMPS-LP            | Current        | Limb                   | tangent points ahead/behind | Displaced bead chain              |
| COSMIC-2 + commercial RO | Current        | Occultation events     | scattered                   | Event pops, no sweep              |
| CIMR                     | Upcoming ~2029 | Conical wide           | very wide swath             | Polar-focused radiometry          |
| CRISTAL                  | Upcoming ~2028 | Nadir altimeter        | bead chain                  | Dual-frequency ice altimetry      |

*Table 3. Radiometer, lidar, and limb geometries.*

## 6. Geostationary scanning

Geostationary imagers invert the LEO problem: the platform is fixed and the mirror does all the work, rastering a fixed disk. GOES-R ABI in its default 10-minute flex mode (mode 6) delivers a full disk every 10 minutes, a CONUS scene every 5 minutes, and two 1000 by 1000 km mesoscale boxes every 60 seconds, or one box every 30 seconds when both slots target the same domain; the mesoscale boxes are repositioned operationally to follow hazards. Himawari AHI and MTG FCI run equivalent cadences, and the historical GOES VISSR generation built the disk by spin scan, one line per spacecraft rotation.

The geostationary air-quality constellation applies the same fixed-disk logic to spectroscopy: TEMPO at 91 degrees West steps its scan mirror east to west across a Greater North America field of regard 1181 times per nominal hourly scan at about 2.0 by 4.75 km sampling, with sub-hourly special scans over limited east-west regions for events; GEMS covers Asia and Sentinel-4 on MTG-S1 (launched 2025) covers Europe. Rendering implication: geostationary layers are not swaths at all but raster fills over a fixed disk with nested sector cadences, so the natural encoding is a scan-progress fill plus discrete sector boxes with their own refresh clocks, and the mesoscale box, being taskable, takes the amber planned-state convention like any other tasked footprint.

|                        |              |                       |                                               |                                         |
|------------------------|--------------|-----------------------|-----------------------------------------------|-----------------------------------------|
| **System**             | **Era**      | **Full disk cadence** | **Sector cadences**                           | **Notes**                               |
| GOES VISSR era         | Past         | ~30 min (spin scan)   | none                                          | One line per rotation                   |
| GOES-R ABI (mode 6)    | Current      | 10 min                | CONUS 5 min; meso 1000 km at 60 s / 30 s      | Meso boxes repositioned to hazards      |
| Himawari AHI / MTG FCI | Current      | 10 min                | regional rapid scan                           | International cadence match             |
| TEMPO                  | Current 2023 | FOR scan hourly       | 1181 mirror steps E to W; sub-hourly specials | GEO air quality, 2.0 x 4.75 km          |
| GEMS / Sentinel-4      | Current      | hourly class          | regional                                      | Asia and Europe legs of the GEO-AQ ring |

*Table 4. Geostationary scan systems. ABI cadences per the GOES-R program; TEMPO scan parameters per the SAO instrument description.*

## 7. Planetary geometries and the flyby problem

Everything above recurs at other bodies with different constants: HiRISE is a 6 km swath pushbroom at 0.3 m sampling with a 1.2 km three-color center strip, CTX a 30 km swath at 6 m, THEMIS a thermal pushbroom, HRSC the nine-line stereo pushbroom, CaSSIS a rotating-telescope push-frame, MOLA and LOLA nadir bead chains, SHARAD and MARSIS nadir sounders, Diviner a thermal mapper, Mini-RF and DFSAR lunar SARs, and ShadowCam a pushbroom tuned for permanently shadowed regions. CRISM adds the gimballed dichotomy described in Section 3.5: a nadir-locked multispectral survey at 100 to 200 m built by frame-rate and binning choices, against gimbal-tracked targeted cubes at full spatial and spectral resolution. MMGIS already serves several of these data families, which is precisely why the component must treat planetary bodies as first-class rather than as an Earth special case.

The geometry with no Earth-orbit analog is the flyby. Cassini RADAR built Titan coverage from SAR strips 100 to 200 km wide and thousands of kilometers long (the first, from the October 2004 Ta flyby, ran about 4500 km), acquired one per targeted encounter as range, speed, and swath width all varied along the hyperbolic pass; the community calls them noodles, coverage reached roughly the high fifties of percent of the surface by mission end when HiSAR is included, and the mosaic of noodles at mixed incidence and resolution is the map. Europa Clipper will repeat the pattern at Europa with REASON, EIS, and MISE across dozens of flybys beginning around 2030. Rendering implication: a flyby layer must let swath width and sampling vary continuously along the strip, must not assume repeat tracks, and benefits enormously from per-strip metadata (encounter ID, incidence range, resolution range) surfaced on hover, because on flyby missions the strip is the fundamental unit of scientific bookkeeping.

|                         |                 |                          |                       |                                      |
|-------------------------|-----------------|--------------------------|-----------------------|--------------------------------------|
| **Instrument (body)**   | **Era**         | **Geometry**             | **Scale**             | **Notes**                            |
| Magellan SAR (Venus)    | Past            | Stripmap per orbit       | global mosaic         | Noodle mosaic precedent              |
| MOLA (Mars)             | Past            | Nadir laser beads        | shot chains           | Global topography from beads         |
| Cassini RADAR (Titan)   | Past            | Flyby SAR strips         | 100-200 km x 1000s km | One noodle per targeted flyby        |
| HiRISE (Mars)           | Current         | Pushbroom targeted       | 6 km swath, 0.3 m     | 1.2 km color center strip            |
| CTX (Mars)              | Current         | Pushbroom                | 30 km, 6 m            | Near-global context coverage         |
| CRISM (Mars)            | Past/Current    | Gimbal survey + targeted | 100-200 m / ~18 m     | Nadir survey vs gimbal-tracked cubes |
| HRSC (Mars)             | Current         | 9-line stereo pushbroom  | wide strips           | Stereo and color in one pass         |
| CaSSIS (Mars)           | Current         | Rotating push-frame      | stereo pairs          | Telescope rotates for stereo         |
| LROC NAC/WAC (Moon)     | Current         | Linescan + push-frame    | 0.5 m / 100 m         | Framelet swaths for WAC              |
| SHARAD / MARSIS (Mars)  | Current         | Nadir sounders           | profile lines         | Depth deferred to profile view       |
| Mini-RF / DFSAR (Moon)  | Current         | SAR strips               | polar strips          | Includes bistatic experiments        |
| Europa Clipper (Europa) | Upcoming ~2030  | Flyby suite              | dozens of encounters  | REASON, EIS, MISE noodles            |
| EnVision (Venus)        | Upcoming ~2030s | Stripmap SAR             | targeted strips       | Returns SAR to Venus                 |

*Table 5. Planetary instrument geometries relevant to MMGIS.*

## 8. Rendering treatments

Six treatments cover the operational question space, and they compose freely with every geometry above. Outline only draws boundaries and survives dozens of stacked layers, with overlap reading as a lattice; it answers where the edges are. Flat fill with alpha stacking answers what is covered and how many times, because overlap darkens automatically into a look-count map. Now plus fading trail is the live operations default: a bright instantaneous aperture with an exponentially decaying history answers what is being sensed right now. Mechanism texture (hatch orientation, bead spacing, burst blocks) answers which instrument produced a footprint without spending color. Quality gradient fades the fill toward the swath edge or with off-nadir angle and answers how good the sample is here. Time gradient ramps hue along track and answers when each part was collected.

Two conventions should be global rather than per-layer. First, reserve hue for state: cyan for the instantaneous aperture, teal for committed coverage, amber for planned or tasked, with instrument identity carried by texture; this is what keeps a ten-layer display legible. Second, degrade by level of detail, not by lying: envelopes at small scale, mechanism past a zoom threshold, and the sparse geometries (lidar beads, occultation events) never inflated into ribbons at any scale. Prior art supports both: NASA Worldview and the EOSDIS swath layers render envelope coverage with time as the primary filter; Cesium CZML and STK sensor-volume projections render mechanism-accurate instantaneous apertures; operational GEO viewers render sector boxes with independent refresh clocks. The component in Section 9 makes all six treatments styling policies over one strip schema, so the choice is per layer and reversible.

Two further encodings earn a place in the backlog rather than the core six. Uncertainty ellipses on pointing-limited footprints (a real concern on flyby and stare geometries) and aggregate coverage statistics (counts binned to a raster or an H3 grid for reporting) both consume the same strip schema, and neither changes the engine contract.

## 9. Component architecture for AMMOS MMGIS

### 9.1 Shape of the component

The proposal is one renderer-agnostic core with thin adapters, working name AGE (Acquisition Geometry Engine), delivered as an open repository suitable for the mission-community ecosystem. The core consumes ephemerides and instrument models and produces time-tagged footprint strips; adapters consume strips and paint them. Nothing in the core knows about Leaflet, three.js, or the DOM, which is what makes it testable headlessly and reusable outside MMGIS.

The data spine is the strip: a typed-array sequence of cross-track segments, each carrying time, left and right edge positions in body-fixed coordinates, an optional sub-structure list (sub-swath index, beam or bead positions, burst ID), and a state field (planned, acquiring, committed). Every geometry in Sections 3 through 7 reduces to strips plus a mechanism annotation: a pushbroom is one strip; TOPS is three interleaved strips with burst IDs; ICESat-2 is six degenerate strips of zero width with bead spacing; a conical scanner is a strip whose sub-structure is arc samples; an ABI mesoscale box is a stationary strip with a refresh clock; a Cassini noodle is a strip whose width varies per segment. The treatments in Section 8 are pure functions of strips, which is why they compose.

### 9.2 Ephemeris and instrument model inputs

Four input paths, in priority order. SPICE first, because MMGIS is planetary and SPICE is the lingua franca: kernel-driven platform and mount states via a WebAssembly SPICE build or a server-side sampling service that emits pre-sampled states, with the choice deferred to Phase 1 benchmarking. SGP4/TLE second, for Earth-orbit demonstrations and commercial constellations, via an existing propagator library in a Web Worker. CZML and static GeoJSON third, as the interchange path for products computed elsewhere. Live telemetry fourth: a bridge that subscribes to platform and mount state parameters (the natural provider in the AMMOS context is Yamcs) and extrudes the committed strip in real time while the planned strip ahead of now remains amber. Instrument models are declarative: mount type, scan law and rate, beam or detector layout, timing, drawn from a small schema whose classes cover the twenty-one families; the atlas tiles are effectively the reference implementations of those classes. All four paths enter through one StateProvider-shaped interface (Section 9.8), so the standalone providers and the Bessel engines are interchangeable at a type boundary rather than a rewrite boundary.

### 9.3 Adapters

The Leaflet adapter comes first because the MMGIS 2D Map is the mature surface: an L.Layer owning one canvas overlay per acquisition layer, projecting strip edges through the map CRS, painting fills into a persistent trail canvas with per-frame exponential decay exactly as the atlas does, and drawing the instantaneous aperture in the overlay pass. Projection edge cases are the adapter’s responsibility: antimeridian splitting, polar strips under non-global CRS definitions, and body radii other than Earth’s, all of which MMGIS already exercises. The three.js adapter follows for the Globe: strips become instanced ribbon meshes or a screen-space decal pass, with trail decay done in a framebuffer multiply rather than per-geometry alpha, which is both faster and closer to the atlas semantics. The adapter targets the same Three release train and WebGPU-with-WebGL2-fallback strategy the Cosmolabe renderer tier ADR baselines, so one adapter core serves LithoSphere (the MMGIS Globe) and Cosmolabe hosts alike. A deck.gl adapter is a possible third but is not on the critical path.

### 9.4 MMGIS integration

Integration rides existing MMGIS constructs rather than inventing parallel ones. A new layer type in the layer configuration declares an acquisition layer: source (SPICE kernel set, TLE, CZML, live bridge), instrument model reference, treatment, and state palette. The MMGIS time UI drives the engine clock directly, so scrubbing time replays coverage and stepping into the future previews plan. Planned-versus-executed state maps onto plan-aware map state (SPEC-01), and accumulated coverage, look counts, and gap maps are computed layers in the SPEC-02 sense: derived, cacheable, and queryable, so that decision queries (SPEC-03) can ask when a site was last covered or which upcoming pass first covers it. Multi-asset displays (SPEC-04) get the shared-frame behavior for free because strips are body-fixed. None of this requires MMGIS core changes beyond layer-type registration, which is the correct coupling for an extension intended to live in a community plugin organization.

### 9.5 Performance and quality gates

Budgets, not aspirations: 60 fps with 20 simultaneous animated layers on a mid-range laptop in the Leaflet adapter, propagation and strip generation off the main thread in workers, trail decay via compositing rather than repainting history, level-of-detail switching by projected swath width in pixels, and reduced-motion compliance by pre-computing a single pass and pausing. Headless rendering of strips to raster (for shift-handoff reports and coverage summaries) is a deliverable, not a nice-to-have, because it is what connects this component to reporting and to agent-generated products. Every geometry class ships with a golden-image test and a numeric strip-schema test; the atlas doubles as the visual regression corpus.

### 9.6 Requirements draft

|        |                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|--------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID** | **Requirement**                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AGE-01 | The core shall be renderer-agnostic, with no DOM, Leaflet, or three.js dependency, and shall run headlessly under Node for tests and report rendering.                                                                                                                                                                                                                                                                                    |
| AGE-02 | The core shall represent all coverage as time-tagged strips: cross-track segments with edges in body-fixed coordinates, optional sub-structure, and a state field of planned, acquiring, or committed.                                                                                                                                                                                                                                    |
| AGE-03 | The instrument model schema shall express, at minimum, the 21 geometry families of the atlas: pushbroom, whiskbroom, step-scan, conical, framing, push-frame, multi-angle, profiler, stripmap, TOPS/ScanSAR, spotlight, SweepSAR, bistatic formation, fan-beam and pencil-beam scatterometry, bilateral swath with nadir gap, limb and occultation, GEO raster with sectors, agile tasking, target stare, and flyby variable-range swath. |
| AGE-04 | Ephemeris inputs shall include SPICE kernels (primary), SGP4/TLE, and CZML or GeoJSON interchange; live state via a telemetry bridge (Yamcs first) shall extrude the committed strip in real time. All state shall enter through a StateProvider-shaped interface.                                                                                                                                                                        |
| AGE-05 | All propagation and strip generation shall run off the main thread; the main thread shall only paint.                                                                                                                                                                                                                                                                                                                                     |
| AGE-06 | The engine shall support non-Earth bodies as first-class: arbitrary body radii, body-fixed frames from SPICE, and non-repeating flyby trajectories.                                                                                                                                                                                                                                                                                       |
| AGE-07 | The six treatments (outline, flat fill, now plus trail, mechanism texture, quality gradient, time gradient) shall be pure styling policies over the strip schema, selectable per layer at runtime.                                                                                                                                                                                                                                        |
| AGE-08 | Hue shall be reserved for state (instantaneous, committed, planned) by default; instrument identity shall default to texture. Defaults shall be overridable but the override shall be explicit.                                                                                                                                                                                                                                           |
| AGE-09 | Level of detail shall switch between envelope and mechanism rendering by projected swath width in pixels; sparse geometries (beads, events) shall never be inflated to ribbons.                                                                                                                                                                                                                                                           |
| AGE-10 | The Leaflet adapter shall handle antimeridian splitting, polar strips, and MMGIS CRS configurations, painting into a persistent trail canvas with exponential decay.                                                                                                                                                                                                                                                                      |
| AGE-11 | The three.js adapter shall render strips on the MMGIS Globe with trail decay performed in a framebuffer pass.                                                                                                                                                                                                                                                                                                                             |
| AGE-12 | The MMGIS layer configuration shall declare acquisition layers (source, instrument model, treatment, palette) without MMGIS core changes beyond layer-type registration.                                                                                                                                                                                                                                                                  |
| AGE-13 | The engine clock shall bind to the MMGIS time UI; scrubbing shall replay coverage and future time shall preview planned strips.                                                                                                                                                                                                                                                                                                           |
| AGE-14 | Accumulated coverage, look count, and gap products shall be exportable as computed layers (raster and H3 aggregates, GeoJSON strip outlines) with provenance metadata per strip: mission, instrument, mode, pass or encounter ID, and quality ranges.                                                                                                                                                                                     |
| AGE-15 | Performance budget: 60 fps with 20 animated layers on reference hardware in the Leaflet adapter; graceful degradation by LOD before frame-rate loss.                                                                                                                                                                                                                                                                                      |
| AGE-16 | Reduced-motion preference shall pre-render one pass and pause; all animation shall be pausable and speed-scalable.                                                                                                                                                                                                                                                                                                                        |
| AGE-17 | Each geometry class shall ship with a golden-image visual test and a numeric strip test; the atlas is the visual regression corpus.                                                                                                                                                                                                                                                                                                       |
| AGE-18 | License shall be Apache-2.0, with the repository structured for community contribution of instrument models as data, not code.                                                                                                                                                                                                                                                                                                            |
| AGE-19 | The state interface shall be contract-compatible with the Bessel StateProvider. AGE shall not embed an independent CSPICE build; SPICE-quality states arrive from a provider (a pre-sampled service standalone, cspice-wasm when hosted with Bessel).                                                                                                                                                                                     |
| AGE-20 | Strips shall be publishable as typed AnalysisProduct records carrying the provenance authority field, so acquisition products flow through the same product plumbing as other Bessel results.                                                                                                                                                                                                                                             |

*Table 6. Requirements draft for the Acquisition Geometry Engine (AGE) and its adapters.*

### 9.7 Phasing

Phase 0 baselines this document and the atlas as the reference behavior, and lands the strip schema plus the instrument model schema as reviewed artifacts. Phase 1 delivers the core engine with SPICE and TLE inputs, the Leaflet adapter, envelope rendering with all six treatments, and three demonstration configurations: an Earth SAR constellation, ICESat-2 beads, and a Mars orbiter pair (CTX plus HiRISE targeting) to prove the planetary path early. Phase 2 adds mechanism-level LOD, the three.js Globe adapter, the GEO raster class, and the computed-layer exports. Phase 3 adds the live telemetry bridge, tasking-state ingestion so amber plans flow from planning systems and flip to teal on execution confirmation, the flyby class exercised against a Europa Clipper tour kernel set, and, per Section 9.8, a Bessel provider binding once the merge lands its cspice-wasm and frames tier. Each phase ends with the atlas re-rendered through the engine itself, which is the moment the demo stops being a sketch and becomes the test suite.

### 9.8 Relationship to Bessel and Cosmolabe

The Bessel and Cosmolabe go-forward plan settles the division this component lives inside: Cosmolabe is what you see, Bessel is what computes, and the design review already lists coverage drapes and sincpt-derived footprints among the visual pull items. AGE is the systematic form of exactly those two items, so the correct reading is that AGE becomes the third leg of the same product line rather than a parallel footprint path growing inside Bessel. Bessel owns time, frames, and state; the SPICE seam, with its differential validation harness, stays the single authority and is never duplicated here. AGE owns instrument models, scan laws, strip generation, and coverage accumulation. Cosmolabe and the MMGIS surfaces own the pixels. Standalone first remains correct, because MMGIS needs the layer now and the merge has its own critical path; the obligation standalone-first imposes is that every seam be a contract, so that convergence later is a binding, not a port.

Three seams, named. Inbound, AGE consumes platform and mount state through an interface shaped as a strict subset of the Bessel StateProvider contract; standalone it ships thin providers (SGP4 in a worker, pre-sampled SPICE states from a service, CZML), and it deliberately does not embed an independent CSPICE build, because a second WASM SPICE would recreate the highest-risk seam of the merge in a second place. Footprint intercepts follow the same logic: AGE computes rendering-grade footprints by analytic ellipsoid intersection internally, and exposes a pluggable intercept service so analysis-grade, terrain-true footprints delegate to the sincpt path in Bessel (or a DEM service) when precision matters. Outbound, the strip is typed as an AnalysisProduct: the provenance authority field the go-forward plan places in the contract carries per-strip mission, instrument, mode, and pass or encounter identity, so acquisition products flow through the same plumbing as every other Bessel result. On the render side, the shared Three adapter core means Cosmolabe hosts AGE output natively, and in the four-form analysis grammar it lands without invention: strips are geometry drapes, coverage accumulation is a scalar field, and pass windows are interval lanes.

Two conventions need one reconciliation and one alignment. The atlas reserves hue for acquisition state (cyan now, teal committed, amber planned); the Cosmolabe provenance grammar reserves the accent color for computed-here. These occupy different channels: state hues live inside the map fill, provenance accent lives in product chrome, and neither borrows the other. Packaging aligns with the naming resolution: age-core plus per-surface adapters publish under the same neutral-scope destination as the Bessel libraries (OMF when ready, the pragmatic interim scope until then), Apache-2.0 and DCO from day one, ADR discipline unbroken, with MMGIS layer-type registration remaining the standalone delivery vehicle. The profile ladder carries over as well: the Leaflet canvas adapter is cheap enough to serve as the tier-C representation on the phone Companion, which means acquisition layers degrade by adapter choice before they degrade by frame rate.

### 9.9 Name, repository, and demo path

The component takes the proper name Argelander, with AGE retained as the functional identity so requirement IDs and the strip schema never churn, exactly as engines keep functional names inside Bessel. The lineage is precise on both axes. Functionally, footprint prediction is already Besselian: the 1824 method expresses the ephemerides in terms of the shadow with respect to the body center on a fundamental plane, then projects the cone onto the rotating figure of the Earth to yield the umbra and penumbra path, so the path of totality is the first predicted swath and the ancestral algorithm of this engine is Bessel’s own. Personally, Friedrich Argelander was Bessel’s pupil at Königsberg and heir to his methods, and the Bonner Durchmusterung surveyed the sky in declination zones by fixing the telescope and recording stars as they drifted across the transit line: drift-scan is the ur-pushbroom, zones are swaths, and 324,198 stars accumulated into the first comprehensive modern catalog is systematic strip coverage of a sphere assembled into an atlas, which is this component’s job description verbatim. The product line extends to: Cosmolabe is what you see, Bessel is what computes, Argelander is what surveys. Registry state as of July 10, 2026: argelander is free on npm, PyPI, and crates.io, argelander-core, argelander-leaflet, and argelander-three are free on npm, and the GitHub handle argelander is unregistered; claim the npm names and the handle immediately, with migration to the neutral scope alongside the Bessel libraries recorded as the intended destination.

Repository posture: a standalone repository, not a fork. Forking MMGIS would invert the dependency, since the engine must be a dependency of MMGIS rather than a patch inside it, would couple every demo to a server-backed host, and would become code shared by copy, the exact failure mode Decision F names as the signal to converge. Forking Bessel would couple this schedule to the merge critical path in the middle of its spine bake-off and SPICE re-point. Forking Cosmolabe, the tempting third option because the globe, atmosphere, and terrain are already beautiful there, fails on three counts: the base is at its most fluid exactly now, with the spine bake-off and the renderer tier ADR pending and both owned by Aaron under the driver split, so a fork diverges against a moving target; a core incubated inside one renderer reaches into that renderer’s scene graph, camera, and clock and quietly forfeits the renderer-agnosticism of AGE-01, leaving the MMGIS Leaflet path as a port instead of a sibling; and a unilateral fork sidesteps the CODEOWNERS contract the merge just established, since core and rendering belong to Aaron. The Cosmolabe-hosted demonstration still happens early, through the other door: an examples app in the Argelander repository that imports Cosmolabe pinned at a commit, read-only, or a short-lived integration branch inside Cosmolabe proper, proposed to Aaron as the delivery of the coverage-drape and sincpt-footprint pull items his own design review requested. A pin never diverges; the danger begins only when a fork starts patching host internals. The standalone shape is a small monorepo: packages argelander-core, argelander-leaflet, and argelander-three; an apps tree carrying the atlas as the day-one public demo (single file, zero install) and a Leaflet demo app driving live footprints from SGP4 over open basemap tiles with no server at all; and the governance and harness conventions carried over from the Bessel scaffold, Apache-2.0 and DCO from day one, ADR discipline unbroken, CLAUDE.md as the canonical agent context, hosted under a personal org now with NASA-AMMOS or OMF recorded in ADR-0001 as the deliberate destination. MMGIS integration then lands as a layer-type registration change that imports the published Leaflet adapter; if an MMGIS fork exists at all, it exists as a disposable integration testbed, never as the repository of record.

Demo sequencing follows from that shape. The atlas ships as the repository’s public demonstration immediately, because it already exists and installs nothing. The Phase 1 exit re-renders the atlas tiles through argelander-core, converting the demo into the visual regression corpus. The Leaflet demo app is the first host-shaped demonstration and doubles as the MMGIS integration rehearsal, and the Phase 3 Bessel provider binding turns the same demo into the convergence proof.

## 10. Decision register

|        |                                      |                                                                                                   |                                                                                                                                                                                                                                                                            |
|--------|--------------------------------------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ID** | **Decision**                         | **Options**                                                                                       | **Recommendation**                                                                                                                                                                                                                                                         |
| A      | Geometry fidelity                    | Envelope only; mechanism only; zoom-dependent hybrid                                              | Hybrid: envelope at small scale, mechanism past a pixel-width threshold, instantaneous aperture always live; sparse geometries always mechanism-true                                                                                                                       |
| B      | Treatment per layer                  | Six treatments of Section 8                                                                       | Choose by operator question; defaults: now+trail for live ops, flat fill for coverage review, outline for dense multi-layer, texture for multi-instrument, quality for exploitation, time for search                                                                       |
| C      | Integration surface                  | Leaflet first; three.js first; both simultaneously                                                | Leaflet adapter first on the mature 2D Map, three.js Globe second, single core feeding both                                                                                                                                                                                |
| D      | Ephemeris source                     | SPICE (WASM or service); SGP4; CZML; live bridge                                                  | SPICE-first through a StateProvider-shaped interface; pre-sampled SPICE service standalone, cspice-wasm adopted from Bessel rather than rebuilt; SGP4 for Earth demos, CZML interchange, Yamcs live bridge in Phase 3                                                      |
| E      | Coverage aggregation substrate       | Raster tiles; H3 cells; vector unions                                                             | H3 for statistics and queries, raster for display export; vector unions only for small strip counts                                                                                                                                                                        |
| F      | Relationship to Bessel and Cosmolabe | Fold into the merge now; standalone forever; standalone-first with contract seams                 | Standalone-first for MMGIS delivery; convergence by three contracts: StateProvider in, strip-as-AnalysisProduct out, Three adapter hosted as a Cosmolabe geometry drape; no second SPICE seam in AGE                                                                       |
| G      | Name and repository posture          | Functional name only; fork MMGIS; fork Bessel; fork Cosmolabe; standalone repo with a proper name | Argelander as proper name, AGE as functional identity; standalone monorepo (core plus Leaflet and Three adapters plus demo apps); Cosmolabe-hosted demo via a pinned examples app or an integration branch with Aaron, never a fork; claim npm names and GitHub handle now |

*Table 7. Decision register with recommended positions.*

Decisions A and B are display policy and remain reversible per layer forever. Decision C is sequencing, not exclusivity. Decisions D and E are the two with real switching costs, which is why Phase 1 benchmarks the SPICE path before committing the WASM-versus-service split. Decision F is sequencing with teeth: standalone-first is only safe because the seams are contracts, and the moment any seam is tempted to become code shared by copy, that is the signal to converge instead.

## 11. References

**\[1\]** NASA/JPL, NISAR mission and SweepSAR technique descriptions, science.nasa.gov/mission/nisar; eoPortal, NISAR (NASA-ISRO Synthetic Aperture Radar) mission page.

**\[2\]** ISRO and mission reporting on NISAR launch (July 30, 2025, GSLV-F16) and science phase declaration (November 2025).

**\[3\]** NOAA GOES-R Program, ABI instrument and scan mode information (modes 3, 4, 6), goes-r.gov/spacesegment/abi.html and goes-r.gov/users/abiScanModeInfo.html.

**\[4\]** Smithsonian Astrophysical Observatory, TEMPO instrument description (field of regard, hourly east-west scan, 1181 mirror steps, 2.0 x 4.75 km), tempo.si.edu/instrument.html; NASA Earthdata TEMPO pages.

**\[5\]** NASA/JPL MISR project, viewing angles and instrument overview (nine cameras, 360 km common swath, seven minutes to all angles), misr.jpl.nasa.gov; NASA LaRC ASDC MISR project guide.

**\[6\]** Krieger, G., et al., TanDEM-X: A satellite formation for high-resolution SAR interferometry, IEEE TGRS; DLR TanDEM-X mission papers (helix formation, 250 to 1000 m baselines, global 12 m DEM); eoPortal TanDEM-X page.

**\[7\]** ESA and NASA Cassini RADAR mission pages and literature (Titan SAR strips 100 to 200 km wide; Ta swath about 4500 km long); USGS Astrogeology Titan SAR/HiSAR global mosaic notes.

**\[8\]** Robinson, M. S., et al., Lunar Reconnaissance Orbiter Camera (LROC) instrument overview (WAC seven-band push-frame from 1024 x 14 framelets); Hansen, C. J., et al., Junocam: Juno’s outreach camera (push-frame on a spinning platform).

**\[9\]** Murchie, S., et al., CRISM on MRO, JGR 2007 (gimballed targeted observations versus nadir multispectral survey at 100 to 200 m).

**\[10\]** Malin, M. C., et al., Context Camera investigation on MRO, JGR 2007 (30 km swath, 6 m); McEwen, A. S., et al., MRO HiRISE, JGR 2007 (6 km swath, 0.3 m sampling, 1.2 km color strip).

**\[11\]** ESA, Copernicus Sentinel Expansion missions (CO2M, CHIME, CIMR, CRISTAL, LSTM, ROSE-L) and EU/CNES launch planning summaries (expansion launches in the 2027 to 2030 window).

**\[12\]** ESA Sentinel-1 technical documentation (IW TOPS: 250 km from three sub-swaths; EW; WV 20 km vignettes).

**\[13\]** NASA/JAXA GPM GMI instrument documentation (conical scan, 140 degree sector, 885 km swath); JAXA AMSR2 documentation (1450 km swath).

**\[14\]** NASA ICESat-2 ATLAS documentation (six beams, three pairs, about 3.3 km pair separation, about 90 m within pair); GEDI mission documentation (eight ground tracks, 25 m footprints).

**\[15\]** EUMETSAT ASCAT product guides (two 550 km swaths; fore, mid, aft azimuth looks); NASA QuikSCAT SeaWinds documentation (18 rpm, 46 and 54 degree beams, 1400 and 1800 km swaths).

**\[16\]** NASA/CNES SWOT KaRIn documentation (two 50 km swaths, 20 km nadir gap, Poseidon-3C nadir altimeter).

**\[17\]** NASA Worldview / EOSDIS GIBS swath imagery documentation; AGI/Cesium CZML sensor and footprint conventions (prior art for envelope and instantaneous-aperture rendering).

**\[18\]** NASA AMMOS MMGIS repository and documentation (Leaflet-based 2D Map, three.js Globe), github.com/NASA-AMMOS/MMGIS.

**\[19\]** Besson, J., Le cosmolabe, ou Instrument universel concernant toutes observations, Paris, 1567; Museo Galileo, Astrolabe components (mater, tympanum, rete, alidade), catalogue.museogalileo.it.

**\[20\]** NASA GSFC Eclipse Web Site, Besselian Elements of Solar Eclipses (Bessel 1824, fundamental plane, umbra and penumbra path projection), eclipse.gsfc.nasa.gov.

**\[21\]** Britannica, F. W. A. Argelander (pupil and successor of Bessel at Koenigsberg); Bonner Durchmusterung machine-readable documentation (zone drift-scan method, 324,198 stars, 1852-1862), NASA ADC / Internet Archive.
