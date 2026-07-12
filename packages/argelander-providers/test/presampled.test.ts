import { describe, expect, it } from 'vitest';
import { CoverageRefusalError, decodeQuat, decodeState } from 'argelander-core';
import { PresampledProvider, parsePresampledCsv } from '../src/presampled.js';
import type { PresampledQuatTable, PresampledStateTable } from '../src/presampled.js';

const R_KM = 7000;
const OMEGA = 1.1e-3;

/** Circular equatorial orbit sampled every 60 s over one hour, MARS body-fixed pretend frame. */
function circularTable(): PresampledStateTable {
  const n = 61;
  const epochs = new Float64Array(n);
  const states = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    const t = i * 60;
    epochs[i] = t;
    const a = OMEGA * t;
    states[i * 6] = R_KM * Math.cos(a);
    states[i * 6 + 1] = R_KM * Math.sin(a);
    states[i * 6 + 2] = 0;
    states[i * 6 + 3] = -R_KM * OMEGA * Math.sin(a);
    states[i * 6 + 4] = R_KM * OMEGA * Math.cos(a);
    states[i * 6 + 5] = 0;
  }
  return { body: 'MRO', observer: 'MARS', frame: 'IAU_MARS', correction: 'NONE', epochs, states };
}

function analytic(t: number): { r: number[]; v: number[] } {
  const a = OMEGA * t;
  return {
    r: [R_KM * Math.cos(a), R_KM * Math.sin(a), 0],
    v: [-R_KM * OMEGA * Math.sin(a), R_KM * OMEGA * Math.cos(a), 0],
  };
}

const QUERY = { observer: 'MARS', frame: 'IAU_MARS', correction: 'NONE' as const };

