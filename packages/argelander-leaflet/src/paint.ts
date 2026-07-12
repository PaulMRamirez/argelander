/**
 * Strip painting for the Leaflet adapter: the six treatments of AGE-07 as
 * pure styling policies over the strip schema, level of detail by projected
 * swath width (AGE-09, sparse geometries never inflated to ribbons), painted
 * against an abstract projector and 2D-context interface so every policy
 * tests headless. The projector owns the CRS: the layer hands in Leaflet's
 * latLngToContainerPoint, so MMGIS CRS configurations flow through untouched
 * (AGE-10) and this module never sees a map.
 */
import type { GeoPoint, GeoSegment, GeoStrip } from './geo.js';
import { kmPerDegLat, toGeo, unwrapLon, worldCopyOffsets } from './geo.js';
import type { Palette } from './palette.js';
import { ATLAS_PALETTE, dashPatternFor, stateColor, withAlpha } from './palette.js';

/** The six treatments (AGE-07), selectable per layer at runtime, atlas order. */
export type Treatment =
  | 'outline' | 'flat-fill' | 'now-trail'
  | 'mechanism' | 'quality-gradient' | 'time-gradient';

export const TREATMENTS: readonly Treatment[] = [
  'outline', 'flat-fill', 'now-trail', 'mechanism', 'quality-gradient', 'time-gradient',
];

/** The atlas names, for hosts that surface the treatments to people. */
export const TREATMENT_LABELS: Readonly<Record<Treatment, string>> = {
  'outline': 'OUTLINE ONLY',
  'flat-fill': 'FLAT FILL',
  'now-trail': 'NOW + FADING TRAIL',
  'mechanism': 'MECHANISM TEXTURE',
  'quality-gradient': 'QUALITY GRADIENT',
  'time-gradient': 'TIME GRADIENT',
};

/** The 2D-context subset the painters use; satisfied by CanvasRenderingContext2D. */
export interface Canvas2DLike {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  globalCompositeOperation: unknown;
  shadowColor: unknown;
  shadowBlur: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  setLineDash(pattern: readonly number[]): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): {
    addColorStop(offset: number, color: string): void;
  };
}

/** Geographic point to container pixels; the layer supplies the CRS. */
export type Projector = (p: GeoPoint) => readonly [number, number];

export interface PaintOptions {
  treatment: Treatment;
  /** Engine clock for now-trail and time-gradient; defaults to the last segment. */
  nowEtSec?: number;
  /** Explicit hue override (AGE-08); the atlas palette otherwise. */
  palette?: Palette;
  /** LOD threshold: below this projected swath width, mechanism falls back to envelope (AGE-09). */
  mechanismMinWidthPx?: number;
  fillAlpha?: number;
  lineWidthPx?: number;
  /** Age span of the time gradient; defaults to the strip time span. */
  timeWindowSec?: number;
}

interface Resolved {
  palette: Palette;
  nowEtSec: number;
  mechanismMinWidthPx: number;
  fillAlpha: number;
  lineWidthPx: number;
  timeWindowSec: number;
  dash: readonly number[];
}

function resolve(geo: GeoStrip, options: PaintOptions): Resolved {
  const first = geo.segments[0]!.etSec;
  const last = geo.segments[geo.segments.length - 1]!.etSec;
  return {
    palette: options.palette ?? ATLAS_PALETTE,
    nowEtSec: options.nowEtSec ?? last,
    mechanismMinWidthPx: options.mechanismMinWidthPx ?? 8,
    fillAlpha: options.fillAlpha ?? 0.35,
    lineWidthPx: options.lineWidthPx ?? 1.5,
    timeWindowSec: options.timeWindowSec ?? Math.max(last - first, 1e-9),
    dash: dashPatternFor(geo.strip.instrumentId),
  };
}

/** LOD decision by projected swath width in pixels (AGE-09). */
export function decideLod(medianWidthPx: number, thresholdPx: number): 'envelope' | 'mechanism' {
  return medianWidthPx >= thresholdPx ? 'mechanism' : 'envelope';
}

