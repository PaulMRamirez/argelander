/**
 * Strip geometry for the Leaflet adapter (AGE-10): body-fixed Cartesian
 * kilometers to geographic coordinates, the segment connection rule that
 * keeps adapters from interpolating across time gaps (SPEC-STRIP section 2),
 * and per-quad antimeridian unwrapping with world-copy offsets. Everything
 * here is pure and projector-free so it tests headless; the body radius
 * comes from the position vectors themselves, so the adapter consumes strips
 * and nothing else.
 */
import type {
  AcquisitionState, QualityRange, Strip, SubStructure, Vec3,
} from 'argelander-core';

const RAD2DEG = 180 / Math.PI;

export interface GeoPoint {
  lonDeg: number;
  latDeg: number;
}

/** Rendering-grade spherical conversion; latitude from the unit vector. */
export function toGeo(v: Vec3): GeoPoint {
  const r = Math.hypot(v[0], v[1], v[2]);
  return {
    lonDeg: Math.atan2(v[1], v[0]) * RAD2DEG,
    latDeg: Math.asin(v[2] / r) * RAD2DEG,
  };
}

/** Body radius recovered from the strip's own edge vectors. */
export function bodyRadiusKm(strip: Strip): number {
  const p = strip.segments[0]!.left;
  return Math.hypot(p[0], p[1], p[2]);
}

export interface GeoSegment {
  etSec: number;
  state: AcquisitionState;
  left: GeoPoint;
  right: GeoPoint;
  /** Cross-track chord, kilometers; zero for bead and event geometries. */
  widthKm: number;
  sub?: readonly SubStructure[];
  quality?: QualityRange;
}

export interface GeoStrip {
  strip: Strip;
  radiusKm: number;
  segments: readonly GeoSegment[];
  medianStepSec: number;
  /** connect[i] true when segments i and i+1 ribbon into one quad. */
  connect: readonly boolean[];
}

export interface StripToGeoOptions {
  /** Segment spacing beyond gapFactor times the median is a gap; default 1.5. */
  gapFactor?: number;
}

/**
 * Signature of the sub-structure that must match for two segments to ribbon:
 * sub-swath membership and frame identity. Bursts, framelet exposures, and
 * dwell patches must not blend; beads, footprints, looks, and baselines ride
 * along without blocking the ribbon.
 */
function connectionSignature(sub: readonly SubStructure[] | undefined): string {
  if (!sub) return '';
  const swaths: number[] = [];
  const bursts: string[] = [];
  const frames: string[] = [];
  for (const entry of sub) {
    if (entry.kind === 'sub-swath') {
      swaths.push(entry.index);
      // The burst id, not the sub-swath index, is what must not blend: a
      // ScanSAR/TOPS strip with a single sub-swath hops bursts on one index,
      // so keying only on the index would ribbon its bursts into one quad.
      if (entry.burstId) bursts.push(entry.burstId);
    } else if (entry.kind === 'frame') {
      frames.push(entry.frameId ?? '(frame)');
    }
  }
  if (!swaths.length && !frames.length) return '';
  return `ss:${swaths.sort((a, b) => a - b).join(',')}|br:${bursts.sort().join(',')}|fr:${frames.sort().join(',')}`;
}

export function stripToGeo(strip: Strip, options: StripToGeoOptions = {}): GeoStrip {
  const gapFactor = options.gapFactor ?? 1.5;
  const segments: GeoSegment[] = strip.segments.map((s) => ({
    etSec: s.etSec,
    state: s.state,
    left: toGeo(s.left),
    right: toGeo(s.right),
    widthKm: Math.hypot(
      s.left[0] - s.right[0], s.left[1] - s.right[1], s.left[2] - s.right[2],
    ),
    ...(s.sub !== undefined ? { sub: s.sub } : {}),
    ...(s.quality !== undefined ? { quality: s.quality } : {}),
  }));

  const steps: number[] = [];
  for (let i = 1; i < strip.segments.length; i++) {
    steps.push(strip.segments[i]!.etSec - strip.segments[i - 1]!.etSec);
  }
  const sorted = [...steps].sort((a, b) => a - b);
  const medianStepSec = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;

  const connect: boolean[] = [];
  for (let i = 0; i + 1 < strip.segments.length; i++) {
    const a = strip.segments[i]!;
    const b = strip.segments[i + 1]!;
    const dt = b.etSec - a.etSec;
    connect.push(
      segments[i]!.widthKm > 0
      && segments[i + 1]!.widthKm > 0
      && dt <= gapFactor * medianStepSec + 1e-9
      && connectionSignature(a.sub) === connectionSignature(b.sub),
    );
  }

  return { strip, radiusKm: bodyRadiusKm(strip), segments, medianStepSec, connect };
}

/** Longitude congruent to lonDeg, within 180 degrees of refLonDeg. */
export function unwrapLon(refLonDeg: number, lonDeg: number): number {
  let lon = lonDeg;
  while (lon - refLonDeg > 180) lon -= 360;
  while (lon - refLonDeg < -180) lon += 360;
  return lon;
}

/**
 * World-copy longitude offsets for a small unwrapped ring: always the
 * identity copy, plus a shifted copy when the ring strays across the
 * antimeridian so both world edges paint it (AGE-10).
 */
export function worldCopyOffsets(lonsDeg: readonly number[]): readonly number[] {
  const offsets = [0];
  let min = Infinity;
  let max = -Infinity;
  for (const lon of lonsDeg) {
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  if (max > 180) offsets.push(-360);
  if (min < -180) offsets.push(360);
  return offsets;
}

/** Kilometers of one degree of latitude on this body (spherical). */
export function kmPerDegLat(radiusKm: number): number {
  return (radiusKm * Math.PI) / 180;
}
