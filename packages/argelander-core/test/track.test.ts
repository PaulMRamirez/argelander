import { describe, expect, it } from 'vitest';
import { trackStrip, validateStrip, withStateRule } from '../src/index.js';
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

  it('sweeps scan footprints across the swath between segment epochs (AGE-09 hybrid)', () => {
    const scan = {
      scanRateHz: 0.05,
      subStepSec: 5,
      footprintSemiMajorKm: 12,
      footprintSemiMinorKm: 8,
      footprintGrowthFactor: 0.8,
    };
    const strip = trackStrip(equatorialBatch(3, 15), 0, { ...BASE, swathHalfWidthKm: 80, scan });
    expect(validateStrip(strip).errors).toEqual([]);
    const footprints = strip.segments.flatMap((s) =>
      (s.sub ?? []).filter((e) => e.kind === 'footprint'));
    // Two bracketed segments carry three sub-samples each; the last carries one.
    expect(strip.segments.map((s) => s.sub!.length)).toEqual([3, 3, 1]);
    for (const f of footprints) {
      if (f.kind !== 'footprint') throw new Error('footprint expected');
      expect(Math.hypot(...f.center)).toBeCloseTo(R_BODY, 9);
      expect(f.semiMajorKm).toBeGreaterThanOrEqual(scan.footprintSemiMajorKm - 1e-9);
      expect(f.semiMajorKm).toBeLessThanOrEqual(scan.footprintSemiMajorKm * (1 + scan.footprintGrowthFactor) + 1e-9);
      expect(f.semiMinorKm / f.semiMajorKm).toBeCloseTo(8 / 12, 9);
      // Equatorial orbit: cross-track is due north, a quarter turn from east.
      expect(f.rotationRad).toBeCloseTo(Math.PI / 2, 9);
    }
    const majors = footprints.map((f) => (f.kind === 'footprint' ? f.semiMajorKm : 0));
    expect(Math.max(...majors)).toBeGreaterThan(Math.min(...majors));
    // Scan segments record the swept footprint size range in meters, so the
    // quality-gradient treatment has real variation to paint.
    for (const s of strip.segments) {
      const [lo, hi] = s.quality!.resolutionM!;
      expect(lo).toBeGreaterThanOrEqual(scan.footprintSemiMajorKm * 1000 - 1e-6);
      expect(hi).toBeLessThanOrEqual(scan.footprintSemiMajorKm * (1 + scan.footprintGrowthFactor) * 1000 + 1e-6);
      expect(lo).toBeLessThanOrEqual(hi);
    }
    expect(() => trackStrip(equatorialBatch(2, 15), 0, { ...BASE, scan })).toThrow(/swathHalfWidthKm/);
  });

  it('offsets a side-looking ribbon away from nadir (stripmap posture)', () => {
    const strip = trackStrip(equatorialBatch(4, 10), 0, {
      ...BASE, offsetRangeKm: { nearKm: 250, farKm: 400, side: 'right' },
    });
    expect(validateStrip(strip).errors).toEqual([]);
    for (const s of strip.segments) {
      // Orbit normal is +z: 'right' is the north side; left is the near edge.
      expect(s.left[2]).toBeCloseTo(R_BODY * Math.sin(250 / R_BODY), 9);
      expect(s.right[2]).toBeCloseTo(R_BODY * Math.sin(400 / R_BODY), 9);
    }
    const mirrored = trackStrip(equatorialBatch(4, 10), 0, {
      ...BASE, offsetRangeKm: { nearKm: 250, farKm: 400, side: 'left' },
    });
    expect(mirrored.segments[0]!.left[2]).toBeCloseTo(-R_BODY * Math.sin(250 / R_BODY), 9);
    expect(() => trackStrip(equatorialBatch(2, 10), 0, {
      ...BASE, swathHalfWidthKm: 50, offsetRangeKm: { nearKm: 250, farKm: 400, side: 'right' },
    })).toThrow(/exclusive/);
    expect(() => trackStrip(equatorialBatch(2, 10), 0, {
      ...BASE, offsetRangeKm: { nearKm: 400, farKm: 250, side: 'right' },
    })).toThrow(/nearKm < farKm/);
  });

  it('re-emits states for an evolving clock without touching geometry', () => {
    const base = trackStrip(equatorialBatch(5, 10), 0, { ...BASE, swathHalfWidthKm: 50 });
    const early = withStateRule(base, -1);
    expect(early.segments.every((s) => s.state === 'planned')).toBe(true);
    const mid = withStateRule(base, 20);
    expect(mid.segments.map((s) => s.state)).toEqual([
      'committed', 'committed', 'acquiring', 'planned', 'planned',
    ]);
    expect(validateStrip(mid).errors).toEqual([]);
    // Geometry is shared, not copied: cheap enough for a per-tick clock.
    expect(mid.segments[0]!.left).toBe(base.segments[0]!.left);
    const late = withStateRule(base, 1000);
    expect(late.segments.at(-1)!.state).toBe('acquiring');
    expect(late.segments.slice(0, -1).every((s) => s.state === 'committed')).toBe(true);
  });

  const width = (s: { left: readonly number[]; right: readonly number[] }): number =>
    Math.hypot(s.left[0]! - s.right[0]!, s.left[1]! - s.right[1]!, s.left[2]! - s.right[2]!);

  it('carries the cross-track forward through a mid-track hover (ADR-0012)', () => {
    // Segment 1 hovers in place at segment 0's position with zero velocity, so
    // its along-track direction is undefined; the policy holds segment 0's
    // cross-track, and at the same position that reproduces segment 0's edges.
    const batch = equatorialBatch(3, 10);
    for (let k = 0; k < 3; k++) batch.states[6 + k] = batch.states[k]!;
    for (let k = 3; k < 6; k++) batch.states[6 + k] = 0;
    const strip = trackStrip(batch, 0, { ...BASE, swathHalfWidthKm: 50 });
    expect(validateStrip(strip).errors).toEqual([]);
    expect(width(strip.segments[1]!)).toBeGreaterThan(0);
    expect(strip.segments[1]!.left).toEqual(strip.segments[0]!.left);
    expect(strip.segments[1]!.right).toEqual(strip.segments[0]!.right);
  });

  it('renders a zero-width stare when a track begins degenerate (ADR-0012)', () => {
    // Segment 0 has zero velocity and no prior direction to hold, so it is a
    // point at nadir; segment 1 moves and renders a normal swath.
    const batch = equatorialBatch(2, 10);
    batch.states.fill(0, 3, 6);
    const strip = trackStrip(batch, 0, { ...BASE, swathHalfWidthKm: 50 });
    expect(validateStrip(strip).errors).toEqual([]);
    expect(width(strip.segments[0]!)).toBe(0);
    expect(strip.segments[0]!.left).toEqual(strip.segments[0]!.right);
    // The stare carries a single nadir bead so the sparse path draws it as a
    // dot; a bare zero-width segment would render nothing.
    expect(strip.segments[0]!.sub).toEqual([{ kind: 'beads', points: [strip.segments[0]!.left] }]);
    expect(width(strip.segments[1]!)).toBeGreaterThan(0);
  });

  it('leaves an ordinary moving track without any stares', () => {
    const strip = trackStrip(equatorialBatch(5, 10), 0, { ...BASE, swathHalfWidthKm: 100 });
    expect(strip.segments.every((s) => width(s) > 0)).toBe(true);
  });

  it('still throws on a body-center position and a non-positive radius', () => {
    // A body-center position has no nadir at all, so it stays a thrown error.
    const centered = equatorialBatch(1, 10);
    centered.states.fill(0, 0, 3);
    expect(() => trackStrip(centered, 0, { ...BASE, swathHalfWidthKm: 50 })).toThrow(/degenerate position/);
    expect(() => trackStrip(equatorialBatch(1, 10), 0, { ...BASE, bodyRadiusKm: 0 })).toThrow(/positive/);
  });
});

