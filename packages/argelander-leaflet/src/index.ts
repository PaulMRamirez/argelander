export {
  bodyRadiusKm, kmPerDegLat, stripToGeo, toGeo, unwrapLon, worldCopyOffsets,
} from './geo.js';
export type { GeoPoint, GeoSegment, GeoStrip, StripToGeoOptions } from './geo.js';
export {
  TREATMENTS, decideLod, medianProjectedWidthPx,
  paintNowLine, paintStrip, paintTrailWindow, qualityAlphaScale, timeAlphaScale,
} from './paint.js';
export type { Canvas2DLike, PaintOptions, Projector, Treatment } from './paint.js';
export { ATLAS_PALETTE, DASH_PATTERNS, dashPatternFor, stateColor, withAlpha } from './palette.js';
export type { Palette } from './palette.js';
export { applyTrailFade, trailFadeAlpha } from './trail.js';
export { AcquisitionLayer } from './layer.js';
export type { AcquisitionLayerOptions } from './layer.js';
