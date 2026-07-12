import { describe, expect, it } from 'vitest';
import {
  BILATERAL_SWATH_SCENE, BISTATIC_FORMATION_SCENE, FAN_BEAM_SCENE, PENCIL_BEAM_SCENE,
  SCANSAR_TOPS_SCENE, SPOTLIGHT_SAR_SCENE, STRIPMAP_SAR_SCENE, SWEEPSAR_DBF_SCENE,
  generateBilateralSwathStrip, generateBistaticFormationStrip,
  generateFanBeamScatterometerStrip, generatePencilBeamScatterometerStrip,
  generateScansarTopsStrip, generateSpotlightSarStrip,
  generateStripmapSarStrip, generateSweepsarDbfStrip,
} from '../src/index.js';
import type { AlongTrackScene, InstrumentModel, Strip, Vec3 } from '../src/index.js';
import { chord, readJson, replayFamily } from './replay-helpers.js';

/** Every assertion constant below comes from the model fixture or the scene. */
function model(family: string): InstrumentModel {
  return readJson<InstrumentModel>(`models/${family}.json`);
}

function num(m: InstrumentModel, key: string): number {
  const v = m.params[key];
  if (typeof v !== 'number') throw new Error(`param ${key} not numeric in ${m.instrumentId}`);
  return v;
}

function nums(m: InstrumentModel, key: string): readonly number[] {
  const v = m.params[key];
  if (!Array.isArray(v)) throw new Error(`param ${key} not an array in ${m.instrumentId}`);
  return v as readonly number[];
}

/** Nadir track point recovered from an offset ribbon: left sits near, right far. */
function trackFromEdges(left: Vec3, right: Vec3, near: number, far: number): Vec3 {
  const k = near / (far - near);
  return [
    left[0] + (left[0] - right[0]) * k,
    left[1] + (left[1] - right[1]) * k,
    left[2] + (left[2] - right[2]) * k,
  ];
}

const FAMILIES: ReadonlyArray<readonly [string, (m: InstrumentModel, s: never) => Strip, AlongTrackScene]> = [
  ['stripmap-sar', generateStripmapSarStrip as never, STRIPMAP_SAR_SCENE],
  ['scansar-tops', generateScansarTopsStrip as never, SCANSAR_TOPS_SCENE],
  ['spotlight-sar', generateSpotlightSarStrip as never, SPOTLIGHT_SAR_SCENE],
  ['sweepsar-dbf', generateSweepsarDbfStrip as never, SWEEPSAR_DBF_SCENE],
  ['bistatic-formation', generateBistaticFormationStrip as never, BISTATIC_FORMATION_SCENE],
  ['fan-beam-scatterometer', generateFanBeamScatterometerStrip as never, FAN_BEAM_SCENE],
  ['pencil-beam-scatterometer', generatePencilBeamScatterometerStrip as never, PENCIL_BEAM_SCENE],
  ['bilateral-swath', generateBilateralSwathStrip as never, BILATERAL_SWATH_SCENE],
];

function replay(family: string): Strip {
  const entry = FAMILIES.find(([f]) => f === family)!;
  return replayFamily(entry[0], entry[1] as (m: InstrumentModel, s: unknown) => Strip, entry[2]);
}

describe('radar family samplers replay their fixtures (AGE-03, AGE-17)', () => {
  for (const [family] of FAMILIES) {
    it(`regenerates the ${family} fixture from its model within tolerance`, () => {
      replay(family);
    });
  }

  it('applies the frozen state rule around each scene acquiring index', () => {
    for (const [family, , scene] of FAMILIES) {
      const states = replay(family).segments.map((s) => s.state);
      expect(states.filter((s) => s === 'acquiring'), family).toHaveLength(1);
      expect(states.indexOf('acquiring'), family).toBe(scene.acquiringIndex);
      expect(states.slice(0, scene.acquiringIndex).every((s) => s === 'committed'), family).toBe(true);
      expect(states.slice(scene.acquiringIndex + 1).every((s) => s === 'planned'), family).toBe(true);
    }
  });
});

describe('stripmap-sar mechanism (tile 7)', () => {
  it('offsets the ribbon to the imaged side with the demonstration incidence', () => {
    const m = model('stripmap-sar');
    const strip = replay('stripmap-sar');
    expect(strip.body).toBe(STRIPMAP_SAR_SCENE.body);
    expect(strip.mode).toBe(`${String(m.params['side'])}-looking`);
    expect(strip.segments).toHaveLength(STRIPMAP_SAR_SCENE.segmentCount);
    const width = num(m, 'farRangeKm') - num(m, 'nearRangeKm');
    for (const s of strip.segments) {
      expect(Math.abs(chord(s.left, s.right) - width)).toBeLessThan(0.5);
      expect(s.quality?.incidenceDeg).toEqual(STRIPMAP_SAR_SCENE.incidenceDeg);
      expect(s.sub).toBeUndefined();
    }
  });
});

