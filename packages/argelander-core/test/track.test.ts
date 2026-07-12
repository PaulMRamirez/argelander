import { describe, expect, it } from 'vitest';
import { trackStrip, validateStrip } from '../src/index.js';
import type { StateBatch } from '../src/index.js';

const R_BODY = 6371;
const R_ORBIT = 7000;
const OMEGA = 1.1e-3;

/** Circular equatorial orbit batch: track along the equator, +z orbit normal. */
function equatorialBatch(n: number, stepSec: number): StateBatch {
  const epochs = new Float64Array(n);
  const states = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    const t = i * stepSec;
    const a = OMEGA * t;
    epochs[i] = t;
    states[i * 6] = R_ORBIT * Math.cos(a);
    states[i * 6 + 1] = R_ORBIT * Math.sin(a);
    states[i * 6 + 2] = 0;
    states[i * 6 + 3] = -R_ORBIT * OMEGA * Math.sin(a);
    states[i * 6 + 4] = R_ORBIT * OMEGA * Math.cos(a);
    states[i * 6 + 5] = 0;
  }
  return {
    targets: ['DEMO'],
    observer: 'EARTH',
    frame: 'ITRF93',
    correction: 'NONE',
    epochs,
    states,
    lightTimes: new Float64Array(n),
  };
}

const BASE = {
  id: 'track-test',
  body: 'EARTH',
  bodyRadiusKm: R_BODY,
  instrumentId: 'demo-swath',
  authority: 'sgp4',
  generatedBy: 'trackStrip',
} as const;

describe('trackStrip: the provider-to-strip bridge (AGE-04)', () => {
  it('places edges at great-circle offsets on the body surface', () => {
    const strip = trackStrip(equatorialBatch(5, 10), 0, { ...BASE, swathHalfWidthKm: 100 });
    expect(validateStrip(strip).errors).toEqual([]);
    expect(strip.frame).toBe('ITRF93');
    expect(strip.provenance.correction).toBe('NONE');
    const theta = 100 / R_BODY;
    for (const s of strip.segments) {
      expect(Math.hypot(...s.left)).toBeCloseTo(R_BODY, 9);
      expect(Math.hypot(...s.right)).toBeCloseTo(R_BODY, 9);
      // The orbit normal is +z, so right sits north and left south.
      expect(s.right[2]).toBeCloseTo(R_BODY * Math.sin(theta), 9);
      expect(s.left[2]).toBeCloseTo(-R_BODY * Math.sin(theta), 9);
      const width = Math.hypot(s.left[0] - s.right[0], s.left[1] - s.right[1], s.left[2] - s.right[2]);
      expect(width).toBeCloseTo(2 * R_BODY * Math.sin(theta), 6);
    }
    // Nadir advances along the equator with the orbit.
    const lon1 = Math.atan2(strip.segments[1]!.left[1], strip.segments[1]!.left[0]);
    expect(lon1).toBeCloseTo(OMEGA * 10, 9);
  });

  it('emits zero-width bead rows for sparse instruments (AGE-09)', () => {
    const strip = trackStrip(equatorialBatch(4, 10), 0, { ...BASE, beadOffsetsKm: [-3.3, 0, 3.3] });
    expect(validateStrip(strip).errors).toEqual([]);
    for (const s of strip.segments) {
      expect(s.left).toEqual(s.right);
      const beads = s.sub![0]!;
      if (beads.kind !== 'beads') throw new Error('beads expected');
      expect(beads.points).toHaveLength(3);
      expect(beads.points[1]).toEqual(s.left);
      expect(Math.hypot(...beads.points[0]!)).toBeCloseTo(R_BODY, 9);
    }
  });

  it('applies the state rule around the engine clock', () => {
    const strip = trackStrip(equatorialBatch(5, 10), 0, { ...BASE, swathHalfWidthKm: 50, nowEtSec: 20 });
    expect(strip.segments.map((s) => s.state)).toEqual([
      'committed', 'committed', 'acquiring', 'planned', 'planned',
    ]);
    const later = trackStrip(equatorialBatch(5, 10), 0, { ...BASE, swathHalfWidthKm: 50 });
    expect(later.segments[4]!.state).toBe('acquiring');
  });

  it('refuses degenerate input', () => {
    const batch = equatorialBatch(2, 10);
    batch.states.fill(0, 3, 6);
    expect(() => trackStrip(batch, 0, { ...BASE, swathHalfWidthKm: 50 })).toThrow(/parallel|degenerate/);
    expect(() => trackStrip(equatorialBatch(1, 10), 0, { ...BASE, bodyRadiusKm: 0 })).toThrow(/positive/);
  });
});
