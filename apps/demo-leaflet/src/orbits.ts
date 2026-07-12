/**
 * Demonstration state tables for the off-Earth worlds: a circular orbit
 * sampled analytically in the body-fixed frame and served through
 * PresampledProvider, the planetary seam (SPEC-PROVIDER section 2). These
 * are demonstration states, not ephemeris: a real host receives its tables
 * from a SPICE-backed service (Bessel) or files, and nothing downstream of
 * the provider can tell the difference, which is the point being proven.
 * The engine itself never propagates; this sampler is demo data generation,
 * the planetary sibling of the TLE list.
 */
import type { PresampledStateTable } from 'argelander-providers';

export interface DemoOrbit {
  body: string;
  frame: string;
  /** Target name the table serves, e.g. MRO. */
  target: string;
  bodyRadiusKm: number;
  altitudeKm: number;
  inclinationDeg: number;
  /** Body sidereal rotation period, seconds; ground tracks drift westward by it. */
  bodyRotationSec: number;
  /** Gravitational parameter, km^3/s^2, for the circular orbit rate. */
  muKm3S2: number;
  raanDeg: number;
}

/**
 * Sample the orbit into a table: position on an inclined circle in the
 * inertial frame, rotated into the body-fixed frame by the body spin;
 * velocity by central finite difference so it is exactly consistent with
 * the sampled positions (what the provider's Hermite interpolation wants).
 */
export function sampleOrbit(orbit: DemoOrbit, startEt: number, durationSec: number, stepSec: number): PresampledStateTable {
  const n = Math.floor(durationSec / stepSec) + 1;
  const a = orbit.bodyRadiusKm + orbit.altitudeKm;
  const orbitRate = Math.sqrt(orbit.muKm3S2 / (a * a * a));
  const spinRate = (2 * Math.PI) / orbit.bodyRotationSec;
  const inc = (orbit.inclinationDeg * Math.PI) / 180;
  const raan = (orbit.raanDeg * Math.PI) / 180;

  const positionAt = (tSec: number): [number, number, number] => {
    const u = orbitRate * tSec;
    // Perifocal circle to inertial by inclination and RAAN.
    const xi = Math.cos(u);
    const eta = Math.sin(u);
    const xI = xi * Math.cos(raan) - eta * Math.cos(inc) * Math.sin(raan);
    const yI = xi * Math.sin(raan) + eta * Math.cos(inc) * Math.cos(raan);
    const zI = eta * Math.sin(inc);
    // Inertial to body-fixed: rotate by the accumulated spin about z.
    const w = spinRate * tSec;
    const c = Math.cos(w);
    const s = Math.sin(w);
    return [a * (xI * c + yI * s), a * (yI * c - xI * s), a * zI];
  };

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
    body: orbit.target,
    observer: orbit.body,
    frame: orbit.frame,
    correction: 'NONE',
    epochs,
    states,
  };
}

/** LRO-like: 50 km circular polar mapping orbit. */
export const LRO_ORBIT: DemoOrbit = {
  body: 'MOON',
  frame: 'MOON_ME',
  target: 'LRO',
  bodyRadiusKm: 1737.4,
  altitudeKm: 50,
  inclinationDeg: 89.7,
  bodyRotationSec: 27.321661 * 86400,
  muKm3S2: 4902.8,
  raanDeg: 35,
};

/** MRO-like: near-circular sun-synchronous mapping orbit. */
export const MRO_ORBIT: DemoOrbit = {
  body: 'MARS',
  frame: 'IAU_MARS',
  target: 'MRO',
  bodyRadiusKm: 3389.5,
  altitudeKm: 290,
  inclinationDeg: 92.6,
  bodyRotationSec: 1.02595676 * 86400,
  muKm3S2: 42828.37,
  raanDeg: 210,
};
