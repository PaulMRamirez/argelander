/**
 * passStrips: the pass orchestration helper (ADR-0009). A fake provider
 * serving a circular track verifies the query-per-window loop, the shared
 * passId with honest gaps, the bilateral decomposition, and the provenance
 * defaults, without any real propagation.
 */
import { describe, expect, it } from 'vitest';
import { passStrips } from '../src/pass.js';
import type { StateBatch, StateProvider, StateQuery } from '../src/types.js';

const RADIUS_KM = 6371;

function circularBatch(query: StateQuery): StateBatch {
  const spec = query.epochs;
  if (!('start' in spec)) throw new Error('test provider expects a window spec');
  const n = Math.floor((spec.end - spec.start) / spec.step) + 1;
  const epochs = new Float64Array(n);
  const states = new Float64Array(n * 6);
  const a = RADIUS_KM + 700;
  const omega = (2 * Math.PI) / 5900;
  for (let i = 0; i < n; i++) {
    const t = spec.start + i * spec.step;
    epochs[i] = t;
    const u = omega * t;
    states[i * 6 + 0] = a * Math.cos(u);
    states[i * 6 + 1] = 0;
    states[i * 6 + 2] = a * Math.sin(u);
    states[i * 6 + 3] = -a * omega * Math.sin(u);
    states[i * 6 + 4] = 0;
    states[i * 6 + 5] = a * omega * Math.cos(u);
  }
  return {
    targets: query.targets,
    observer: query.observer,
    frame: query.frame,
    correction: query.correction,
    epochs,
    states,
    lightTimes: new Float64Array(n),
  };
}

function fakeProvider(): StateProvider & { queries: StateQuery[] } {
  const queries: StateQuery[] = [];
  return {
    id: 'fake-orbit',
    queries,
    async states(query: StateQuery): Promise<StateBatch> {
      queries.push(query);
      return circularBatch(query);
    },
    async orientation(): Promise<never> {
      throw new Error('not served');
    },
  };
}

const GEOMETRY = {
  target: 'SAT',
  observer: 'EARTH',
  frame: 'ITRF93',
  bodyRadiusKm: RADIUS_KM,
  instrumentId: 'SAT/imager',
  generatedBy: 'pass.test',
  stepSec: 15,
} as const;

describe('passStrips (ADR-0009, AGE-04)', () => {
  it('queries once per window and returns one strip each, sharing the passId', async () => {
    const provider = fakeProvider();
    const strips = await passStrips(provider, {
      ...GEOMETRY,
      swathHalfWidthKm: 50,
      windows: [[0, 300], [900, 1200]],
    });
    expect(provider.queries).toHaveLength(2);
    expect(strips).toHaveLength(2);
    expect(strips.map((s) => s.id)).toEqual(['SAT-imager-pass-0-w0', 'SAT-imager-pass-0-w1']);
    expect(new Set(strips.map((s) => s.passId))).toEqual(new Set(['pass-0']));
    // The gap between windows is real: no segment falls inside it.
    const epochs = strips.flatMap((s) => s.segments.map((seg) => seg.etSec));
    expect(epochs.some((e) => e > 300 && e < 900)).toBe(false);
  });

  it('defaults provenance to the provider id (AGE-20) and honors overrides', async () => {
    const provider = fakeProvider();
    const [strip] = await passStrips(provider, {
      ...GEOMETRY,
      windows: [[0, 300]],
    });
    expect(strip!.provenance.authority).toBe('fake-orbit');
    const [named] = await passStrips(provider, {
      ...GEOMETRY,
      authority: 'named-authority',
      passId: 'pass-7',
      idPrefix: 'custom',
      windows: [[0, 300]],
    });
    expect(named!.provenance.authority).toBe('named-authority');
    expect(named!.passId).toBe('pass-7');
    expect(named!.id).toBe('custom-w0');
  });

  it('folds the passId into the default id so two passes do not collide', async () => {
    const provider = fakeProvider();
    const [passA] = await passStrips(provider, { ...GEOMETRY, passId: 'orbit-1', windows: [[0, 300]] });
    const [passB] = await passStrips(provider, { ...GEOMETRY, passId: 'orbit-2', windows: [[0, 300]] });
    expect(passA!.id).toBe('SAT-imager-orbit-1-w0');
    expect(passB!.id).toBe('SAT-imager-orbit-2-w0');
    expect(passA!.id).not.toBe(passB!.id);
  });

  it('decomposes the bilateral pair into two side-looking strips per window', async () => {
    const provider = fakeProvider();
    const strips = await passStrips(provider, {
      ...GEOMETRY,
      bilateralKm: { gapKm: 10, outerKm: 60 },
      windows: [[0, 300]],
    });
    expect(provider.queries).toHaveLength(1);
    expect(strips.map((s) => s.id)).toEqual(['SAT-imager-pass-0-w0-left', 'SAT-imager-pass-0-w0-right']);
    expect(strips[0]!.passId).toBe(strips[1]!.passId);
    // Both ribbons are offset from nadir; neither contains it.
    for (const strip of strips) {
      for (const seg of strip.segments) {
        expect(seg.left).not.toEqual(seg.right);
      }
    }
  });

  it('refuses bilateral combined with single-strip postures, and empty windows', async () => {
    const provider = fakeProvider();
    await expect(passStrips(provider, {
      ...GEOMETRY,
      bilateralKm: { gapKm: 10, outerKm: 60 },
      swathHalfWidthKm: 40,
      windows: [[0, 300]],
    })).rejects.toThrow(/exclusive/);
    await expect(passStrips(provider, { ...GEOMETRY, windows: [] })).rejects.toThrow(/at least one window/);
  });

  it('propagates provider refusals untouched: isolation is host policy', async () => {
    const provider = fakeProvider();
    provider.states = async () => {
      throw new RangeError('outside the fence');
    };
    await expect(passStrips(provider, { ...GEOMETRY, windows: [[0, 300]] })).rejects.toThrow('outside the fence');
  });
});
