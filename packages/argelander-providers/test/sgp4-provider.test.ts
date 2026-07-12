import { describe, expect, it } from 'vitest';
import { CoverageRefusalError, decodeState } from 'argelander-core';
import type { Quat } from 'argelander-core';
import { Sgp4Provider } from '../src/sgp4-provider.js';
import { EARTH_ROTATION_RAD_S } from '../src/earth.js';
import { parseTle } from '../src/tle.js';

const TLE_00005 = {
  line1: '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  line2: '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
  name: 'VANGUARD 1',
};
const TLE_06251 = {
  line1: '1 06251U 62025E   06176.82412014  .00008885  00000-0  12808-3 0  3985',
  line2: '2 06251  58.0579  54.0425 0030035 139.1568 221.1854 15.56387291  6774',
};

const EPOCH_5 = parseTle(TLE_00005.line1, TLE_00005.line2).epochEt;

function provider(): Sgp4Provider {
  return new Sgp4Provider([TLE_00005, TLE_06251]);
}

/** SPICE q2m: scalar-first quaternion to the rotation matrix it encodes. */
function q2m(q: Quat): number[][] {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
}

function apply(m: number[][], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
    m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
    m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
  ];
}

describe('Sgp4Provider against the frozen seam (AGE-04, AGE-19)', () => {
  it('answers TEME states matching the verification corpus at epoch', async () => {
    const batch = await provider().states({
      targets: ['00005'],
      observer: 'EARTH',
      frame: 'TEME',
      correction: 'NONE',
      epochs: [EPOCH_5],
    });
    const s = decodeState(batch, 0, 0);
    expect(s.positionKm[0]).toBeCloseTo(7022.46529266, 6);
    expect(s.positionKm[1]).toBeCloseTo(-1400.08296755, 6);
    expect(s.positionKm[2]).toBeCloseTo(0.03995155, 6);
    expect(s.velocityKmS[0]).toBeCloseTo(1.893841015, 9);
  });

  it('expands ranges and fills the flat block layout with light times', async () => {
    const step = 360 * 60;
    const batch = await provider().states({
      targets: ['00005', '5'],
      observer: '399',
      frame: 'TEME',
      correction: 'NONE',
      epochs: { start: EPOCH_5, end: EPOCH_5 + 2 * step, step },
    });
    expect(batch.epochs.length).toBe(3);
    expect(batch.states.length).toBe(2 * 3 * 6);
    expect(batch.lightTimes.length).toBe(2 * 3);
    const a = decodeState(batch, 0, 1);
    const b = decodeState(batch, 1, 1);
    expect(a).toEqual(b);
    expect(a.positionKm[0]).toBeCloseTo(-7154.03120202, 5);
    const r = Math.hypot(...a.positionKm);
    expect(batch.lightTimes[1]).toBeCloseTo(r / 299792.458, 12);
  });

  it('serves the earth-fixed frame consistently with its own orientation quaternions', async () => {
    const p = provider();
    const epochs = [EPOCH_5, EPOCH_5 + 3000];
    const query = { targets: ['00005'], observer: 'EARTH', correction: 'NONE' as const, epochs };
    const teme = await p.states({ ...query, frame: 'TEME' });
    const itrf = await p.states({ ...query, frame: 'ITRF93' });
    const spin = await p.orientation('EARTH', 'TEME', epochs);
    expect(spin.bodyFrame).toBe('ITRF93');
    for (let i = 0; i < epochs.length; i++) {
      const m = q2m([spin.quats[i * 4]!, spin.quats[i * 4 + 1]!, spin.quats[i * 4 + 2]!, spin.quats[i * 4 + 3]!]);
      const st = decodeState(teme, 0, i);
      const sf = decodeState(itrf, 0, i);
      const rRot = apply(m, st.positionKm);
      const vRot = apply(m, st.velocityKmS);
      for (let ax = 0; ax < 3; ax++) {
        expect(sf.positionKm[ax]).toBeCloseTo(rRot[ax]!, 9);
      }
      expect(sf.velocityKmS[0]).toBeCloseTo(vRot[0]! + EARTH_ROTATION_RAD_S * sf.positionKm[1]!, 12);
      expect(sf.velocityKmS[1]).toBeCloseTo(vRot[1]! - EARTH_ROTATION_RAD_S * sf.positionKm[0]!, 12);
      expect(sf.velocityKmS[2]).toBeCloseTo(vRot[2]!, 12);
    }
  });

  it('reports earth-fixed velocity as the time derivative of earth-fixed position', async () => {
    const et = EPOCH_5 + 1234;
    const batch = await provider().states({
      targets: ['00005'],
      observer: 'EARTH',
      frame: 'ITRF93',
      correction: 'NONE',
      epochs: [et - 1, et, et + 1],
    });
    const back = decodeState(batch, 0, 0);
    const mid = decodeState(batch, 0, 1);
    const fwd = decodeState(batch, 0, 2);
    for (let ax = 0; ax < 3; ax++) {
      const fd = (fwd.positionKm[ax]! - back.positionKm[ax]!) / 2;
      expect(Math.abs(fd - mid.velocityKmS[ax]!)).toBeLessThan(1e-4);
    }
  });

  it('refuses epochs outside the TLE fence with the structured refusal', async () => {
    const p = provider();
    const late = EPOCH_5 + 8 * 86400;
    const err = await p.states({
      targets: ['00005'], observer: 'EARTH', frame: 'TEME', correction: 'NONE', epochs: [EPOCH_5, late],
    }).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(CoverageRefusalError);
    const refusal = err as CoverageRefusalError;
    expect(refusal.body).toBe('00005');
    expect(refusal.requested).toEqual({ start: EPOCH_5, end: late });
    expect(refusal.covered).toEqual([{ start: EPOCH_5 - 7 * 86400, end: EPOCH_5 + 7 * 86400 }]);
  });

  it('refuses atomically when any target lacks coverage', async () => {
    await expect(provider().states({
      targets: ['00005', '06251'], observer: 'EARTH', frame: 'TEME', correction: 'NONE', epochs: [EPOCH_5],
    })).rejects.toThrow(CoverageRefusalError);
  });

  it('refuses oversized queries naming the ceiling', async () => {
    await expect(provider().states({
      targets: ['00005'],
      observer: 'EARTH',
      frame: 'TEME',
      correction: 'NONE',
      epochs: { start: EPOCH_5, end: EPOCH_5 + 65536, step: 1 },
    })).rejects.toThrow(/65536/);
  });

  it('advertises the fence through coverage()', async () => {
    const windows = await provider().coverage('VANGUARD 1');
    expect(windows).toEqual([{ start: EPOCH_5 - 7 * 86400, end: EPOCH_5 + 7 * 86400 }]);
    const tight = new Sgp4Provider([TLE_00005], { fenceSec: 60 });
    await expect(tight.coverage('5')).resolves.toEqual([{ start: EPOCH_5 - 60, end: EPOCH_5 + 60 }]);
  });

  it('refuses what it cannot honestly serve', async () => {
    const p = provider();
    const base = { observer: 'EARTH', frame: 'TEME', correction: 'NONE' as const, epochs: [EPOCH_5] };
    await expect(p.states({ ...base, targets: ['NOT-A-SAT'] })).rejects.toThrow(/unknown target/);
    await expect(p.states({ ...base, targets: ['00005'], observer: 'MOON' })).rejects.toThrow(/geocentric/);
    await expect(p.states({ ...base, targets: ['00005'], correction: 'LT' })).rejects.toThrow(/geometric/);
    await expect(p.states({ ...base, targets: ['00005'], frame: 'J2000' })).rejects.toThrow(/frame 'J2000' unsupported/);
    await expect(p.orientation('00005', 'TEME', [EPOCH_5])).rejects.toThrow(/no attitude/);
    await expect(p.orientation('EARTH', 'J2000', [EPOCH_5])).rejects.toThrow(/unsupported/);
  });
});
