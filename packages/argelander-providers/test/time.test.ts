import { describe, expect, it } from 'vitest';
import { deltaAtSeconds, etToUtcUnix, gmstRad, utcUnixToEt } from '../src/time.js';

const TWO_PI = 2 * Math.PI;

describe('rendering-grade time scales (ADR-0008)', () => {
  it('places Et zero at 2000-01-01T11:58:55.816 UTC', () => {
    expect(utcUnixToEt(946727935.816)).toBeCloseTo(0, 6);
  });

  it('uses the post-2017 constant offset of 69.184 s', () => {
    const unix = Date.UTC(2020, 0, 1) / 1000;
    expect(utcUnixToEt(unix) - (unix - 946728000)).toBeCloseTo(69.184, 6);
  });

  it('steps the leap table at known boundaries', () => {
    expect(deltaAtSeconds(Date.UTC(2016, 11, 31) / 1000)).toBe(36);
    expect(deltaAtSeconds(Date.UTC(2017, 0, 1) / 1000)).toBe(37);
    expect(deltaAtSeconds(Date.UTC(2000, 5, 27) / 1000)).toBe(32);
  });

  it('round-trips Et and UTC across leap boundaries', () => {
    for (const unix of [Date.UTC(1999, 3, 1), Date.UTC(2012, 6, 1), Date.UTC(2026, 0, 15)]) {
      const s = unix / 1000;
      expect(etToUtcUnix(utcUnixToEt(s))).toBeCloseTo(s, 9);
    }
  });

  it('anchors GMST at the J2000 epoch to 280.4606184 degrees', () => {
    const expected = (280.46061837504 * Math.PI) / 180;
    expect(gmstRad(2451545.0)).toBeCloseTo(expected, 9);
  });

  it('advances GMST by one sidereal excess per UT1 day', () => {
    const jd = 2460500.5;
    let advance = (gmstRad(jd + 1) - gmstRad(jd)) % TWO_PI;
    if (advance < 0) advance += TWO_PI;
    expect(advance).toBeCloseTo(TWO_PI * 0.0027379093, 6);
  });
});
