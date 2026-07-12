import { describe, expect, it } from 'vitest';
import { stripToGeo } from '../src/geo.js';
import { decideLod, medianProjectedWidthPx, paintNowLine, paintStrip, paintTrailWindow } from '../src/paint.js';
import type { PaintOptions, Treatment } from '../src/paint.js';
import { ATLAS_PALETTE, dashPatternFor } from '../src/palette.js';
import { FakeCtx, alphaOf, fixtureStrip, makeProjector, sameHue, syntheticStrip } from './fake-ctx.js';

const WIDE = makeProjector(20);

function paint(family: string, options: PaintOptions): FakeCtx {
  const ctx = new FakeCtx();
  paintStrip(ctx, stripToGeo(fixtureStrip(family)), WIDE, options);
  return ctx;
}

describe('flat fill: hue is state (AGE-07, AGE-08)', () => {
  it('fills one quad per connected pair with the state hue in force', () => {
    const ctx = paint('pushbroom', { treatment: 'flat-fill' });
    const fills = ctx.fills();
    expect(fills).toHaveLength(40);
    expect(fills.filter((f) => sameHue(f.fillStyle, ATLAS_PALETTE.committed))).toHaveLength(27);
    expect(fills.filter((f) => sameHue(f.fillStyle, ATLAS_PALETTE.acquiring))).toHaveLength(1);
    expect(fills.filter((f) => sameHue(f.fillStyle, ATLAS_PALETTE.planned))).toHaveLength(12);
  });

  it('honors an explicit palette override (AGE-08)', () => {
    const palette = { committed: '#112233', acquiring: '#445566', planned: '#778899', guide: '#aabbcc' };
    const ctx = paint('pushbroom', { treatment: 'flat-fill', palette });
    expect(ctx.fills().every((f) => !sameHue(f.fillStyle, ATLAS_PALETTE.committed))).toBe(true);
    expect(ctx.fills().some((f) => sameHue(f.fillStyle, palette.committed))).toBe(true);
  });

  it('paints dwells as separate patches with nothing between (SPEC-STRIP gaps)', () => {
    const ctx = paint('spotlight-sar', { treatment: 'flat-fill' });
    expect(ctx.fills()).toHaveLength(8);
  });

  it('draws lone bursts as bars, never bridging sub-swaths', () => {
    const ctx = paint('scansar-tops', { treatment: 'flat-fill' });
    expect(ctx.fills()).toHaveLength(0);
    expect(ctx.strokes().length).toBeGreaterThanOrEqual(19);
  });
});

describe('outline treatment', () => {
  it('strokes edges and fills nothing', () => {
    const ctx = paint('pushbroom', { treatment: 'outline' });
    expect(ctx.fills()).toHaveLength(0);
    expect(ctx.strokes().length).toBeGreaterThanOrEqual(80);
  });
});

describe('sparse geometries are never ribbons (AGE-09)', () => {
  it('paints profiler beads as dots in every treatment', () => {
    for (const treatment of ['flat-fill', 'outline', 'mechanism'] as Treatment[]) {
      const ctx = paint('profiler', { treatment });
      expect(ctx.fills(), treatment).toHaveLength(0);
      expect(ctx.dots().length, treatment).toBe(78 * 6);
    }
  });
});

describe('mechanism treatment and LOD (AGE-09)', () => {
  it('draws whiskbroom footprint ellipses at mechanism scale', () => {
    const ctx = paint('whiskbroom', { treatment: 'mechanism' });
    expect(ctx.ellipses().filter((e) => e.op === 'fill')).toHaveLength(121);
  });

  it('falls back to the envelope below the width threshold', () => {
    const narrow = makeProjector(0.05);
    const geo = stripToGeo(fixtureStrip('whiskbroom'));
    expect(decideLod(medianProjectedWidthPx(geo, narrow), 8)).toBe('envelope');
    const ctx = new FakeCtx();
    paintStrip(ctx, geo, narrow, { treatment: 'mechanism' });
    expect(ctx.ellipses()).toHaveLength(0);
    expect(ctx.fills().length).toBeGreaterThan(0);
  });

  it('textures mechanism strokes by instrument identity (AGE-08)', () => {
    const ctx = paint('whiskbroom', { treatment: 'mechanism' });
    const dash = dashPatternFor(fixtureStrip('whiskbroom').instrumentId);
    expect(ctx.dashCalls.some((call) => call === dash)).toBe(true);
  });

  it('draws framing frames and bistatic baselines above the threshold', () => {
    // Framing frames project to 7.9 px at the shared scale, just under the
    // default LOD threshold; zoom in so the mechanism grade engages.
    const zoomed = new FakeCtx();
    paintStrip(zoomed, stripToGeo(fixtureStrip('framing')), makeProjector(40), { treatment: 'mechanism' });
    expect(zoomed.fills().filter((f) => f.path.length === 4)).toHaveLength(14);
    const bistatic = paint('bistatic-formation', { treatment: 'mechanism' });
    expect(bistatic.dots().length).toBeGreaterThanOrEqual(41);
  });
});