/** Median projected cross-track width, pixels, over non-zero-width segments. */
export function medianProjectedWidthPx(geo: GeoStrip, project: Projector): number {
  const widths: number[] = [];
  for (const s of geo.segments) {
    if (s.widthKm <= 0) continue;
    const l = project(s.left);
    const r = project({ lonDeg: unwrapLon(s.left.lonDeg, s.right.lonDeg), latDeg: s.right.latDeg });
    widths.push(Math.hypot(l[0] - r[0], l[1] - r[1]));
  }
  if (!widths.length) return 0;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)]!;
}

/** One quad or line in unwrapped geographic space, ready for world copies. */
function ringLons(points: readonly GeoPoint[]): number[] {
  const ref = points[0]!.lonDeg;
  return points.map((p) => unwrapLon(ref, p.lonDeg));
}

function tracePath(ctx: Canvas2DLike, project: Projector, points: readonly GeoPoint[], close: boolean): void {
  const lons = ringLons(points);
  for (const offset of worldCopyOffsets(lons)) {
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = project({ lonDeg: lons[i]! + offset, latDeg: p.latDeg });
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (close) ctx.closePath();
    if (close) ctx.fill();
    else ctx.stroke();
  }
}

/** Projected quad corners per world copy: [aLeft, aRight, bRight, bLeft]. */
function eachQuadCopy(
  project: Projector, a: GeoSegment, b: GeoSegment,
  cb: (pts: ReadonlyArray<readonly [number, number]>) => void,
): void {
  const points = [a.left, a.right, b.right, b.left];
  const lons = ringLons(points);
  for (const offset of worldCopyOffsets(lons)) {
    cb(points.map((p, i) => project({ lonDeg: lons[i]! + offset, latDeg: p.latDeg })));
  }
}

function fillQuad(ctx: Canvas2DLike, project: Projector, a: GeoSegment, b: GeoSegment, style: string): void {
  ctx.fillStyle = style;
  tracePath(ctx, project, [a.left, a.right, b.right, b.left], true);
}

function strokeLine(ctx: Canvas2DLike, project: Projector, from: GeoPoint, to: GeoPoint, style: string, width: number): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  tracePath(ctx, project, [from, to], false);
}

function dot(ctx: Canvas2DLike, project: Projector, p: GeoPoint, radiusPx: number, style: string): void {
  const [x, y] = project(p);
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(x, y, radiusPx, 0, 2 * Math.PI);
  ctx.fill();
}

/**
 * Pixels per kilometer at a point, probed through the projector over a half
 * degree of latitude. The wide baseline matters: Leaflet rounds projected
 * points to integer pixels, and a 1 km probe collapses to 0 or explodes to
 * a full pixel, inflating footprints forty-fold at world zoom.
 */
function localScalePxPerKm(geo: GeoStrip, project: Projector, at: GeoPoint): number {
  const baselineDeg = 0.5;
  const step = at.latDeg > 89 ? -baselineDeg : baselineDeg;
  const [x0, y0] = project(at);
  const [x1, y1] = project({ lonDeg: at.lonDeg, latDeg: at.latDeg + step });
  return Math.hypot(x1 - x0, y1 - y0) / (kmPerDegLat(geo.radiusKm) * baselineDeg);
}

/** Quad state: the state in force when its swath area finished acquiring. */
function quadState(later: GeoSegment): GeoSegment['state'] {
  return later.state;
}

/** Alpha policy for the quality gradient: stronger paint for better quality. */
export function qualityAlphaScale(geo: GeoStrip): (s: GeoSegment) => number {
  const metric = (s: GeoSegment): number | undefined => {
    if (s.quality?.resolutionM) return -(s.quality.resolutionM[0] + s.quality.resolutionM[1]) / 2;
    if (s.quality?.incidenceDeg) return -(s.quality.incidenceDeg[0] + s.quality.incidenceDeg[1]) / 2;
    if (s.quality?.lookCount !== undefined) return s.quality.lookCount;
    return undefined;
  };
  let min = Infinity;
  let max = -Infinity;
  for (const s of geo.segments) {
    const m = metric(s);
    if (m === undefined) continue;
    if (m < min) min = m;
    if (m > max) max = m;
  }
  const span = max - min;
  return (s) => {
    const m = metric(s);
    if (m === undefined || !(span > 0)) return 1;
    return 0.25 + (0.75 * (m - min)) / span;
  };
}

