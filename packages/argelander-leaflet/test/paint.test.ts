import { describe, expect, it } from 'vitest';
import type { Strip } from 'argelander-core';
import { stripToGeo } from '../src/geo.js';
import type { GeoSegment, GeoStrip } from '../src/geo.js';
import { decideLod, medianProjectedWidthPx, nowMarkerIndex, paintNowLine, paintStrip, paintTrailWindow, qualityAlphaScale } from '../src/paint.js';
import type { PaintOptions, Treatment } from '../src/paint.js';
import { ATLAS_PALETTE, dashPatternFor } from '../src/palette.js';
import { FakeCtx, alphaOf, fixtureStrip, fromGeo, makeProjector, sameHue, syntheticStrip } from './fake-ctx.js';

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

  it('lifts the acquiring band near opacity so the now pops (all modes)', () => {
    const flat = paint('pushbroom', { treatment: 'flat-fill' });
    const acquiring = flat.fills().filter((f) => sameHue(f.fillStyle, ATLAS_PALETTE.acquiring));
    expect(acquiring).toHaveLength(1);
    expect(alphaOf(acquiring[0]!.fillStyle)).toBeGreaterThanOrEqual(0.9);
    const committed = flat.fills().filter((f) => sameHue(f.fillStyle, ATLAS_PALETTE.committed));
    expect(alphaOf(committed[0]!.fillStyle)).toBeCloseTo(0.35, 9);
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

  it('flips between detail and envelope at the named scan-detail stops', () => {
    // The demo's Early / Standard / Late control fans 6 / 16 / 40 px.
    const geo = stripToGeo(fixtureStrip('whiskbroom'));
    const early = new FakeCtx();
    paintStrip(early, geo, makeProjector(10), { treatment: 'mechanism', mechanismMinWidthPx: 6 });
    expect(early.ellipses().length).toBeGreaterThan(0);
    const late = new FakeCtx();
    paintStrip(late, geo, makeProjector(10), { treatment: 'mechanism', mechanismMinWidthPx: 40 });
    expect(late.ellipses()).toHaveLength(0);
    expect(late.fills().length).toBeGreaterThan(0);
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

  it('hatches the swath cross-track over a faint backdrop (atlas texture)', () => {
    // stripmap-sar carries no sub-structure: the mechanism texture is the
    // hatching itself. Zoomed so the 38 km ribbon clears the LOD threshold.
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(fixtureStrip('stripmap-sar')), makeProjector(60), { treatment: 'mechanism' });
    expect(ctx.fills().length).toBeGreaterThan(0);
    expect(alphaOf(ctx.fills()[0]!.fillStyle)).toBeCloseTo(0.35 * 0.4, 9);
    expect(ctx.strokes().length).toBeGreaterThanOrEqual(41);
  });

  it('keeps footprints small under an integer-rounding projector (the Leaflet case)', () => {
    // Leaflet rounds container points to whole pixels; the km-to-px probe
    // must survive that without inflating footprints.
    const rounding = (p: { lonDeg: number; latDeg: number }): readonly [number, number] => {
      const [x, y] = makeProjector(5)(p);
      return [Math.round(x), Math.round(y)];
    };
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(fixtureStrip('whiskbroom')), rounding, { treatment: 'mechanism', mechanismMinWidthPx: 1 });
    const radii = ctx.ellipses().map((e) => Math.hypot(e.path[1]![0] - e.path[0]![0], e.path[1]![1] - e.path[0]![1]));
    expect(Math.max(...radii)).toBeLessThan(4);
  });

  it('textures mechanism strokes by instrument identity (AGE-08)', () => {
    const ctx = paint('whiskbroom', { treatment: 'mechanism' });
    const dash = dashPatternFor(fixtureStrip('whiskbroom').instrumentId);
    expect(ctx.dashCalls.some((call) => call === dash)).toBe(true);
  });

  it('orients each footprint by minus its rotationRad, the sign the golden alone would not lock', () => {
    // rotationRad is counterclockwise from east and canvas y grows down, so
    // the painter negates it. The golden captures the value, but an explicit
    // sign check survives a careless snapshot regeneration; whiskbroom carries
    // a rotated footprint on every segment, so the sequence is non-trivial.
    const expected = fixtureStrip('whiskbroom').segments.flatMap((s) =>
      (s.sub ?? []).filter((e) => e.kind === 'footprint').map((e) => -(e as { rotationRad: number }).rotationRad));
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some((r) => r !== 0)).toBe(true);
    const fills = paint('whiskbroom', { treatment: 'mechanism' }).ellipses().filter((e) => e.op === 'fill');
    expect(fills.map((e) => e.rot)).toEqual(expected);
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

describe('time gradient (atlas: hue runs along track)', () => {
  it('ramps hue from early to late in the pass', () => {
    const ctx = paint('pushbroom', { treatment: 'time-gradient' });
    const fills = ctx.fills();
    const hue = (s: string): number => Number(/hsla\((\d+\.?\d*)/.exec(s)![1]);
    expect(fills).toHaveLength(40);
    expect(hue(fills[0]!.fillStyle)).toBeCloseTo(196 + 92 / 40, 0);
    expect(hue(fills[39]!.fillStyle)).toBeCloseTo(288, 0);
  });
});

describe('quality gradient (atlas: cross-swath edge fade)', () => {
  it('fades the edges and scales the center by segment quality', () => {
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(fixtureStrip('flyby-swath')), WIDE, { treatment: 'quality-gradient' });
    const fills = ctx.fills().filter((f) => f.fillStyle.startsWith('lgrad('));
    expect(fills).toHaveLength(40);
    expect(fills[0]!.fillStyle).toMatch(/^lgrad\(0:rgba\(\d+,\d+,\d+,0\)/);
    const centerAlpha = (style: string): number => {
      const m = /0\.5:rgba\(\d+,\d+,\d+,([\d.]+)\)/.exec(style);
      return Number(m![1]);
    };
    const alphas = fills.map((f) => centerAlpha(f.fillStyle));
    expect(Math.max(...alphas)).toBeGreaterThan(Math.min(...alphas) * 1.5);
  });

  // The flyby fixture above only exercises the resolutionM metric; the fixtures
  // for the other two metrics carry a constant value, so their span is zero and
  // the scale collapses to a uniform 1, leaving the incidenceDeg and lookCount
  // arms of qualityAlphaScale unobserved. Drive them with a varying synthetic
  // quality so a regression in either metric or its ordering is caught.
  const scaleOver = (quality: ReadonlyArray<GeoSegment['quality']>): number[] => {
    const segments = quality.map((q, i) => ({ etSec: i, quality: q })) as unknown as GeoSegment[];
    const scale = qualityAlphaScale({ segments } as unknown as GeoStrip);
    return segments.map((s) => scale(s));
  };

  it('scales alpha by incidence: a steeper look is brighter (the SAR branch)', () => {
    const a = scaleOver([{ incidenceDeg: [20, 20] }, { incidenceDeg: [30, 30] }, { incidenceDeg: [45, 45] }]);
    expect(new Set(a).size).toBe(3); // genuinely varies, not the span-zero uniform 1
    expect(a[0]).toBeGreaterThan(a[1]!);
    expect(a[1]).toBeGreaterThan(a[2]!);
  });

  it('scales alpha by look count: more looks is brighter (the multi-angle branch)', () => {
    const a = scaleOver([{ lookCount: 1 }, { lookCount: 3 }, { lookCount: 7 }]);
    expect(new Set(a).size).toBe(3);
    expect(a[2]).toBeGreaterThan(a[1]!);
    expect(a[1]).toBeGreaterThan(a[0]!);
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
    // The guide underlay keeps the pass geometry visible while the trail decays.
    const guideStrokes = ctx.strokes().filter((s) => sameHue(s.strokeStyle, ATLAS_PALETTE.guide));
    expect(guideStrokes.length).toBeGreaterThanOrEqual(80);
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

  it('paints the trail committed even when the state field lags the clock', () => {
    // The demo re-emits states once per segment boundary; extrusion between
    // re-emissions sees stale planned states, and trails never repaint, so
    // a state-derived hue would bake amber into the trail (field report).
    const strip = fixtureStrip('pushbroom');
    const stale = { ...strip, segments: strip.segments.map((s) => ({ ...s, state: 'planned' as const })) };
    const ctx = new FakeCtx();
    paintTrailWindow(ctx, stripToGeo(stale), WIDE, { treatment: 'now-trail' }, -Infinity, Infinity);
    const fills = ctx.fills();
    expect(fills).toHaveLength(40);
    expect(fills.every((f) => sameHue(f.fillStyle, ATLAS_PALETTE.committed))).toBe(true);
  });

  it('rides the mechanism on the trail as the clock sweeps it', () => {
    const geo = stripToGeo(fixtureStrip('whiskbroom'));
    const ctx = new FakeCtx();
    paintTrailWindow(ctx, geo, WIDE, { treatment: 'now-trail' }, -Infinity, 5);
    expect(ctx.ellipses().length).toBeGreaterThan(30);
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

  it('paints point features on every visible world copy, not just quads', () => {
    // The field report: envelope quads crossing the antimeridian duplicated
    // onto both copies, but footprints and beads painted once and stopped
    // dead at the seam, flipping sides after a pan.
    const geo = stripToGeo(fixtureStrip('whiskbroom'));
    const single = new FakeCtx();
    paintStrip(single, geo, WIDE, { treatment: 'mechanism' });
    const doubled = new FakeCtx();
    paintStrip(doubled, geo, WIDE, { treatment: 'mechanism', worldCopies: [0, 360] });
    expect(doubled.ellipses().filter((e) => e.op === 'fill'))
      .toHaveLength(2 * single.ellipses().filter((e) => e.op === 'fill').length);
    expect(doubled.fills().length).toBe(2 * single.fills().length);
    const beadsSingle = new FakeCtx();
    paintStrip(beadsSingle, stripToGeo(fixtureStrip('profiler')), WIDE, { treatment: 'flat-fill' });
    const beadsDoubled = new FakeCtx();
    paintStrip(beadsDoubled, stripToGeo(fixtureStrip('profiler')), WIDE, { treatment: 'flat-fill', worldCopies: [0, 360] });
    expect(beadsDoubled.dots()).toHaveLength(2 * beadsSingle.dots().length);
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

describe('nowMarkerIndex: the static repaint gate (AGE-16)', () => {
  const geo = stripToGeo(syntheticStrip([
    [0, 0, 1, 0], [1, 0, 1, 10], [2, 0, 1, 20], [3, 0, 1, 30],
  ]));

  it('is -1 before the strip, tracks the last segment at or before the clock', () => {
    expect(nowMarkerIndex(geo, -5)).toBe(-1);
    expect(nowMarkerIndex(geo, 0)).toBe(0);
    expect(nowMarkerIndex(geo, 14)).toBe(1);
    expect(nowMarkerIndex(geo, 30)).toBe(3);
  });

  it('is stable between segment boundaries, so gated repaints skip', () => {
    expect(nowMarkerIndex(geo, 11)).toBe(nowMarkerIndex(geo, 19));
    expect(nowMarkerIndex(geo, 19)).not.toBe(nowMarkerIndex(geo, 21));
  });

  it('expires with paintNowLine: past 1.5 median steps the marker is gone', () => {
    expect(nowMarkerIndex(geo, 44)).toBe(3);
    expect(nowMarkerIndex(geo, 46)).toBe(-1);
    const ctx = new FakeCtx();
    paintNowLine(ctx, geo, WIDE, { treatment: 'flat-fill', nowEtSec: 46 });
    expect(ctx.ops).toHaveLength(0);
  });
});

describe('event footprint radius (ADR-0010)', () => {
  // A zero-width strip carrying one event; the ring is stroked, so it shows
  // up as a stroke op with shape 'arc' (the center dot is a fill arc).
  function eventStrip(radiusKm?: number) {
    const nadir = fromGeo(0, 0, 6371);
    const strip: Strip = {
      id: 'ev', body: 'EARTH', frame: 'ITRF93', instrumentId: 'test/limb',
      segments: [{
        etSec: 0, left: nadir, right: nadir, state: 'committed',
        sub: [{ kind: 'event', center: fromGeo(0.02, 0.02, 6371), ...(radiusKm !== undefined ? { radiusKm } : {}), eventId: 'e0' }],
      }],
      provenance: { authority: 'test', generatedBy: 'test' },
    };
    return stripToGeo(strip);
  }

  function ringRadiusPx(ctx: FakeCtx): number {
    const ring = ctx.strokes().find((o) => o.shape === 'arc')!;
    return Math.abs(ring.path[1]![0] - ring.path[0]![0]);
  }

  it('sizes the ring to radiusKm through the projector, proportional to the radius', () => {
    const wide = makeProjector(200); // px per degree; well above the floor
    const small = new FakeCtx();
    paintStrip(small, eventStrip(3.4), wide, { treatment: 'flat-fill' });
    const large = new FakeCtx();
    paintStrip(large, eventStrip(6.8), wide, { treatment: 'flat-fill' });
    // Twice the model radius, twice the projected ring (both clear of the floor).
    expect(ringRadiusPx(large) / ringRadiusPx(small)).toBeCloseTo(2, 5);
    expect(ringRadiusPx(small)).toBeGreaterThan(3);
  });

  it('sizes the ring through the projector, not just linearly in the radius', () => {
    // Same model radius, two projector scales: the ring must scale with the
    // projector (localScalePxPerKm), which a radius-only sizing would not do.
    const near = new FakeCtx();
    paintStrip(near, eventStrip(3.4), makeProjector(200), { treatment: 'flat-fill' });
    const far = new FakeCtx();
    paintStrip(far, eventStrip(3.4), makeProjector(400), { treatment: 'flat-fill' });
    expect(ringRadiusPx(near)).toBeGreaterThan(3);
    expect(ringRadiusPx(far) / ringRadiusPx(near)).toBeCloseTo(2, 5);
  });

  it('floors a tiny event so it stays legible', () => {
    const tiny = new FakeCtx();
    paintStrip(tiny, eventStrip(0.001), makeProjector(1), { treatment: 'flat-fill' });
    expect(ringRadiusPx(tiny)).toBeCloseTo(3, 9);
  });

  it('falls back to the fixed 5 px ring when the event declares no radius', () => {
    const ctx = new FakeCtx();
    paintStrip(ctx, eventStrip(undefined), makeProjector(200), { treatment: 'flat-fill' });
    expect(ringRadiusPx(ctx)).toBeCloseTo(5, 9);
  });
});

describe('sub-swath quilt rendering (AGE-09)', () => {
  // A wide swath carrying N sub-swaths per segment (SweepSAR DBF receive
  // beams / ScanSAR banding): the mechanism draws N-1 along-track dividers.
  function bandedStrip(bandCount: number): Strip {
    const segs = [0, 1, 2, 3].map((k): Strip['segments'][number] => ({
      etSec: k * 10,
      left: fromGeo(k * 0.4, -1, 6371),
      right: fromGeo(k * 0.4, 1, 6371),
      state: 'committed',
      sub: Array.from({ length: bandCount }, (_, index) => ({ kind: 'sub-swath' as const, index })),
    }));
    return {
      id: 'ss', body: 'EARTH', frame: 'ITRF93', instrumentId: 'test/sweepsar',
      segments: segs, provenance: { authority: 'test', generatedBy: 'test' },
    };
  }

  it('draws bandCount-1 dividers per connected segment pair for a divided swath', () => {
    const ctx = new FakeCtx();
    // makeProjector wide enough to clear the mechanism LOD gate.
    paintStrip(ctx, stripToGeo(bandedStrip(5)), makeProjector(60), { treatment: 'mechanism' });
    // Divider strokes are the extra along-track lines beyond the cross-track
    // hatching; count strokes whose endpoints span along track (dlat != 0).
    const alongLines = ctx.strokes().filter((o) => o.shape === 'path' && o.path.length === 2
      && Math.abs(o.path[0]![1] - o.path[1]![1]) > 1);
    // 3 connected pairs times 4 interior dividers, exactly: an over-count
    // (drawing bands rather than bands-1) would fail this.
    expect(alongLines.length).toBe(12);
  });

  it('draws no dividers for a single sub-swath per segment (a burst, not a divided swath)', () => {
    const single: Strip = {
      id: 'b', body: 'EARTH', frame: 'ITRF93', instrumentId: 'test/tops',
      segments: [0, 1].map((k) => ({
        etSec: k * 10, left: fromGeo(k * 0.4, -1, 6371), right: fromGeo(k * 0.4, 1, 6371),
        state: 'committed' as const, sub: [{ kind: 'sub-swath' as const, index: 0 }],
      })),
      provenance: { authority: 'test', generatedBy: 'test' },
    };
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(single), makeProjector(60), { treatment: 'mechanism' });
    const alongLines = ctx.strokes().filter((o) => o.shape === 'path' && o.path.length === 2
      && Math.abs(o.path[0]![1] - o.path[1]![1]) > 1);
    expect(alongLines.length).toBe(0);
  });
});

describe('sub-swath quilt: the review fixes', () => {
  function bandedMixed(bandCount: number, acquiringIndex: number): Strip {
    const segs = [0, 1, 2, 3].map((k): Strip['segments'][number] => ({
      etSec: k * 10,
      left: fromGeo(k * 0.4, -1, 6371),
      right: fromGeo(k * 0.4, 1, 6371),
      state: k < acquiringIndex ? 'committed' : k === acquiringIndex ? 'acquiring' : 'planned',
      sub: Array.from({ length: bandCount }, (_, index) => ({ kind: 'sub-swath' as const, index })),
    }));
    return {
      id: 'ss', body: 'EARTH', frame: 'ITRF93', instrumentId: 'test/sweepsar',
      segments: segs, provenance: { authority: 'test', generatedBy: 'test' },
    };
  }
  const alongLines = (ctx: FakeCtx) => ctx.strokes().filter((o) => o.shape === 'path' && o.path.length === 2
    && Math.abs(o.path[0]![1] - o.path[1]![1]) > 1);

  it('colors dividers by the later segment state (the quad-fill convention)', () => {
    // The pair (committed seg 0, acquiring seg 1) subdivides an acquiring quad.
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(bandedMixed(4, 1)), makeProjector(60), { treatment: 'mechanism' });
    // The divider drawn between seg0 and seg1 must use the acquiring hue.
    const acquiringDividers = alongLines(ctx).filter((o) => sameHue(o.strokeStyle, ATLAS_PALETTE.acquiring));
    expect(acquiringDividers.length).toBeGreaterThanOrEqual(3);
  });

  it('draws solid dividers regardless of the instrument dash pattern', () => {
    const ctx = new FakeCtx();
    paintStrip(ctx, stripToGeo(bandedMixed(4, 2)), makeProjector(60), { treatment: 'mechanism' });
    // Every along-track divider stroke carries the solid (empty) dash.
    for (const d of alongLines(ctx)) expect(d.dash).toEqual([]);
  });

  it('shows the sub-swath quilt under the now-trail treatment', () => {
    const ctx = new FakeCtx();
    // now-trail extrudes the whole strip when nowEtSec is the last epoch.
    paintStrip(ctx, stripToGeo(bandedMixed(5, 3)), makeProjector(60), { treatment: 'now-trail', nowEtSec: 30 });
    expect(alongLines(ctx).length).toBeGreaterThanOrEqual(8);
  });
});
