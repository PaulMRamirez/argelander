/**
 * Demonstration state tables for airborne platforms (PHASE-4): a flight line
 * on the rotating body sampled into body-fixed position and velocity and
 * served through PresampledProvider, the same seam the planetary orbits use.
 * The point is that the engine renders a non-satellite platform through the
 * identical trackStrip pipeline: a flight line is body-fixed already (its
 * waypoints are geographic), so unlike sampleOrbit there is no inertial to
 * body-fixed rotation, just a great-circle walk at altitude. These are
 * demonstration states, not a flight plan; a real host receives its
 * trajectory from a planning tool through a provider, and nothing downstream
 * can tell the difference. The engine never propagates.
 *
 * Altitude does not change the rendering-grade ground track: trackStrip takes
 * the nadir direction (position normalized) and lays the footprint on the body
 * surface, so the subaircraft point is the same at any altitude. altitudeKm is
 * carried because it is true of the platform and a future field-of-view to
 * swath calculation would want it, not because it moves the footprint here.
 */
import type { PresampledStateTable } from 'argelander-providers';
import type { DemoInstrument } from './tles.js';
import { ER2_TRACK_GEOJSON } from './er2-track.js';

const DEG = Math.PI / 180;

export interface DemoFlightLine {
  body: string;
  frame: string;
  /** Target name the table serves, e.g. ER2. */
  target: string;
  bodyRadiusKm: number;
  /** Platform altitude above the surface; does not move the ground footprint. */
  altitudeKm: number;
  /** Ground-track speed of the subaircraft point, km/s. */
  groundspeedKmS: number;
  /** Waypoints as [latDeg, lonDeg]; the platform flies the great-circle legs between them. */
  waypoints: ReadonlyArray<readonly [number, number]>;
}

export interface AirbornePlatform {
  name: string;
  line: DemoFlightLine;
  instruments: readonly DemoInstrument[];
  /** Trajectory as Enhanced GeoJSON, loaded through geoJsonStateProvider; the
   * line sampler is the fallback when absent or when the GeoJSON fails. */
  trackGeoJson?: object;
}

type Vec3 = [number, number, number];

/** Geographic to a unit vector on the sphere (body-fixed direction). */
function toUnit(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Great-circle interpolation between two unit vectors, returning a unit vector. */
function slerp(a: Vec3, b: Vec3, f: number, omega: number): Vec3 {
  if (omega < 1e-9) return a;
  const s0 = Math.sin((1 - f) * omega) / Math.sin(omega);
  const s1 = Math.sin(f * omega) / Math.sin(omega);
  return [s0 * a[0] + s1 * b[0], s0 * a[1] + s1 * b[1], s0 * a[2] + s1 * b[2]];
}

/**
 * Sample the flight line into a table: the subaircraft point walks the
 * great-circle path at the ground-track angular rate (groundspeed over body
 * radius), the position sits at that direction scaled to body radius plus
 * altitude, and velocity is a central finite difference so it is exactly
 * consistent with the positions. A platform that runs out of path parks at the
 * last waypoint, where the along-track velocity vanishes; since it was moving
 * beforehand, trackStrip carries the last valid cross-track direction forward
 * and renders an ordinary held-orientation segment there (ADR-0012's mid-track
 * hover), not a stare. The stare is reserved for a line that begins degenerate,
 * which here would take a zero groundspeed or a zero-length path.
 */
export function sampleFlightLine(line: DemoFlightLine, startEt: number, durationSec: number, stepSec: number): PresampledStateTable {
  if (line.waypoints.length < 2) {
    throw new RangeError(`flight line ${line.target} needs at least two waypoints, got ${line.waypoints.length}`);
  }
  const r = line.bodyRadiusKm + line.altitudeKm;
  const pts = line.waypoints.map(([lat, lon]) => toUnit(lat, lon));
  const legs: Array<{ a: Vec3; b: Vec3; omega: number; start: number }> = [];
  let total = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const omega = Math.acos(dot);
    // The great circle through antipodal points is not unique, so slerp's
    // 1/sin(omega) blows up; refuse it with a clear message rather than emit a
    // numerically garbage table that would slide past trackStrip's guards.
    if (Math.PI - omega < 1e-6) {
      throw new RangeError(`flight line ${line.target} has antipodal waypoints at leg ${k}: the great-circle path is undefined`);
    }
    legs.push({ a, b, omega, start: total });
    total += omega;
  }
  const angRate = line.groundspeedKmS / line.bodyRadiusKm;

  const positionAt = (tSec: number): Vec3 => {
    const ang = Math.min(angRate * tSec, total);
    let leg = legs[legs.length - 1]!;
    for (const candidate of legs) {
      if (ang <= candidate.start + candidate.omega) {
        leg = candidate;
        break;
      }
    }
    const f = leg.omega > 0 ? (ang - leg.start) / leg.omega : 0;
    const dir = slerp(leg.a, leg.b, f, leg.omega);
    return [r * dir[0], r * dir[1], r * dir[2]];
  };

  const n = Math.floor(durationSec / stepSec) + 1;
  const epochs = new Float64Array(n);
  const states = new Float64Array(n * 6);
  const dt = 0.5;
  for (let i = 0; i < n; i++) {
    const t = i * stepSec;
    epochs[i] = startEt + t;
    const [x, y, z] = positionAt(t);
    const [xa, ya, za] = positionAt(t - dt);
    const [xb, yb, zb] = positionAt(t + dt);
    states[i * 6 + 0] = x;
    states[i * 6 + 1] = y;
    states[i * 6 + 2] = z;
    states[i * 6 + 3] = (xb - xa) / (2 * dt);
    states[i * 6 + 4] = (yb - ya) / (2 * dt);
    states[i * 6 + 5] = (zb - za) / (2 * dt);
  }
  return {
    body: line.target,
    observer: line.body,
    frame: line.frame,
    correction: 'NONE',
    epochs,
    states,
  };
}

/**
 * ER-2-like transect: a high-altitude science aircraft crossing the western
 * United States at roughly 200 m/s, carrying a pushbroom imaging spectrometer.
 * The line is long enough that the platform is still moving at the end of the
 * demo window, so it flies rather than parks.
 */
const ER2_LINE: DemoFlightLine = {
  body: 'EARTH',
  frame: 'ITRF93',
  target: 'ER2',
  bodyRadiusKm: 6371,
  altitudeKm: 20,
  groundspeedKmS: 0.2,
  waypoints: [
    [34.2, -118.1],
    [39.5, -111.5],
    [45.7, -104.5],
  ],
};

export const AIRBORNE_PLATFORMS: readonly AirbornePlatform[] = [
  {
    name: 'ER-2',
    line: ER2_LINE,
    trackGeoJson: ER2_TRACK_GEOJSON,
    instruments: [
      {
        id: 'aviris',
        label: 'AVIRIS-3: pushbroom imaging spectrometer, ~12 km swath',
        swathHalfWidthKm: 6,
        startOn: true,
      },
    ],
  },
];