describe('trackStrip step-scan sounder posture (tile 3 family, AGE-04)', () => {
  const STEP = { positionsPerRow: 15, footprintRadiusKm: 4.6, crossGrowthFactor: 1.7, alongGrowthFactor: 0.45 };

  it('emits positionsPerRow footprints per segment, growing off-nadir', () => {
    const strip = trackStrip(equatorialBatch(4, 10), 0, { ...BASE, swathHalfWidthKm: 67.2, stepScan: STEP });
    expect(validateStrip(strip).errors).toEqual([]);
    for (const s of strip.segments) {
      const fps = (s.sub ?? []).filter((x) => x.kind === 'footprint');
      expect(fps).toHaveLength(15);
    }
    const majors = strip.segments[0]!.sub!.filter((x) => x.kind === 'footprint')
      .map((f) => (f.kind === 'footprint' ? f.semiMajorKm : 0));
    const qEdge = (15 - 1) / 15;
    expect(Math.min(...majors)).toBeLessThan(4.6 * 1.1);
    expect(Math.max(...majors)).toBeCloseTo(4.6 * (1 + 1.7 * qEdge * qEdge), 6);
  });

  it('requires a swath and refuses combining with scan', () => {
    expect(() => trackStrip(equatorialBatch(3, 10), 0, { ...BASE, stepScan: STEP })).toThrow(/swathHalfWidthKm/);
    expect(() => trackStrip(equatorialBatch(3, 10), 0, {
      ...BASE, swathHalfWidthKm: 50, stepScan: STEP,
      scan: { scanRateHz: 0.05, subStepSec: 2, footprintSemiMajorKm: 4, footprintSemiMinorKm: 3, footprintGrowthFactor: 0.5 },
    })).toThrow(/exclusive with scan/);
  });
});