describe('time gradient', () => {
  it('fades older coverage', () => {
    const strip = fixtureStrip('pushbroom');
    const lastEt = strip.segments[strip.segments.length - 1]!.etSec;
    const ctx = paint('pushbroom', { treatment: 'time-gradient', nowEtSec: lastEt });
    const fills = ctx.fills();
    expect(alphaOf(fills[0]!.fillStyle)).toBeLessThan(alphaOf(fills[26]!.fillStyle));
  });
});

describe('quality gradient', () => {
  it('scales alpha with the quality range where it varies', () => {
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(fixtureStrip('flyby-swath')), WIDE, { treatment: 'quality-gradient' });
    const alphas = ctx.fills().map((f) => alphaOf(f.fillStyle));
    expect(Math.max(...alphas)).toBeGreaterThan(Math.min(...alphas) * 1.5);
  });
});

describe('now plus trail', () => {
  it('paints coverage up to now and the bright now line', () => {
    const strip = fixtureStrip('pushbroom');
    const nowEt = strip.segments[28]!.etSec;
    const geo = stripToGeo(strip);
    const ctx = new FakeCtx();
    paintStrip(ctx, geo, WIDE, { treatment: 'now-trail', nowEtSec: nowEt });
    expect(ctx.fills()).toHaveLength(28);
    const nowStrokes = ctx.strokes().filter((s) => sameHue(s.strokeStyle, ATLAS_PALETTE.acquiring));
    expect(nowStrokes).toHaveLength(1);
  });

  it('extrudes the trail incrementally by clock window', () => {
    const strip = fixtureStrip('pushbroom');
    const geo = stripToGeo(strip);
    const ctx = new FakeCtx();
    const first = paintTrailWindow(ctx, geo, WIDE, { treatment: 'now-trail' }, -Infinity, 2.5);
    const second = paintTrailWindow(ctx, geo, WIDE, { treatment: 'now-trail' }, 2.5, 5.0);
    expect(first).toBe(10);
    expect(second).toBe(10);
    expect(ctx.fills()).toHaveLength(20);
  });

  it('marks a zero-width now as a dot, not a line', () => {
    const geo = stripToGeo(fixtureStrip('profiler'));
    const ctx = new FakeCtx();
    paintNowLine(ctx, geo, WIDE, { treatment: 'now-trail', nowEtSec: 5 });
    expect(ctx.dots()).toHaveLength(1);
  });
});

describe('antimeridian and polar painting (AGE-10)', () => {
  it('paints a crossing strip once per world copy with finite coordinates', () => {
    const strip = syntheticStrip([
      [0, 178, 1, 0],
      [0, 179.5, 1, 1],
      [0, -179, 1, 2],
      [0, -177.5, 1, 3],
    ]);
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(strip), WIDE, { treatment: 'flat-fill' });
    expect(ctx.fills().length).toBeGreaterThan(3);
    for (const f of ctx.fills()) {
      for (const [x, y] of f.path) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });

  it('paints a polar pass without blowing up', () => {
    const strip = syntheticStrip([
      [88, 0, 2, 0],
      [89.5, 0, 2, 1],
      [89.5, 180, 2, 2],
      [88, 180, 2, 3],
    ]);
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(strip), WIDE, { treatment: 'flat-fill' });
    expect(ctx.fills().length).toBeGreaterThan(0);
    for (const f of ctx.fills()) {
      for (const [x, y] of f.path) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });
});