describe('scansar-tops mechanism (tile 8)', () => {
  it('hops the beam across sub-swaths in bursts with seams as time gaps', () => {
    const m = model('scansar-tops');
    const strip = replay('scansar-tops');
    const flat = nums(m, 'subSwathRangesKm');
    const period = num(m, 'burstPeriodSec');
    const pairCount = flat.length / 2;
    const expected = Math.floor(SCANSAR_TOPS_SCENE.passSec / period + 1e-9) + 1;
    expect(strip.segments).toHaveLength(expected);
    expect(expected).toBe(SCANSAR_TOPS_SCENE.segmentCount);
    strip.segments.forEach((s, k) => {
      expect(s.etSec).toBeCloseTo(k * period, 9);
      const sub = s.sub![0]!;
      if (sub.kind !== 'sub-swath') throw new Error('sub-swath expected');
      expect(sub.index).toBe(k % pairCount);
      expect(sub.burstId).toBe(`burst-${String(k).padStart(2, '0')}`);
      const near = flat[sub.index * 2]!;
      const far = flat[sub.index * 2 + 1]!;
      expect(Math.abs(chord(s.left, s.right) - (far - near))).toBeLessThan(0.5);
    });
  });
});

describe('spotlight-sar mechanism (tile 9)', () => {
  it('dwells on each pinned patch and is silent between dwells', () => {
    const m = model('spotlight-sar');
    const strip = replay('spotlight-sar');
    const step = m.timing.segmentStepSec;
    const dwell = num(m, 'dwellSec');
    const perDwell = Math.floor(dwell / step + 1e-9) + 1;
    expect(strip.segments).toHaveLength(SPOTLIGHT_SAR_SCENE.patches.length * perDwell);
    SPOTLIGHT_SAR_SCENE.patches.forEach((patch, p) => {
      const dwellSegs = strip.segments.slice(p * perDwell, (p + 1) * perDwell);
      const center = patch.centerSf * SPOTLIGHT_SAR_SCENE.passSec;
      expect(dwellSegs[0]!.etSec).toBeCloseTo(center - dwell / 2, 9);
      expect(dwellSegs[perDwell - 1]!.etSec).toBeCloseTo(center + dwell / 2, 9);
      for (const s of dwellSegs) {
        expect(s.left).toEqual(dwellSegs[0]!.left);
        const frame = s.sub![0]!;
        if (frame.kind !== 'frame') throw new Error('frame expected');
        expect(frame.frameId).toBe(`patch-${p + 1}`);
        const [leadLeft, leadRight, , trailLeft] = frame.corners;
        expect(Math.abs(chord(leadLeft, trailLeft) - 2 * num(m, 'patchHalfAlongKm'))).toBeLessThan(0.2);
        expect(Math.abs(chord(leadLeft, leadRight) - 2 * num(m, 'patchHalfCrossKm'))).toBeLessThan(0.2);
      }
    });
    const gap = strip.segments[perDwell]!.etSec - strip.segments[perDwell - 1]!.etSec;
    expect(gap).toBeGreaterThan(step * 2);
  });
});

describe('sweepsar-dbf mechanism (tile 20)', () => {
  it('floods one full swath with beamCount receive markers', () => {
    const m = model('sweepsar-dbf');
    const strip = replay('sweepsar-dbf');
    const width = num(m, 'farRangeKm') - num(m, 'nearRangeKm');
    const beamCount = num(m, 'beamCount');
    expect(strip.segments).toHaveLength(SWEEPSAR_DBF_SCENE.segmentCount);
    for (const s of strip.segments) {
      expect(Math.abs(chord(s.left, s.right) - width)).toBeLessThan(0.5);
      const indices = s.sub!.map((b) => (b.kind === 'sub-swath' ? b.index : -1));
      expect(indices).toEqual(Array.from({ length: beamCount }, (_, i) => i));
    }
  });
});