describe('trackStrip conical radiometer posture (tile 4 family, AGE-04)', () => {
  const CONE = { scanRadiusKm: 72, sectorHalfAngleRad: 1.2217, spinPeriodSec: 0.28, footprintSemiMajorKm: 6.4, footprintSemiMinorKm: 3.9 };

  it('holds constant incidence: the crescent sits scanRadiusKm from nadir', () => {
    const strip = trackStrip(equatorialBatch(6, 10), 0, { ...BASE, conical: CONE });
    expect(validateStrip(strip).errors).toEqual([]);
    const theta = 72 / R_BODY; // the great-circle angle for a 72 km offset
    strip.segments.forEach((s, i) => {
      const fps = (s.sub ?? []).filter((x) => x.kind === 'footprint');
      expect(fps).toHaveLength(1);
      const fp = fps[0]!;
      if (fp.kind !== 'footprint') throw new Error('footprint expected');
      expect(Math.hypot(...fp.center)).toBeCloseTo(R_BODY, 6);
      // The equatorial nadir at epoch i is known analytically; the crescent
      // centre is exactly the scan radius away, every segment (constant
      // incidence), and both envelope edges are too (the sector chord).
      const a = OMEGA * i * 10;
      const nadir: [number, number, number] = [R_BODY * Math.cos(a), R_BODY * Math.sin(a), 0];
      const dot = (fp.center[0] * nadir[0] + fp.center[1] * nadir[1] + fp.center[2] * nadir[2]) / (R_BODY * R_BODY);
      expect(Math.acos(Math.min(1, dot))).toBeCloseTo(theta, 6);
      for (const edge of [s.left, s.right]) {
        const ed = (edge[0] * nadir[0] + edge[1] * nadir[1] + edge[2] * nadir[2]) / (R_BODY * R_BODY);
        expect(Math.acos(Math.min(1, ed))).toBeCloseTo(theta, 6);
      }
    });
  });

  it('is standalone: refuses combining with a swath', () => {
    expect(() => trackStrip(equatorialBatch(3, 10), 0, { ...BASE, swathHalfWidthKm: 50, conical: CONE }))
      .toThrow(/standalone/);
  });
});

describe('trackStrip subSwaths and looks postures (radar families, AGE-04)', () => {
  it('SweepSAR DBF: every segment carries count sub-swaths at once', () => {
    const strip = trackStrip(equatorialBatch(4, 10), 0, {
      ...BASE, swathHalfWidthKm: 120, subSwaths: { count: 5 },
    });
    expect(validateStrip(strip).errors).toEqual([]);
    for (const s of strip.segments) {
      const idx = (s.sub ?? []).filter((x) => x.kind === 'sub-swath').map((x) => (x.kind === 'sub-swath' ? x.index : -1));
      expect(idx).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('ScanSAR/TOPS bursts: one sub-swath per segment, index hopping with a burstId', () => {
    const strip = trackStrip(equatorialBatch(9, 10), 0, {
      ...BASE, offsetRangeKm: { nearKm: 100, farKm: 300, side: 'right' }, subSwaths: { count: 3, burstPeriodSec: 20 },
    });
    for (const s of strip.segments) {
      const ss = (s.sub ?? []).filter((x) => x.kind === 'sub-swath');
      expect(ss).toHaveLength(1);
    }
    // et 0,10 -> burst 0 index 0; et 20,30 -> burst 1 index 1; et 40..-> burst 2 index 2; et 60 -> burst 3 index 0.
    const first = strip.segments[0]!.sub![0]!;
    const later = strip.segments[6]!.sub![0]!; // et 60 -> burst 3 -> index 0, burst-03
    if (first.kind === 'sub-swath' && later.kind === 'sub-swath') {
      expect(first.index).toBe(0);
      expect(first.burstId).toBe('burst-00');
      expect(later.index).toBe(0);
      expect(later.burstId).toBe('burst-03');
    }
  });

  it('fan-beam looks: one look per azimuth on each segment', () => {
    const azimuths = [-0.4, 0, 0.4];
    const strip = trackStrip(equatorialBatch(3, 10), 0, {
      ...BASE, swathHalfWidthKm: 250, looks: { azimuthsRad: azimuths },
    });
    expect(validateStrip(strip).errors).toEqual([]);
    for (const s of strip.segments) {
      const looks = (s.sub ?? []).filter((x) => x.kind === 'look');
      expect(looks.map((l) => (l.kind === 'look' ? l.azimuthRad : NaN))).toEqual(azimuths);
    }
  });

  it('requires a swath and refuses combining with the footprint postures', () => {
    expect(() => trackStrip(equatorialBatch(3, 10), 0, { ...BASE, subSwaths: { count: 3 } }))
      .toThrow(/decorate a swath/);
    expect(() => trackStrip(equatorialBatch(3, 10), 0, {
      ...BASE, swathHalfWidthKm: 100, looks: { azimuthsRad: [0] },
      scan: { scanRateHz: 0.05, subStepSec: 2, footprintSemiMajorKm: 4, footprintSemiMinorKm: 3, footprintGrowthFactor: 0.5 },
    })).toThrow(/exclusive with scan/);
  });
});
