/**
 * Strip painting for the Leaflet adapter: the six treatments of AGE-07 as
 * pure styling policies over the strip schema, level of detail by projected
 * swath width (AGE-09, sparse geometries never inflated to ribbons), painted
 * against an abstract projector and 2D-context interface so every policy
 * tests headless. The projector owns the CRS: the layer hands in Leaflet's
 * latLngToContainerPoint, so MMGIS CRS configurations flow through untouched
 * (AGE-10) and this module never sees a map.
 */
import type { SubStructure } from 'argelander-core';
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
  /** Engine clock for the now overlay and the trail extrusion; defaults to the last segment. */
  nowEtSec?: number;
  /**
   * World-copy longitude offsets the view can see (0, 360, -360), computed
   * by the host from its map bounds. Every feature, points included, paints
   * once per offset; ring-crossing duplication alone misses point features
   * at the antimeridian (AGE-10).
   */
  worldCopies?: readonly number[];
  /** Explicit hue override (AGE-08); the atlas palette otherwise. */
  palette?: Palette;
  /** LOD threshold: below this projected swath width, mechanism falls back to envelope (AGE-09). */
  mechanismMinWidthPx?: number;
  fillAlpha?: number;
  lineWidthPx?: number;
}

interface Resolved {
  palette: Palette;
  nowEtSec: number;
  mechanismMinWidthPx: number;
  fillAlpha: number;
  lineWidthPx: number;
  dash: readonly number[];
  worldCopies: readonly number[];
}

const BASE_COPIES: readonly number[] = [0];

