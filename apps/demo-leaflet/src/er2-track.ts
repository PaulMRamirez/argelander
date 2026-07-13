/**
 * The ER-2 airborne track as MMGIS Enhanced GeoJSON (PHASE-4): a LineString of
 * geographic positions whose vertices carry event_seconds (unix), the shape a
 * planning tool like HyPlan exports. The demo loads it through
 * geoJsonStateProvider to prove the inbound-state path end to end; the in-code
 * flight-line sampler (flightlines.ts) is the fallback. Generated from the same
 * SoCal to Montana transect at 300 s steps, with a step of margin on each end
 * so the demo window sits inside coverage despite the unix-to-Et float noise;
 * event_seconds convert back to the demo's Et grid (Et 0 at the J2000 epoch).
 */
export const ER2_TRACK_GEOJSON = {"type":"FeatureCollection","coord_properties":["longitude","latitude","elevation","event_seconds"],"features":[{"type":"Feature","properties":{"target":"ER2","platform":"ER-2","note":"demo airborne track, geodetic positions, event_seconds in unix seconds"},"geometry":{"type":"LineString","coordinates":[[-118.54253,33.8043,20000,946727635.816],[-118.1,34.2,20000,946727935.816],[-117.65331,34.59409,20000,946728235.816],[-117.20237,34.98654,20000,946728535.816],[-116.74709,35.37731,20000,946728835.816],[-116.2874,35.76635,20000,946729135.816],[-115.82319,36.15362,20000,946729435.816],[-115.35439,36.53909,20000,946729735.816],[-114.8809,36.9227,20000,946730035.816],[-114.40264,37.30441,20000,946730335.816],[-113.91951,37.68418,20000,946730635.816],[-113.43141,38.06196,20000,946730935.816],[-112.93827,38.4377,20000,946731235.816],[-112.43998,38.81135,20000,946731535.816],[-111.93645,39.18286,20000,946731835.816],[-111.43977,39.56071,20000,946732135.816],[-111.01161,39.98834,20000,946732435.816],[-110.57806,40.41438,20000,946732735.816],[-110.13899,40.83879,20000,946733035.816],[-109.69428,41.2615,20000,946733335.816],[-109.24379,41.68248,20000,946733635.816]]}}]} as const;