describe('PresampledProvider against the frozen seam (AGE-04, AGE-06)', () => {
  it('interpolates between samples to the analytic orbit', async () => {
    const p = new PresampledProvider([circularTable()]);
    const epochs = [90.5, 1234.567, 3010.99];
    const batch = await p.states({ targets: ['MRO'], epochs, ...QUERY });
    for (let i = 0; i < epochs.length; i++) {
      const s = decodeState(batch, 0, i);
      const truth = analytic(epochs[i]!);
      for (let ax = 0; ax < 3; ax++) {
        expect(Math.abs(s.positionKm[ax]! - truth.r[ax]!)).toBeLessThan(1e-3);
        expect(Math.abs(s.velocityKmS[ax]! - truth.v[ax]!)).toBeLessThan(1e-3);
      }
    }
  });

  it('returns exact table samples at sampled epochs, with geometric light time', async () => {
    const p = new PresampledProvider([circularTable()]);
    const batch = await p.states({ targets: ['MRO'], epochs: [1800], ...QUERY });
    const s = decodeState(batch, 0, 0);
    const truth = analytic(1800);
    expect(s.positionKm[0]).toBe(truth.r[0]!);
    expect(s.positionKm[1]).toBe(truth.r[1]!);
    expect(batch.lightTimes[0]).toBeCloseTo(R_KM / 299792.458, 12);
  });

  it('refuses extrapolation with the table span as the covered window', async () => {
    const p = new PresampledProvider([circularTable()]);
    const err = await p.states({ targets: ['MRO'], epochs: [1800, 3601], ...QUERY })
      .then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(CoverageRefusalError);
    const refusal = err as CoverageRefusalError;
    expect(refusal.body).toBe('MRO');
    expect(refusal.covered).toEqual([{ start: 0, end: 3600 }]);
    await expect(p.coverage('MRO')).resolves.toEqual([{ start: 0, end: 3600 }]);
  });

  it('refuses frame, observer, and correction mismatches rather than relabeling', async () => {
    const p = new PresampledProvider([circularTable()]);
    const base = { targets: ['MRO'], epochs: [1800] };
    await expect(p.states({ ...base, ...QUERY, frame: 'J2000' })).rejects.toThrow(/sampled in 'IAU_MARS'/);
    await expect(p.states({ ...base, ...QUERY, observer: 'PHOBOS' })).rejects.toThrow(/sampled from 'MARS'/);
    await expect(p.states({ ...base, ...QUERY, correction: 'LT' })).rejects.toThrow(/sampled with 'NONE'/);
    await expect(p.states({ ...base, ...QUERY, targets: ['CASSINI'] })).rejects.toThrow(/unknown target/);
  });

  it('serves orientation by slerp over a quaternion table', async () => {
    const spinRate = 2e-4;
    const n = 5;
    const epochs = new Float64Array(n);
    const quats = new Float64Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = i * 500;
      epochs[i] = t;
      quats[i * 4] = Math.cos((spinRate * t) / 2);
      quats[i * 4 + 3] = Math.sin((spinRate * t) / 2);
    }
    const table: PresampledQuatTable = {
      body: 'MRO', frame: 'IAU_MARS', bodyFrame: 'MRO_SPACECRAFT', epochs, quats,
    };
    const p = new PresampledProvider([circularTable()], [table]);
    const batch = await p.orientation('MRO', 'IAU_MARS', [137, 500, 1750]);
    expect(batch.bodyFrame).toBe('MRO_SPACECRAFT');
    for (const [i, t] of [137, 500, 1750].entries()) {
      const q = decodeQuat(batch, i);
      expect(q[0]).toBeCloseTo(Math.cos((spinRate * t) / 2), 12);
      expect(q[3]).toBeCloseTo(Math.sin((spinRate * t) / 2), 12);
      expect(q[1]).toBe(0);
      expect(q[2]).toBe(0);
    }
    await expect(p.orientation('MRO', 'IAU_MARS', [9000])).rejects.toThrow(CoverageRefusalError);
    await expect(p.orientation('MRO', 'J2000', [500])).rejects.toThrow(/sampled from 'IAU_MARS'/);
    await expect(p.orientation('CASSINI', 'IAU_MARS', [500])).rejects.toThrow(/no quaternion table/);
  });

  it('validates tables at construction', () => {
    const good = circularTable();
    expect(() => new PresampledProvider([])).toThrow(/at least one/);
    expect(() => new PresampledProvider([good, good])).toThrow(/duplicate/);
    expect(() => new PresampledProvider([{ ...good, epochs: Float64Array.from([0, 0, 60]) }]))
      .toThrow(/strictly increasing/);
    expect(() => new PresampledProvider([{ ...good, states: good.states.subarray(0, 12) }]))
      .toThrow(/expected/);
    expect(() => new PresampledProvider([{
      ...good, epochs: Float64Array.from([0]), states: new Float64Array(6),
    }])).toThrow(/at least two samples/);
  });

  it('ingests the CSV column format', async () => {
    const csv = [
      '# MRO pre-sampled states, rendering grade',
      'et,x,y,z,vx,vy,vz',
      '0,7000,0,0,0,7.7,0',
      '60,6998.5,461.9,0,-0.51,7.69,0',
      '120,6994,923.5,0,-1.02,7.68,0',
    ].join('\n');
    const table = parsePresampledCsv(csv, {
      body: 'MRO', observer: 'MARS', frame: 'IAU_MARS', correction: 'NONE',
    });
    expect(table.epochs.length).toBe(3);
    expect(table.states[7]).toBe(461.9);
    expect(table.lightTimes).toBeUndefined();
    const p = new PresampledProvider([table]);
    const batch = await p.states({ targets: ['MRO'], epochs: [60], ...QUERY });
    expect(decodeState(batch, 0, 0).positionKm[1]).toBe(461.9);
  });

  it('ingests the optional light-time column and refuses malformed rows', () => {
    const withLt = 'et,x,y,z,vx,vy,vz,lt\n0,1,2,3,4,5,6,0.5\n60,1,2,3,4,5,6,0.6';
    const table = parsePresampledCsv(withLt, {
      body: 'X', observer: 'MARS', frame: 'IAU_MARS', correction: 'LT',
    });
    expect([...table.lightTimes!]).toEqual([0.5, 0.6]);
    const meta = { body: 'X', observer: 'MARS', frame: 'IAU_MARS', correction: 'NONE' as const };
    expect(() => parsePresampledCsv('x,y\n1,2', meta)).toThrow(/expected header/);
    expect(() => parsePresampledCsv('et,x,y,z,vx,vy,vz\n1,2,3', meta)).toThrow(/line 2: expected 7 columns/);
    expect(() => parsePresampledCsv('et,x,y,z,vx,vy,vz\n1,2,3,4,5,six,7', meta)).toThrow(/non-numeric/);
    expect(() => parsePresampledCsv('\n# only comments\n', meta)).toThrow(/no header/);
  });
});
