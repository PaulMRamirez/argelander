/**
 * Formal polar-CRS testing (PHASE-1 exit item): strips over the poles,
 * painted through a plate-carree projector, the projection planetary hosts
 * run (EPSG:4326, the NASA Trek tiling). The engine promise is rendering
 * grade, not pole-perfect quads: every coordinate finite, footprints
 * bounded, the scale probe sane at 89.9 degrees on both hemispheres.
 */
import { describe, expect, it } from 'vitest';
import { trackStrip } from 'argelander-core';
import type { StateBatch } from 'argelander-core';
import { stripToGeo } from '../src/geo.js';
import { paintStrip } from '../src/paint.js';
import type { Treatment } from '../src/paint.js';
import { FakeCtx, makeProjector, syntheticStrip } from './fake-ctx.js';

const MOON_RADIUS_KM = 1737.4;

/**
 * A polar pass built as real states: a circular 90-degree-inclination orbit
 * 50 km over the Moon, sampled through the pole crossing. Positions ride a
 * meridian plane; velocities point along it, so trackStrip's orbit normal
 * (r cross v) is the genuine cross-track direction through the pole.
 * pole +1 crosses the north pole mid-window, -1 the south.
 */
function polarBatch(pole: 1 | -1): StateBatch {
  const orbitKm = MOON_RADIUS_KM + 50;
  const periodSec = 6786;
  const n = 41;
  const epochs = new Float64Array(n);
  const states = new Float64Array(n * 6);
  const omega = (2 * Math.PI) / periodSec;
  for (let i = 0; i < n; i++) {
    const t = i * 10;
    const phase = omega * t + pole * Math.PI / 2 - omega * ((n - 1) * 10) / 2;
    epochs[i] = t;
    states[i * 6 + 0] = orbitKm * Math.cos(phase);
    states[i * 6 + 1] = 0;
    states[i * 6 + 2] = orbitKm * Math.sin(phase);
    states[i * 6 + 3] = -orbitKm * omega * Math.sin(phase);
    states[i * 6 + 4] = 0;
    states[i * 6 + 5] = orbitKm * omega * Math.cos(phase);
  }
  return {
    targets: ['LRO'],
    observer: 'MOON',
    frame: 'MOON_ME',
    correction: 'NONE',
    epochs,
    states,
    lightTimes: new Float64Array(n),
  };
}

/** Great-circle separation between two geographic points, degrees. */
function angularSepDeg(a: { latDeg: number; lonDeg: number }, b: { latDeg: number; lonDeg: number }): number {
  const toRad = Math.PI / 180;
  const la = a.latDeg * toRad;
  const lb = b.latDeg * toRad;
  const dLon = (b.lonDeg - a.lonDeg) * toRad;
  const cosSep = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(dLon);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) / toRad;
}

function polarStripOptions(extra: object): Parameters<typeof trackStrip>[2] {
  return {
    id: 'polar-pass',
    body: 'MOON',
    bodyRadiusKm: MOON_RADIUS_KM,
    instrumentId: 'LRO/test',
    authority: 'test',
    generatedBy: 'polar.test',
    ...extra,
  };
}

const PLATE_CARREE = makeProjector(4);

function allCoords(ctx: FakeCtx): ReadonlyArray<readonly [number, number]> {
  return ctx.ops.flatMap((op) => op.path);
}

describe.each([
  { name: 'north', pole: 1 as const },
  { name: 'south', pole: -1 as const },
])('a pass through the $name pole, plate-carree projector (EPSG:4326 hosts)', ({ pole }) => {
  const geo = stripToGeo(trackStrip(polarBatch(pole), 0, polarStripOptions({ swathHalfWidthKm: 30 })));

  it('the pass genuinely crosses the pole', () => {
    const extremeLat = Math.max(...geo.segments.map((s) => pole * (s.left.latDeg + s.right.latDeg) / 2));
    expect(extremeLat).toBeGreaterThan(88);
  });

  it('every treatment paints finite coordinates over the pole', () => {
    for (const treatment of ['outline', 'flat-fill', 'mechanism', 'quality-gradient', 'time-gradient'] as Treatment[]) {
      const ctx = new FakeCtx();
      paintStrip(ctx, geo, PLATE_CARREE, { treatment });
      expect(ctx.ops.length, treatment).toBeGreaterThan(0);
      for (const [x, y] of allCoords(ctx)) {
        expect(Number.isFinite(x), treatment).toBe(true);
        expect(Number.isFinite(y), treatment).toBe(true);
      }
    }
  });

  it('swath edges hold their great-circle width through the pole crossing', () => {
    // 30 km half-width on the Moon subtends 0.989 degrees per side, 1.978
    // between the edges, invariant along the pass. A degenerated offset at
    // the pole (inflated, collapsed, or folded to one side) breaks the
    // separation; latitude differences alone cannot see it, because this
    // meridian-plane pass keeps the two edges at identical latitudes.
    const expected = (2 * 30) / MOON_RADIUS_KM * (180 / Math.PI);
    for (const s of geo.segments) {
      expect(angularSepDeg(s.left, s.right)).toBeGreaterThan(expected * 0.95);
      expect(angularSepDeg(s.left, s.right)).toBeLessThan(expected * 1.05);
    }
  });
});

describe('polar sub-structure through a plate-carree projector', () => {
  it('scan footprints stay bounded through the pole (the scale probe clamps)', () => {
    const scanned = stripToGeo(trackStrip(polarBatch(1), 0, polarStripOptions({
      swathHalfWidthKm: 30,
      scan: { scanRateHz: 0.1, subStepSec: 2.5, footprintSemiMajorKm: 8, footprintSemiMinorKm: 5, footprintGrowthFactor: 0.5 },
    })));
    const ctx = new FakeCtx();
    paintStrip(ctx, scanned, PLATE_CARREE, { treatment: 'mechanism', mechanismMinWidthPx: 1 });
    const ellipses = ctx.ellipses();
    expect(ellipses.length).toBeGreaterThan(0);
    // 8 km semi-major on the Moon is 0.26 degrees, about one px at this
    // zoom; allow the floor and rounding but never a blown-up footprint.
    for (const e of ellipses) {
      const r = Math.hypot(e.path[1]![0] - e.path[0]![0], e.path[1]![1] - e.path[0]![1]);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeLessThan(12);
    }
  });

  it('bead chains ride the meridian through the pole without ribboning', () => {
    const beads = stripToGeo(trackStrip(polarBatch(1), 0, polarStripOptions({ beadOffsetsKm: [-1, 0, 1] })));
    const ctx = new FakeCtx();
    paintStrip(ctx, beads, PLATE_CARREE, { treatment: 'flat-fill' });
    expect(ctx.fills().filter((f) => f.shape === 'path')).toHaveLength(0);
    expect(ctx.dots().length).toBeGreaterThan(0);
    for (const [x, y] of allCoords(ctx)) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

describe('synthetic strips pinned at extreme latitudes', () => {
  it('paints at 89.9 degrees north and south without NaN or runaway quads', () => {
    for (const sign of [1, -1]) {
      const strip = syntheticStrip([
        [sign * 89.0, 10, 1, 0], [sign * 89.5, 10, 1, 10], [sign * 89.9, 10, 1, 20],
      ]);
      const ctx = new FakeCtx();
      paintStrip(ctx, stripToGeo(strip), PLATE_CARREE, { treatment: 'flat-fill' });
      expect(ctx.fills().length).toBeGreaterThan(0);
      for (const [x, y] of allCoords(ctx)) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });
});
