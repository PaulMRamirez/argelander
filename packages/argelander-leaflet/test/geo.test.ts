import { describe, expect, it } from 'vitest';
import { bodyRadiusKm, stripToGeo, toGeo, unwrapLon, worldCopyOffsets } from '../src/geo.js';
import { fixtureStrip, syntheticStrip } from './fake-ctx.js';

describe('body-fixed to geographic (AGE-10 groundwork)', () => {
  it('converts the cardinal directions', () => {
    expect(toGeo([6371, 0, 0])).toEqual({ lonDeg: 0, latDeg: 0 });
    expect(toGeo([0, 6371, 0]).lonDeg).toBeCloseTo(90, 9);
    expect(toGeo([0, 0, 6371]).latDeg).toBeCloseTo(90, 9);
    expect(toGeo([-6371, 0, 0]).lonDeg).toBeCloseTo(180, 9);
  });

  it('recovers the body radius from the strip itself, non-Earth included', () => {
    expect(bodyRadiusKm(fixtureStrip('pushbroom'))).toBeCloseTo(6371, 3);
    expect(bodyRadiusKm(fixtureStrip('push-frame'))).toBeCloseTo(1737.4, 3);
    expect(bodyRadiusKm(fixtureStrip('flyby-swath'))).toBeCloseTo(2575, 3);
  });
});

describe('segment connection: adapters must not interpolate across gaps', () => {
  const connections = (family: string): boolean[] => [...stripToGeo(fixtureStrip(family)).connect];

  it('ribbons the continuous families end to end', () => {
    expect(connections('pushbroom').every(Boolean)).toBe(true);
    expect(connections('whiskbroom').every(Boolean)).toBe(true);
    expect(connections('bilateral-swath').every(Boolean)).toBe(true);
  });

  it('never ribbons zero-width bead chains (AGE-09)', () => {
    expect(connections('profiler').some(Boolean)).toBe(false);
  });

  it('breaks at burst seams: every TOPS burst stands alone', () => {
    expect(connections('scansar-tops').some(Boolean)).toBe(false);
  });

  it('breaks the frame chain at every frame boundary', () => {
    expect(connections('framing').some(Boolean)).toBe(false);
  });

  it('ribbons within a spotlight dwell and breaks between dwells', () => {
    const connect = connections('spotlight-sar');
    expect(connect).toHaveLength(9);
    expect(connect.filter(Boolean)).toHaveLength(8);
    expect(connect[4]).toBe(false);
  });
});

describe('antimeridian handling (AGE-10)', () => {
  it('unwraps longitudes to the reference branch', () => {
    expect(unwrapLon(179, -179)).toBe(181);
    expect(unwrapLon(-170, 175)).toBe(-185);
    expect(unwrapLon(10, 12)).toBe(12);
  });

  it('adds a world copy only when the ring strays across', () => {
    expect(worldCopyOffsets([179, 181])).toEqual([0, -360]);
    expect(worldCopyOffsets([-179, -181])).toEqual([0, 360]);
    expect(worldCopyOffsets([10, 12])).toEqual([0]);
  });

  it('keeps a crossing strip continuous in geo space', () => {
    const strip = syntheticStrip([
      [0, 178, 1, 0],
      [0, 179.5, 1, 1],
      [0, -179, 1, 2],
      [0, -177.5, 1, 3],
    ]);
    const geo = stripToGeo(strip);
    expect(geo.connect.every(Boolean)).toBe(true);
    for (let i = 0; i + 1 < geo.segments.length; i++) {
      const a = geo.segments[i]!.left.lonDeg;
      const b = unwrapLon(a, geo.segments[i + 1]!.left.lonDeg);
      expect(Math.abs(b - a)).toBeLessThan(5);
    }
  });

  it('stays finite through a polar pass', () => {
    const strip = syntheticStrip([
      [88, 0, 2, 0],
      [89.5, 0, 2, 1],
      [89.5, 180, 2, 2],
      [88, 180, 2, 3],
    ]);
    const geo = stripToGeo(strip);
    for (const s of geo.segments) {
      expect(Number.isFinite(s.left.lonDeg)).toBe(true);
      expect(Number.isFinite(s.left.latDeg)).toBe(true);
      expect(Number.isFinite(s.widthKm)).toBe(true);
    }
  });
});

describe('sub-swath bursts break the ribbon (TOPS/ScanSAR)', () => {
  // Build a swath strip whose segments carry one sub-swath tagged by burstId;
  // consecutive segments in different bursts must not ribbon into one quad.
  function burstStrip(burstIds: readonly string[], index: (k: number) => number): ReturnType<typeof stripToGeo> {
    const R = 6371;
    const fromGeo = (lat: number, lon: number): [number, number, number] => {
      const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
      return [R * Math.cos(la) * Math.cos(lo), R * Math.cos(la) * Math.sin(lo), R * Math.sin(la)];
    };
    return stripToGeo({
      id: 'tops', body: 'EARTH', frame: 'ITRF93', instrumentId: 'test/tops',
      segments: burstIds.map((burstId, k) => ({
        etSec: k * 10, left: fromGeo(k * 0.4, -1), right: fromGeo(k * 0.4, 1), state: 'committed' as const,
        sub: [{ kind: 'sub-swath' as const, index: index(k), burstId }],
      })),
      provenance: { authority: 'test', generatedBy: 'test' },
    });
  }

  it('breaks at a burst boundary even when the single sub-swath index never changes', () => {
    // count === 1: every segment is sub-swath index 0; only the burstId differs.
    const geo = burstStrip(['b0', 'b0', 'b1', 'b1'], () => 0);
    expect([...geo.connect]).toEqual([true, false, true]);
  });

  it('breaks at each burst hop for a multi-sub-swath TOPS strip', () => {
    const geo = burstStrip(['b0', 'b1', 'b2', 'b0'], (k) => k % 3);
    expect([...geo.connect]).toEqual([false, false, false]);
  });
});
