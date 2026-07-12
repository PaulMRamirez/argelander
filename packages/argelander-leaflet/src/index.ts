export {
  bodyRadiusKm, kmPerDegLat, stripToGeo, toGeo, unwrapLon, worldCopyOffsets,
} from './geo.js';
export type { GeoPoint, GeoSegment, GeoStrip, StripToGeoOptions } from './geo.js';
export {
  TREATMENTS, TREATMENT_LABELS, decideLod, medianProjectedWidthPx, nowMarkerIndex,
  paintGuide, paintNowLine, paintStrip, paintTrailWindow, qualityAlphaScale,
} from './paint.js';
export type { Canvas2DLike, PaintOptions, Projector, Treatment } from './paint.js';
export { ATLAS_PALETTE, DASH_PATTERNS, dashPatternFor, stateColor, withAlpha } from './palette.js';
export type { Palette } from './palette.js';
export { applyTrailFade, trailFadeAlpha } from './trail.js';
export { AcquisitionLayer } from './layer.js';
export type { AcquisitionLayerOptions } from './layer.js';
export { AcquisitionClock } from './clock.js';
export type { AcquisitionClockOptions, ClockDrivenLayer, ClockEntry } from './clock.js';
