import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLYBY_SCENE, PUSHBROOM_SCENE, generateFlybyStrip, generatePushbroomStrip, validateStrip,
} from '../src/index.js';
import type { InstrumentModel, Strip } from '../src/index.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));
const UPDATE = process.env['UPDATE_FIXTURES'] === '1';
const TOLERANCE_KM = 1e-6;

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(fixturesDir + rel, 'utf8')) as T;
}

/** Numeric replay comparison: metadata exact, coordinates within tolerance. */
function expectStripClose(actual: Strip, fixture: Strip): void {
  const { segments: actualSegs, ...actualMeta } = actual;
  const { segments: fixtureSegs, ...fixtureMeta } = fixture;
  expect(actualMeta).toEqual(fixtureMeta);
  expect(actualSegs.length).toBe(fixtureSegs.length);
  actualSegs.forEach((seg, i) => {
    const ref = fixtureSegs[i]!;
    expect(seg.state).toBe(ref.state);
    expect(Math.abs(seg.etSec - ref.etSec)).toBeLessThanOrEqual(TOLERANCE_KM);
    for (const edge of ['left', 'right'] as const) {
      seg[edge].forEach((x, j) => {
        expect(Math.abs(x - ref[edge][j]!)).toBeLessThanOrEqual(TOLERANCE_KM);
      });
    }
    expect(seg.quality === undefined).toBe(ref.quality === undefined);
    if (seg.quality?.resolutionM && ref.quality?.resolutionM) {
      seg.quality.resolutionM.forEach((x, j) => {
        expect(Math.abs(x - ref.quality!.resolutionM![j]!)).toBeLessThanOrEqual(TOLERANCE_KM);
      });
    }
  });
}

function replay(family: 'pushbroom' | 'flyby-swath'): void {
  const model = readJson<InstrumentModel>(`models/${family}.json`);
  const strip = family === 'pushbroom'
    ? generatePushbroomStrip(model, PUSHBROOM_SCENE)
    : generateFlybyStrip(model, FLYBY_SCENE);
  expect(validateStrip(strip).errors).toEqual([]);
  if (UPDATE) {
    writeFileSync(`${fixturesDir}strips/${family}.json`, JSON.stringify(strip, null, 2) + '\n');
  }
  const fixture = readJson<Strip>(`strips/${family}.json`);
  expectStripClose(strip, fixture);
}

describe('conformance replay of the atlas anchors (AGE-17)', () => {
  it('regenerates tile 1 (pushbroom) from its model within tolerance', () => {
    replay('pushbroom');
  });

  it('regenerates tile 21 (flyby-swath) from its model within tolerance', () => {
    replay('flyby-swath');
  });

  it('pins the frozen scene constants of SPEC-INSTRUMENT-MODEL section 5', () => {
    expect(PUSHBROOM_SCENE).toEqual({
      body: 'EARTH', frame: 'ITRF93', radiusKm: 6371,
      planeWidthKm: 320, planeHeightKm: 240,
      passSec: 10, segmentCount: 41, acquiringIndex: 28,
      tiltRad: 0.2, trackLengthKm: 426,
    });
    expect(FLYBY_SCENE).toEqual({
      body: 'TITAN', frame: 'IAU_TITAN', radiusKm: 2575,
      planeWidthKm: 320, planeHeightKm: 240,
      passSec: 10, segmentCount: 41, acquiringIndex: 28,
      controlPoints: [[-30, 43.2], [160, 120], [350, 43.2]],
      bodyCenter: [160, 283.2],
      paceAmplitude: 0.6,
    });
  });

  it('varies flyby width along the pass and holds pushbroom width constant', () => {
    const flyby = readJson<Strip>('strips/flyby-swath.json');
    const widths = flyby.segments.map((s) =>
      Math.hypot(s.left[0] - s.right[0], s.left[1] - s.right[1], s.left[2] - s.right[2]));
    const mid = widths[20]!;
    expect(Math.min(...widths)).toBeLessThan(mid + 1);
    expect(Math.max(...widths)).toBeGreaterThan(mid * 3);
    const push = readJson<Strip>('strips/pushbroom.json');
    const pw = push.segments.map((s) =>
      Math.hypot(s.left[0] - s.right[0], s.left[1] - s.right[1], s.left[2] - s.right[2]));
    expect(Math.max(...pw) - Math.min(...pw)).toBeLessThan(0.5);
  });
});
