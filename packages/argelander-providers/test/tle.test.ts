import { describe, expect, it } from 'vitest';
import { parseTle } from '../src/tle.js';

const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

describe('TLE parsing', () => {
  it('extracts the SGP4 element set', () => {
    const tle = parseTle(L1, L2, ' VANGUARD 1 ');
    expect(tle.satnum).toBe('00005');
    expect(tle.name).toBe('VANGUARD 1');
    expect(tle.epochYear).toBe(2000);
    expect(tle.epochDayOfYear).toBeCloseTo(179.78495062, 9);
    expect(tle.ecc).toBeCloseTo(0.1859667, 12);
    expect(tle.bstar).toBeCloseTo(0.28098e-4, 12);
    expect(tle.inclRad).toBeCloseTo((34.2682 * Math.PI) / 180, 12);
    expect(tle.raanRad).toBeCloseTo((348.7242 * Math.PI) / 180, 12);
    expect(tle.argpRad).toBeCloseTo((331.7664 * Math.PI) / 180, 12);
    expect(tle.meanAnomalyRad).toBeCloseTo((19.3264 * Math.PI) / 180, 12);
    expect(tle.meanMotionRadPerMin).toBeCloseTo((10.82419157 * 2 * Math.PI) / 1440, 12);
  });

  it('converts the epoch to UTC and Et', () => {
    const tle = parseTle(L1, L2);
    const utc = Date.UTC(2000, 5, 27, 18, 50, 19, 733) / 1000;
    expect(Math.abs(tle.epochUtcUnixSec - utc)).toBeLessThan(0.001);
    expect(tle.epochEt - tle.epochUtcUnixSec + 946728000).toBeCloseTo(64.184, 6);
  });

  it('parses negative and zero assumed-decimal exponent fields', () => {
    const l1 = '1 06251U 62025E   06176.82412014  .00008885  00000-0  12808-3 0  3985';
    const l2 = '2 06251  58.0579  54.0425 0030035 139.1568 221.1854 15.56387291  6774';
    expect(parseTle(l1, l2).bstar).toBeCloseTo(0.12808e-3, 15);
  });

  it('rejects a corrupted checksum', () => {
    const bad = `${L1.slice(0, 68)}9`;
    expect(() => parseTle(bad, L2)).toThrow(/checksum/);
  });

  it('rejects a corrupted field through the checksum', () => {
    const bad = L1.replace('179.78495062', '179.78495063');
    expect(() => parseTle(bad, L2)).toThrow(/checksum/);
  });

  it('rejects mismatched catalog numbers, bad markers, and short lines', () => {
    const other = '2 00006  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413668';
    expect(() => parseTle(L1, other)).toThrow(/catalog numbers/);
    expect(() => parseTle(L2, L2)).toThrow(/line markers/);
    expect(() => parseTle(L1.slice(0, 60), L2)).toThrow(/69 characters/);
  });
});