describe('bistatic-formation mechanism (tile 19)', () => {
  it('weaves the companion baseline through the helix', () => {
    const m = model('bistatic-formation');
    const strip = replay('bistatic-formation');
    const near = num(m, 'nearRangeKm');
    const far = num(m, 'farRangeKm');
    const sep = num(m, 'alongTrackSepKm');
    const amp = num(m, 'crossTrackAmpKm');
    const baselines = strip.segments.map((s) => {
      const sub = s.sub![0]!;
      if (sub.kind !== 'baseline') throw new Error('baseline expected');
      return chord(sub.companion, trackFromEdges(s.left, s.right, near, far));
    });
    expect(baselines[0]).toBeCloseTo(sep, 0);
    expect(Math.min(...baselines)).toBeGreaterThan(sep - 0.2);
    expect(Math.max(...baselines)).toBeCloseTo(Math.hypot(sep, amp), 0);
  });
});

describe('fan-beam-scatterometer mechanism (tile 10)', () => {
  it('cycles the azimuth looks on the beam clock over one swath', () => {
    const m = model('fan-beam-scatterometer');
    const strip = replay('fan-beam-scatterometer');
    const looks = nums(m, 'azimuthLooksRad');
    const period = num(m, 'beamPeriodSec');
    expect(strip.segments).toHaveLength(FAN_BEAM_SCENE.segmentCount);
    strip.segments.forEach((s, k) => {
      expect(s.etSec).toBeCloseTo(k * period, 9);
      const look = s.sub![0]!;
      if (look.kind !== 'look') throw new Error('look expected');
      expect(look.index).toBe(k % looks.length);
      expect(look.azimuthRad).toBe(looks[k % looks.length]);
    });
  });
});

describe('pencil-beam-scatterometer mechanism (tile 11)', () => {
  it('spins two beads at their beam radii with no nadir gap', () => {
    const m = model('pencil-beam-scatterometer');
    const strip = replay('pencil-beam-scatterometer');
    const inner = num(m, 'innerRadiusKm');
    const outer = num(m, 'outerRadiusKm');
    expect(strip.segments).toHaveLength(PENCIL_BEAM_SCENE.segmentCount);
    for (const s of strip.segments) {
      expect(Math.abs(chord(s.left, s.right) - 2 * outer)).toBeLessThan(1);
      const beads = s.sub![0]!;
      if (beads.kind !== 'beads') throw new Error('beads expected');
      expect(beads.points).toHaveLength(2);
      const mid: Vec3 = [
        (s.left[0] + s.right[0]) / 2, (s.left[1] + s.right[1]) / 2, (s.left[2] + s.right[2]) / 2,
      ];
      expect(Math.abs(chord(beads.points[0]!, mid) - inner)).toBeLessThan(0.5);
      expect(Math.abs(chord(beads.points[1]!, mid) - outer)).toBeLessThan(0.5);
    }
    const first = strip.segments[0]!.sub![0]!;
    if (first.kind !== 'beads') throw new Error('beads expected');
    expect(Math.abs(chord(first.points[0]!, strip.segments[0]!.right) - (outer - inner))).toBeLessThan(0.5);
  });
});

describe('bilateral-swath mechanism (tile 12)', () => {
  it('paints one side of the gap and stitches the nadir chain on the distance clock', () => {
    const m = model('bilateral-swath');
    const strip = replay('bilateral-swath');
    const gap = num(m, 'gapHalfWidthKm');
    const outer = num(m, 'outerEdgeKm');
    const beadStep = num(m, 'nadirBeadStepKm');
    expect(strip.segments).toHaveLength(BILATERAL_SWATH_SCENE.segmentCount);
    const allBeads: Vec3[] = [];
    for (const s of strip.segments) {
      expect(Math.abs(chord(s.left, s.right) - (outer - gap))).toBeLessThan(0.5);
      if (!s.sub) continue;
      const beads = s.sub[0]!;
      if (beads.kind !== 'beads') throw new Error('beads expected');
      allBeads.push(...beads.points);
    }
    const expectedBeads = Math.floor(BILATERAL_SWATH_SCENE.trackLengthKm / beadStep + 1e-9) + 1;
    expect(allBeads).toHaveLength(expectedBeads);
    for (let i = 1; i < allBeads.length; i++) {
      expect(Math.abs(chord(allBeads[i - 1]!, allBeads[i]!) - beadStep)).toBeLessThan(0.1);
    }
    const seg0 = strip.segments[0]!;
    expect(chord(allBeads[0]!, trackFromEdges(seg0.left, seg0.right, gap, outer))).toBeLessThan(0.1);
    expect(strip.segments[strip.segments.length - 1]!.sub).toBeUndefined();
  });
});