/** Beads and events paint at any LOD and any treatment; never ribbons (AGE-09). */
function paintSparse(ctx: Canvas2DLike, project: Projector, r: Resolved, segment: GeoSegment): void {
  if (!segment.sub) return;
  const color = stateColor(r.palette, segment.state);
  for (const entry of segment.sub) {
    if (entry.kind === 'beads') {
      for (const p of entry.points) dot(ctx, project, toGeo(p), 1.5, withAlpha(color, 0.9));
    } else if (entry.kind === 'event') {
      const g = toGeo(entry.center);
      dot(ctx, project, g, 2, withAlpha(color, 0.9));
      const [x, y] = project(g);
      ctx.strokeStyle = withAlpha(color, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}

/** Mechanism grade: draw the sub-structure detail of one segment (AGE-09). */
function paintMechanism(ctx: Canvas2DLike, geo: GeoStrip, project: Projector, r: Resolved, segment: GeoSegment): void {
  paintSparse(ctx, project, r, segment);
  if (!segment.sub) return;
  const color = stateColor(r.palette, segment.state);
  ctx.setLineDash(r.dash);
  for (const entry of segment.sub) {
    if (entry.kind === 'footprint') {
      const g = toGeo(entry.center);
      const [x, y] = project(g);
      // Floor the scale so a footprint never falls below a legible pixel
      // size; the aspect ratio survives the floor.
      const scale = Math.max(localScalePxPerKm(geo, project, g), 1.6 / entry.semiMajorKm);
      ctx.strokeStyle = withAlpha(color, 0.85);
      ctx.fillStyle = withAlpha(color, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      // rotationRad is counterclockwise from east; canvas y grows down.
      ctx.ellipse(x, y, entry.semiMajorKm * scale, entry.semiMinorKm * scale, -entry.rotationRad, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    } else if (entry.kind === 'frame') {
      ctx.strokeStyle = withAlpha(color, 0.85);
      ctx.fillStyle = withAlpha(color, 0.15);
      ctx.lineWidth = 1;
      const corners = entry.corners.map(toGeo);
      tracePath(ctx, project, corners, true);
      tracePath(ctx, project, [...corners, corners[0]!], false);
    } else if (entry.kind === 'look') {
      const mid = midpoint(segment.left, segment.right);
      const [x, y] = project(mid);
      const len = 14;
      ctx.strokeStyle = withAlpha(color, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * Math.cos(-entry.azimuthRad), y + len * Math.sin(-entry.azimuthRad));
      ctx.stroke();
    } else if (entry.kind === 'baseline') {
      const companion = toGeo(entry.companion);
      strokeLine(ctx, project, midpoint(segment.left, segment.right), companion, withAlpha(r.palette.guide, 0.6), 1);
      dot(ctx, project, companion, 2, withAlpha(color, 0.9));
    }
    // sub-swath membership stays envelope-grade; the geo-raster sector
    // repaint is a recorded adapter follow-up (goals/PHASE-1.md ledger).
  }
  ctx.setLineDash([]);
}

function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  const lonB = unwrapLon(a.lonDeg, b.lonDeg);
  return { lonDeg: (a.lonDeg + lonB) / 2, latDeg: (a.latDeg + b.latDeg) / 2 };
}

/**
 * Fill the ribbon quads whose completion time falls in (fromEtSec, toEtSec],
 * with a per-quad alpha policy. This is the trail increment primitive; the
 * full-strip treatments call it with an infinite window.
 */
function paintQuads(
  ctx: Canvas2DLike, geo: GeoStrip, project: Projector, r: Resolved,
  alphaOf: (later: GeoSegment) => number,
  fromEtSec: number, toEtSec: number,
): number {
  let painted = 0;
  for (let i = 0; i + 1 < geo.segments.length; i++) {
    if (!geo.connect[i]) continue;
    const later = geo.segments[i + 1]!;
    if (later.etSec <= fromEtSec || later.etSec > toEtSec) continue;
    const alpha = alphaOf(later);
    if (alpha <= 0) continue;
    fillQuad(ctx, project, geo.segments[i]!, later, withAlpha(stateColor(r.palette, quadState(later)), r.fillAlpha * alpha));
    painted++;
  }
  return painted;
}

/** Cross-track bar for segments that ribbon to nothing (lone bursts, exposures). */
function paintLoneSegments(ctx: Canvas2DLike, geo: GeoStrip, project: Projector, r: Resolved, widthPx: number): void {
  for (let i = 0; i < geo.segments.length; i++) {
    const s = geo.segments[i]!;
    if (s.widthKm <= 0) continue;
    const before = i > 0 ? geo.connect[i - 1]! : false;
    const after = i < geo.connect.length ? geo.connect[i]! : false;
    if (before || after) continue;
    strokeLine(ctx, project, s.left, s.right, withAlpha(stateColor(r.palette, s.state), 0.9), widthPx);
  }
}

/**
 * Faint guide underlay for now-trail: the strip edges at guide color, so the
 * pass geometry stays legible while the decaying trail sweeps it (the atlas
 * draws its dashed nominal track the same way).
 */
export function paintGuide(ctx: Canvas2DLike, geo: GeoStrip, project: Projector, options: PaintOptions): void {
  const r = resolve(geo, options);
  const style = withAlpha(r.palette.guide, 0.35);
  ctx.setLineDash([3, 5]);
  for (let i = 0; i + 1 < geo.segments.length; i++) {
    if (!geo.connect[i]) continue;
    const a = geo.segments[i]!;
    const b = geo.segments[i + 1]!;
    strokeLine(ctx, project, a.left, b.left, style, 1);
    strokeLine(ctx, project, a.right, b.right, style, 1);
  }
  if (geo.segments.every((s) => s.widthKm <= 0)) {
    for (let i = 0; i + 1 < geo.segments.length; i++) {
      strokeLine(ctx, project, geo.segments[i]!.left, geo.segments[i + 1]!.left, style, 1);
    }
  }
  ctx.setLineDash([]);
}

/** The bright cross-track line at the engine clock (the now of now-trail). */
export function paintNowLine(ctx: Canvas2DLike, geo: GeoStrip, project: Projector, options: PaintOptions): void {
  const r = resolve(geo, options);
  let current: GeoSegment | undefined;
  for (const s of geo.segments) {
    if (s.etSec <= r.nowEtSec + 1e-9) current = s;
    else break;
  }
  if (!current) return;
  // No marker once the acquisition is over: a tasked strip whose window has
  // passed must not park a stale now on its last segment.
  if (r.nowEtSec - current.etSec > geo.medianStepSec * 1.5 + 1e-9) return;
  if (current.widthKm > 0) {
    strokeLine(ctx, project, current.left, current.right, r.palette.acquiring, 3.5);
  }
  // Glowing beam-center marker, the atlas platform dot.
  const at = current.widthKm > 0 ? midpoint(current.left, current.right) : current.left;
  ctx.save();
  ctx.shadowColor = r.palette.acquiring;
  ctx.shadowBlur = 10;
  dot(ctx, project, at, 4, r.palette.acquiring);
  ctx.restore();
}

/**
 * Trail increment: coverage between two clock readings. The mechanism rides
 * the trail, the atlas behavior: footprints, beads, and frames appear as
 * the clock sweeps them and then decay with the trail.
 */
export function paintTrailWindow(
  ctx: Canvas2DLike, geo: GeoStrip, project: Projector, options: PaintOptions,
  fromEtSec: number, toEtSec: number,
): number {
  const r = resolve(geo, options);
  const painted = paintQuads(ctx, geo, project, r, () => 0.85, fromEtSec, toEtSec);
  for (const s of geo.segments) {
    if (s.etSec > fromEtSec && s.etSec <= toEtSec) paintMechanism(ctx, geo, project, r, s);
  }
  ctx.setLineDash([]);
  return painted;
}

/** Paint one strip under one treatment; pure policy over the strip schema. */
export function paintStrip(ctx: Canvas2DLike, geo: GeoStrip, project: Projector, options: PaintOptions): void {
  const r = resolve(geo, options);
  const treatment = options.treatment;

  if (treatment === 'outline') {
    ctx.setLineDash([]);
    for (let i = 0; i + 1 < geo.segments.length; i++) {
      if (!geo.connect[i]) continue;
      const a = geo.segments[i]!;
      const b = geo.segments[i + 1]!;
      const style = withAlpha(stateColor(r.palette, quadState(b)), 0.9);
      strokeLine(ctx, project, a.left, b.left, style, r.lineWidthPx);
      strokeLine(ctx, project, a.right, b.right, style, r.lineWidthPx);
    }
    paintLoneSegments(ctx, geo, project, r, r.lineWidthPx);
    for (const s of geo.segments) paintSparse(ctx, project, r, s);
    return;
  }

  if (treatment === 'flat-fill') {
    paintQuads(ctx, geo, project, r, () => 1, -Infinity, Infinity);
    paintLoneSegments(ctx, geo, project, r, 3);
    for (const s of geo.segments) paintSparse(ctx, project, r, s);
    return;
  }

  if (treatment === 'quality-gradient') {
    // The atlas recipe: a cross-swath edge fade, transparent at the edges
    // and strongest at the center, its strength scaled by segment quality.
    const scale = qualityAlphaScale(geo);
    for (let i = 0; i + 1 < geo.segments.length; i++) {
      if (!geo.connect[i]) continue;
      const later = geo.segments[i + 1]!;
      const color = stateColor(r.palette, quadState(later));
      const alpha = Math.min(1, r.fillAlpha * 1.6 * scale(later));
      eachQuadCopy(project, geo.segments[i]!, later, (pts) => {
        const grad = ctx.createLinearGradient(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]);
        grad.addColorStop(0, withAlpha(color, 0));
        grad.addColorStop(0.5, withAlpha(color, alpha));
        grad.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        pts.forEach(([x, y], j) => (j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.fill();
      });
    }
    paintLoneSegments(ctx, geo, project, r, 3);
    for (const s of geo.segments) paintSparse(ctx, project, r, s);
    return;
  }

  if (treatment === 'time-gradient') {
    // The atlas recipe: hue runs along track from early to late in the pass,
    // hsla(196 + 92 sf). Hue encoding time is the explicit AGE-08 override.
    const first = geo.segments[0]!.etSec;
    const span = Math.max(geo.segments[geo.segments.length - 1]!.etSec - first, 1e-9);
    for (let i = 0; i + 1 < geo.segments.length; i++) {
      if (!geo.connect[i]) continue;
      const later = geo.segments[i + 1]!;
      const frac = (later.etSec - first) / span;
      fillQuad(ctx, project, geo.segments[i]!, later, `hsla(${196 + 92 * frac},65%,60%,${r.fillAlpha})`);
    }
    paintLoneSegments(ctx, geo, project, r, 3);
    for (const s of geo.segments) paintSparse(ctx, project, r, s);
    return;
  }

  if (treatment === 'now-trail') {
    paintGuide(ctx, geo, project, options);
    paintTrailWindow(ctx, geo, project, options, -Infinity, r.nowEtSec);
    paintNowLine(ctx, geo, project, options);
    return;
  }

  // mechanism: LOD gate on projected swath width (AGE-09); below the
  // threshold the strip falls back to its envelope.
  const widthPx = medianProjectedWidthPx(geo, project);
  if (decideLod(widthPx, r.mechanismMinWidthPx) === 'envelope' && widthPx > 0) {
    paintQuads(ctx, geo, project, r, () => 1, -Infinity, Infinity);
    paintLoneSegments(ctx, geo, project, r, 3);
    for (const s of geo.segments) paintSparse(ctx, project, r, s);
    return;
  }
  // The atlas mechanism texture: a faint backdrop with cross-track hatching
  // in the instrument's dash pattern, plus whatever sub-structure detail the
  // strip carries on top.
  paintQuads(ctx, geo, project, r, () => 0.4, -Infinity, Infinity);
  ctx.setLineDash(r.dash);
  for (const s of geo.segments) {
    if (s.widthKm <= 0) continue;
    strokeLine(ctx, project, s.left, s.right, withAlpha(stateColor(r.palette, s.state), 0.4), 1);
  }
  paintLoneSegments(ctx, geo, project, r, 3);
  for (const s of geo.segments) paintMechanism(ctx, geo, project, r, s);
  ctx.setLineDash([]);
}
