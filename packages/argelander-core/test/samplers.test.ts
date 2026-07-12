import { describe, expect, it } from 'vitest';
import {
  FRAMING_SCENE, MULTI_ANGLE_SCENE, PROFILER_SCENE, PUSH_FRAME_SCENE, WHISKBROOM_SCENE,
  generateFramingStrip, generateMultiAngleStrip, generateProfilerStrip,
  generatePushFrameStrip, generateWhiskbroomStrip,
} from '../src/index.js';
import type { AlongTrackScene, InstrumentModel, Strip, SubFootprint } from '../src/index.js';
import { TOLERANCE, chord, replayFamily as replay } from './replay-helpers.js';

type Sampler = (model: InstrumentModel, scene: AlongTrackScene) => Strip;

const FAMILIES: ReadonlyArray<readonly [string, Sampler, AlongTrackScene]> = [
  ['whiskbroom', generateWhiskbroomStrip, WHISKBROOM_SCENE],
  ['framing', generateFramingStrip, FRAMING_SCENE],
  ['profiler', generateProfilerStrip, PROFILER_SCENE],
  ['push-frame', generatePushFrameStrip, PUSH_FRAME_SCENE],
  ['multi-angle', generateMultiAngleStrip, MULTI_ANGLE_SCENE],
];

describe('along-track family samplers replay their fixtures (AGE-03, AGE-17)', () => {
  for (const [family, sample, scene] of FAMILIES) {
    it(`regenerates the ${family} fixture from its model within tolerance`, () => {
      replay(family, sample, scene);
    });
  }

  it('applies the frozen state rule around each scene acquiring index', () => {
    for (const [family, sample, scene] of FAMILIES) {
      const strip = replay(family, sample, scene);
      const states = strip.segments.map((s) => s.state);
      expect(states.filter((s) => s === 'acquiring'), family).toHaveLength(1);
      expect(states.indexOf('acquiring'), family).toBe(scene.acquiringIndex);
      expect(states.slice(0, scene.acquiringIndex).every((s) => s === 'committed'), family).toBe(true);
      expect(states.slice(scene.acquiringIndex + 1).every((s) => s === 'planned'), family).toBe(true);
    }
  });
});

describe('whiskbroom mechanism (tile 2)', () => {
  const generate = (): Strip => replay('whiskbroom', generateWhiskbroomStrip, WHISKBROOM_SCENE);

  it('sweeps the mirror in sub-sampled footprints with bowtie growth', () => {
    const strip = generate();
    const footprints = strip.segments.flatMap((s) => (s.sub ?? []) as SubFootprint[]);
    expect(footprints.every((f) => f.kind === 'footprint')).toBe(true);
    expect(footprints.length).toBeGreaterThan(100);
    const majors = footprints.map((f) => f.semiMajorKm);
    expect(Math.min(...majors)).toBeGreaterThanOrEqual(3.4 - TOLERANCE);
    expect(Math.max(...majors)).toBeGreaterThan(3.4 * 1.5);
    expect(Math.max(...majors)).toBeLessThanOrEqual(3.4 * 1.9 + TOLERANCE);
    for (const f of footprints) {
      expect(Math.abs(f.rotationRad - WHISKBROOM_SCENE.tiltRad)).toBeLessThan(1e-9);
      expect(f.semiMinorKm / f.semiMajorKm).toBeCloseTo(2.1 / 3.4, 9);
    }
  });

  it('holds the swath envelope constant', () => {
    const strip = generate();
    const widths = strip.segments.map((s) => chord(s.left, s.right));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.5);
    expect(widths[0]).toBeGreaterThan(125);
  });
});

describe('framing mechanism (tile 5)', () => {
  const generate = (): Strip => replay('framing', generateFramingStrip, FRAMING_SCENE);

  it('emits one frame per period with a time gap signature', () => {
    const strip = generate();
    expect(strip.segments).toHaveLength(14);
    strip.segments.forEach((s, k) => {
      expect(s.etSec).toBeCloseTo(k * 0.72, 9);
      expect(s.sub).toHaveLength(1);
      const frame = s.sub![0]!;
      expect(frame.kind).toBe('frame');
      if (frame.kind === 'frame') expect(frame.frameId).toBe(`frame-${k}`);
    });
  });

  it('widens the leading edge by the overlap factor (keystone)', () => {
    for (const s of generate().segments) {
      const frame = s.sub![0]!;
      if (frame.kind !== 'frame') throw new Error('frame expected');
      const [leadLeft, leadRight, trailRight, trailLeft] = frame.corners;
      void trailRight;
      const ratio = chord(leadLeft, leadRight) / chord(trailLeft, trailRight);
      expect(ratio).toBeGreaterThan(1.10);
      expect(ratio).toBeLessThan(1.13);
    }
  });
});