function resolve(geo: GeoStrip, options: PaintOptions): Resolved {
  const last = geo.segments[geo.segments.length - 1]!.etSec;
  return {
    palette: options.palette ?? ATLAS_PALETTE,
    nowEtSec: options.nowEtSec ?? last,
    mechanismMinWidthPx: options.mechanismMinWidthPx ?? 8,
    fillAlpha: options.fillAlpha ?? 0.35,
    lineWidthPx: options.lineWidthPx ?? 1.5,
    dash: dashPatternFor(geo.strip.instrumentId),
    worldCopies: options.worldCopies ?? BASE_COPIES,
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

/** View copies united with whatever the unwrapped ring itself demands. */
function unionOffsets(copies: readonly number[], lons: readonly number[]): readonly number[] {
  const set = new Set(copies);
  for (const offset of worldCopyOffsets(lons)) set.add(offset);
  return [...set];
}

function tracePath(ctx: Canvas2DLike, project: Projector, points: readonly GeoPoint[], close: boolean, copies: readonly number[] = BASE_COPIES): void {
  const lons = ringLons(points);
  for (const offset of unionOffsets(copies, lons)) {
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
  copies: readonly number[] = BASE_COPIES,
): void {
  const points = [a.left, a.right, b.right, b.left];
  const lons = ringLons(points);
  for (const offset of unionOffsets(copies, lons)) {
    cb(points.map((p, i) => project({ lonDeg: lons[i]! + offset, latDeg: p.latDeg })));
  }
}

function fillQuad(ctx: Canvas2DLike, project: Projector, a: GeoSegment, b: GeoSegment, style: string, copies: readonly number[] = BASE_COPIES): void {
  ctx.fillStyle = style;
  tracePath(ctx, project, [a.left, a.right, b.right, b.left], true, copies);
}

function strokeLine(ctx: Canvas2DLike, project: Projector, from: GeoPoint, to: GeoPoint, style: string, width: number, copies: readonly number[] = BASE_COPIES): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  tracePath(ctx, project, [from, to], false, copies);
}

function dot(ctx: Canvas2DLike, project: Projector, p: GeoPoint, radiusPx: number, style: string, copies: readonly number[] = BASE_COPIES): void {
  ctx.fillStyle = style;
  for (const offset of copies) {
    const [x, y] = project({ lonDeg: p.lonDeg + offset, latDeg: p.latDeg });
    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, 2 * Math.PI);
    ctx.fill();
  }
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
function paintSparse(ctx: Canvas2DLike, geo: GeoStrip, project: Projector, r: Resolved, segment: GeoSegment, stateOverride?: GeoSegment['state']): void {
  if (!segment.sub) return;
  const color = stateColor(r.palette, stateOverride ?? segment.state);
  for (const entry of segment.sub) {
    if (entry.kind === 'beads') {
      for (const p of entry.points) dot(ctx, project, toGeo(p), 1.5, withAlpha(color, 0.9), r.worldCopies);
    } else if (entry.kind === 'event') {
      const g = toGeo(entry.center);
      dot(ctx, project, g, 2, withAlpha(color, 0.9), r.worldCopies);
      // Size the ring to the model radius when it carries one (ADR-0010),
      // with a floor so a small event stays legible; the fixed 5 px ring is
      // the fallback when the event declares no radius.
      const ringPx = entry.radiusKm !== undefined
        ? Math.max(entry.radiusKm * localScalePxPerKm(geo, project, g), 3)
        : 5;
      ctx.strokeStyle = withAlpha(color, 0.7);
      ctx.lineWidth = 1;
      for (const offset of r.worldCopies) {
        const [x, y] = project({ lonDeg: g.lonDeg + offset, latDeg: g.latDeg });
        ctx.beginPath();
        ctx.arc(x, y, ringPx, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }
}

/** Mechanism grade: draw the sub-structure detail of one segment (AGE-09). */
function paintMechanism(ctx: Canvas2DLike, geo: GeoStrip, project: Projector, r: Resolved, segment: GeoSegment, stateOverride?: GeoSegment['state']): void {
  paintSparse(ctx, geo, project, r, segment, stateOverride);
  if (!segment.sub) return;
  const color = stateColor(r.palette, stateOverride ?? segment.state);
  ctx.setLineDash(r.dash);
  for (const entry of segment.sub) {
    if (entry.kind === 'footprint') {
      const g = toGeo(entry.center);
      // Floor the scale so a footprint never falls below a legible pixel
      // size; the aspect ratio survives the floor.
      const scale = Math.max(localScalePxPerKm(geo, project, g), 1.6 / entry.semiMajorKm);
      const acquiring = (stateOverride ?? segment.state) === 'acquiring';
      ctx.strokeStyle = withAlpha(color, acquiring ? 1 : 0.85);
      ctx.fillStyle = withAlpha(color, acquiring ? 0.85 : 0.45);
      ctx.lineWidth = 1;
      for (const offset of r.worldCopies) {
        const [x, y] = project({ lonDeg: g.lonDeg + offset, latDeg: g.latDeg });
        ctx.beginPath();
        // rotationRad is counterclockwise from east; canvas y grows down.
        ctx.ellipse(x, y, entry.semiMajorKm * scale, entry.semiMinorKm * scale, -entry.rotationRad, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    } else if (entry.kind === 'frame') {
      ctx.strokeStyle = withAlpha(color, 0.85);
      ctx.fillStyle = withAlpha(color, 0.15);
      ctx.lineWidth = 1;
      const corners = entry.corners.map(toGeo);
      tracePath(ctx, project, corners, true, r.worldCopies);
      tracePath(ctx, project, [...corners, corners[0]!], false, r.worldCopies);
    } else if (entry.kind === 'look') {
      const mid = midpoint(segment.left, segment.right);
      const len = 14;
      ctx.strokeStyle = withAlpha(color, 0.7);
      ctx.lineWidth = 1;
      for (const offset of r.worldCopies) {
        const [x, y] = project({ lonDeg: mid.lonDeg + offset, latDeg: mid.latDeg });
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * Math.cos(-entry.azimuthRad), y + len * Math.sin(-entry.azimuthRad));
        ctx.stroke();
      }
    } else if (entry.kind === 'baseline') {
      const companion = toGeo(entry.companion);
      strokeLine(ctx, project, midpoint(segment.left, segment.right), companion, withAlpha(r.palette.guide, 0.6), 1, r.worldCopies);
      dot(ctx, project, companion, 2, withAlpha(color, 0.9), r.worldCopies);
    }
    // sub-swath dividers are a strip-level pass (paintSubSwathBands), since a
    // divider runs along track across a segment pair; the geo-raster sector
    // repaint is a recorded adapter follow-up (goals/PHASE-1.md ledger).
  }
  ctx.setLineDash([]);
}

function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  const lonB = unwrapLon(a.lonDeg, b.lonDeg);
  return { lonDeg: (a.lonDeg + lonB) / 2, latDeg: (a.latDeg + b.latDeg) / 2 };
}

/** Cross-track point at fraction f from left (0) to right (1), rendering grade. */
function crossLerp(a: GeoPoint, b: GeoPoint, f: number): GeoPoint {
  const lonB = unwrapLon(a.lonDeg, b.lonDeg);
  return { lonDeg: a.lonDeg + f * (lonB - a.lonDeg), latDeg: a.latDeg + f * (b.latDeg - a.latDeg) };
}

/** Distinct sub-swaths present in one segment; two or more means a divided swath. */
function subSwathBands(sub: readonly SubStructure[] | undefined): number {
  if (!sub) return 0;
  const indexes = new Set<number>();
  for (const entry of sub) if (entry.kind === 'sub-swath') indexes.add(entry.index);
  return indexes.size;
}

/**
 * Along-track dividers partitioning a wide swath into its sub-swaths, the
 * receive-beam quilt of SweepSAR and the sub-swath banding of ScanSAR
 * (AGE-09). A single sub-swath per segment is a burst, not a divided swath:
 * its quad already breaks at the burst boundary through the connection rule,
 * so only segments carrying two or more sub-swaths draw dividers here.
 */
function paintSubSwathBands(
  ctx: Canvas2DLike, geo: GeoStrip, project: Projector, r: Resolved,
  fromEtSec: number, toEtSec: number, stateOverride?: GeoSegment['state'],
): void {
  // Own the dash so a solid divider does not inherit the mechanism hatch
  // pattern from whatever ran before it.
  ctx.setLineDash([]);
  for (let i = 0; i + 1 < geo.segments.length; i++) {
    if (!geo.connect[i]) continue;
    const a = geo.segments[i]!;
    const b = geo.segments[i + 1]!;
    // Window on the later segment, matching the quad-fill convention, so the
    // trail draws only the dividers of the coverage it has swept.
    if (b.etSec <= fromEtSec || b.etSec > toEtSec) continue;
    const bands = subSwathBands(a.sub);
    if (bands < 2) continue;
    // Later-segment state, the quad the dividers subdivide (quadState).
    const color = stateColor(r.palette, stateOverride ?? b.state);
    for (let j = 1; j < bands; j++) {
      const f = j / bands;
      strokeLine(ctx, project, crossLerp(a.left, a.right, f), crossLerp(b.left, b.right, f), withAlpha(color, 0.45), 1, r.worldCopies);
    }
  }
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
    const state = quadState(later);
    // The now pops: the acquiring band paints near opaque in every mode.
    const fillAlphaHere = state === 'acquiring' ? Math.max(r.fillAlpha * alpha, 0.9) : r.fillAlpha * alpha;
    fillQuad(ctx, project, geo.segments[i]!, later, withAlpha(stateColor(r.palette, state), fillAlphaHere), r.worldCopies);
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
    strokeLine(
      ctx, project, s.left, s.right,
      withAlpha(stateColor(r.palette, s.state), s.state === 'acquiring' ? 1 : 0.9),
      s.state === 'acquiring' ? widthPx + 1 : widthPx,
      r.worldCopies,
    );
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
    strokeLine(ctx, project, a.left, b.left, style, 1, r.worldCopies);
    strokeLine(ctx, project, a.right, b.right, style, 1, r.worldCopies);
  }
  if (geo.segments.every((s) => s.widthKm <= 0)) {
    for (let i = 0; i + 1 < geo.segments.length; i++) {
      strokeLine(ctx, project, geo.segments[i]!.left, geo.segments[i + 1]!.left, style, 1, r.worldCopies);
    }
  }
  ctx.setLineDash([]);
}

/**
 * The now marker's visual position for a clock: the segment index the marker
 * sits on, or -1 when no marker paints (a clock before the strip, or an
 * acquisition over by more than 1.5 median steps, the paintNowLine expiry).
 * Two clocks with equal indexes paint identical markers, which is what lets
 * a host skip static repaints between segment boundaries (AGE-16).
 */
export function nowMarkerIndex(geo: GeoStrip, nowEtSec: number): number {
  let index = -1;
  for (let i = 0; i < geo.segments.length; i++) {
    if (geo.segments[i]!.etSec <= nowEtSec + 1e-9) index = i;
    else break;
  }
  if (index < 0) return -1;
  if (nowEtSec - geo.segments[index]!.etSec > geo.medianStepSec * 1.5 + 1e-9) return -1;
  return index;
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
    ctx.save();
    ctx.shadowColor = r.palette.acquiring;
    ctx.shadowBlur = 8;
    strokeLine(ctx, project, current.left, current.right, r.palette.acquiring, 4, r.worldCopies);
    ctx.restore();
  }
  // Glowing beam-center marker, the atlas platform dot.
  const at = current.widthKm > 0 ? midpoint(current.left, current.right) : current.left;
  ctx.save();
  ctx.shadowColor = r.palette.acquiring;
  ctx.shadowBlur = 10;
  dot(ctx, project, at, 4, r.palette.acquiring, r.worldCopies);
  ctx.restore();
}

/**
 * Trail increment: coverage between two clock readings. The mechanism rides
 * the trail, the atlas behavior: footprints, beads, and frames appear as
 * the clock sweeps them and then decay with the trail. Everything entering
 * the trail is by definition being acquired at that moment, so it paints in
 * the committed hue regardless of the segment state field, which may be a
 * tick behind the clock that drives the extrusion (trails never repaint, so
 * a stale planned hue would bake in permanently).
 */
export function paintTrailWindow(
  ctx: Canvas2DLike, geo: GeoStrip, project: Projector, options: PaintOptions,
  fromEtSec: number, toEtSec: number,
): number {
  const r = resolve(geo, options);
  const style = withAlpha(stateColor(r.palette, 'committed'), r.fillAlpha * 0.85);
  let painted = 0;
  for (let i = 0; i + 1 < geo.segments.length; i++) {
    if (!geo.connect[i]) continue;
    const later = geo.segments[i + 1]!;
    if (later.etSec <= fromEtSec || later.etSec > toEtSec) continue;
    fillQuad(ctx, project, geo.segments[i]!, later, style, r.worldCopies);
    painted++;
  }
  for (const s of geo.segments) {
    if (s.etSec > fromEtSec && s.etSec <= toEtSec) {
      paintMechanism(ctx, geo, project, r, s, 'committed');
    }
  }
  // The sub-swath quilt rides the trail like the rest of the mechanism.
  paintSubSwathBands(ctx, geo, project, r, fromEtSec, toEtSec, 'committed');
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
      const state = quadState(b);
      const style = withAlpha(stateColor(r.palette, state), state === 'acquiring' ? 1 : 0.9);
      const width = state === 'acquiring' ? r.lineWidthPx + 1 : r.lineWidthPx;
      strokeLine(ctx, project, a.left, b.left, style, width, r.worldCopies);
      strokeLine(ctx, project, a.right, b.right, style, width, r.worldCopies);
    }
    paintLoneSegments(ctx, geo, project, r, r.lineWidthPx);
    for (const s of geo.segments) paintSparse(ctx, geo, project, r, s);
    return;
  }

  if (treatment === 'flat-fill') {
    paintQuads(ctx, geo, project, r, () => 1, -Infinity, Infinity);
    paintLoneSegments(ctx, geo, project, r, 3);
    for (const s of geo.segments) paintSparse(ctx, geo, project, r, s);
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
      const alpha = quadState(later) === 'acquiring'
        ? 0.95
        : Math.min(1, r.fillAlpha * 1.6 * scale(later));
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
      }, r.worldCopies);
    }
    paintLoneSegments(ctx, geo, project, r, 3);
    for (const s of geo.segments) paintSparse(ctx, geo, project, r, s);
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
      fillQuad(ctx, project, geo.segments[i]!, later, `hsla(${196 + 92 * frac},65%,60%,${r.fillAlpha})`, r.worldCopies);
    }
    paintLoneSegments(ctx, geo, project, r, 3);
    for (const s of geo.segments) paintSparse(ctx, geo, project, r, s);
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
    for (const s of geo.segments) paintSparse(ctx, geo, project, r, s);
    return;
  }
  // The atlas mechanism texture: a faint backdrop with cross-track hatching
  // in the instrument's dash pattern, plus whatever sub-structure detail the
  // strip carries on top.
  paintQuads(ctx, geo, project, r, () => 0.4, -Infinity, Infinity);
  ctx.setLineDash(r.dash);
  for (const s of geo.segments) {
    if (s.widthKm <= 0) continue;
    const acquiring = s.state === 'acquiring';
    strokeLine(
      ctx, project, s.left, s.right,
      withAlpha(stateColor(r.palette, s.state), acquiring ? 0.95 : 0.4),
      acquiring ? 2 : 1,
      r.worldCopies,
    );
  }
  paintLoneSegments(ctx, geo, project, r, 3);
  paintSubSwathBands(ctx, geo, project, r, -Infinity, Infinity);
  for (const s of geo.segments) paintMechanism(ctx, geo, project, r, s);
  ctx.setLineDash([]);
}