describe('push-frame mechanism (tile 16)', () => {
  it('marks the filter bands on a lunar swath', () => {
    const strip = replay('push-frame', generatePushFrameStrip, PUSH_FRAME_SCENE);
    expect(strip.body).toBe('MOON');
    expect(strip.frame).toBe('IAU_MOON');
    expect(strip.segments).toHaveLength(34);
    for (const s of strip.segments) {
      expect(s.sub!.map((b) => (b.kind === 'sub-swath' ? b.index : -1))).toEqual([0, 1, 2]);
      expect(Math.hypot(...s.left)).toBeCloseTo(1737.4, 6);
    }
  });
});

describe('multi-angle mechanism (tile 17)', () => {
  it('accrues one look per station over a common corridor', () => {
    const strip = replay('multi-angle', generateMultiAngleStrip, MULTI_ANGLE_SCENE);
    expect(strip.segments).toHaveLength(41);
    for (const s of strip.segments) {
      expect(s.quality?.lookCount).toBe(3);
      expect(s.sub!.map((b) => (b.kind === 'sub-swath' ? b.index : -1))).toEqual([0, 1, 2]);
    }
  });
});

describe('profiler mechanism (tile 6)', () => {
  const generate = (): Strip => replay('profiler', generateProfilerStrip, PROFILER_SCENE);

  it('emits zero-width bead rows on the distance clock, never a ribbon', () => {
    const strip = generate();
    expect(strip.segments).toHaveLength(78);
    for (const s of strip.segments) {
      expect(s.left).toEqual(s.right);
      const beads = s.sub![0]!;
      if (beads.kind !== 'beads') throw new Error('beads expected');
      expect(beads.points).toHaveLength(6);
    }
    const speed = PROFILER_SCENE.trackLengthKm / PROFILER_SCENE.passSec;
    strip.segments.forEach((s, k) => {
      expect(s.etSec).toBeCloseTo((k * 5.5) / speed, 9);
    });
    const spacing = chord(strip.segments[0]!.left, strip.segments[1]!.left);
    expect(spacing).toBeGreaterThan(5.4);
    expect(spacing).toBeLessThanOrEqual(5.5 + TOLERANCE);
  });

  it('splits each beam offset into a pair', () => {
    const strip = generate();
    const beads = strip.segments[39]!.sub![0]!;
    if (beads.kind !== 'beads') throw new Error('beads expected');
    const center = strip.segments[39]!.left;
    const spans = beads.points.map((p) => chord(p, center));
    expect(spans[2]).toBeCloseTo(2.2, 1);
    expect(spans[3]).toBeCloseTo(2.2, 1);
    expect(spans[0]!).toBeGreaterThan(spans[1]!);
  });
});

describe('the scenes stay pinned to the atlas tiles at 1 km per pixel', () => {
  it('pins the along-track scene constants', () => {
    const shared = {
      planeWidthKm: 320, planeHeightKm: 240, passSec: 10, tiltRad: 0.2, trackLengthKm: 426,
    };
    expect(WHISKBROOM_SCENE).toEqual({
      ...shared, body: 'EARTH', frame: 'ITRF93', radiusKm: 6371, segmentCount: 41, acquiringIndex: 28,
    });
    expect(FRAMING_SCENE).toEqual({
      ...shared, body: 'EARTH', frame: 'ITRF93', radiusKm: 6371, segmentCount: 14, acquiringIndex: 9,
    });
    expect(PROFILER_SCENE).toEqual({
      ...shared, body: 'EARTH', frame: 'ITRF93', radiusKm: 6371, segmentCount: 78, acquiringIndex: 53,
    });
    expect(PUSH_FRAME_SCENE).toEqual({
      ...shared, body: 'MOON', frame: 'IAU_MOON', radiusKm: 1737.4, segmentCount: 34, acquiringIndex: 23,
    });
    expect(MULTI_ANGLE_SCENE).toEqual({
      ...shared, body: 'EARTH', frame: 'ITRF93', radiusKm: 6371, segmentCount: 41, acquiringIndex: 28,
    });
  });
});
