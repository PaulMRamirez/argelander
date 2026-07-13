/**
 * Rendering-grade time scales for standalone providers (ADR-0008). Et is TDB
 * seconds past J2000 per SPEC-PROVIDER; here TDB is taken as TT (the periodic
 * TDB-TT terms stay under 2 ms) and UTC converts through a static leap-second
 * table. UT1 is approximated by UTC unless a delta-UT1 offset is supplied.
 */
import type { Et } from 'argelander-core';

/** 2000-01-01T12:00:00 UTC as unix seconds; J2000 TT is 64.184 s earlier on the UTC scale. */
const J2000_UNIX_S = 946728000;
const TT_MINUS_TAI_S = 32.184;

/** [year, monthIndex, TAI-UTC seconds effective from that UTC month start]. */
const LEAP_STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1972, 0, 10], [1972, 6, 11], [1973, 0, 12], [1974, 0, 13], [1975, 0, 14],
  [1976, 0, 15], [1977, 0, 16], [1978, 0, 17], [1979, 0, 18], [1980, 0, 19],
  [1981, 6, 20], [1982, 6, 21], [1983, 6, 22], [1985, 6, 23], [1988, 0, 24],
  [1990, 0, 25], [1991, 0, 26], [1992, 6, 27], [1993, 6, 28], [1994, 6, 29],
  [1996, 0, 30], [1997, 6, 31], [1999, 0, 32], [2006, 0, 33], [2009, 0, 34],
  [2012, 6, 35], [2015, 6, 36], [2017, 0, 37],
];

const LEAP_TABLE: ReadonlyArray<readonly [number, number]> =
  LEAP_STEPS.map(([y, m, d]) => [Date.UTC(y, m, 1) / 1000, d] as const);

/** TAI minus UTC in effect at a UTC instant given as unix seconds. */
export function deltaAtSeconds(utcUnixSec: number): number {
  for (let i = LEAP_TABLE.length - 1; i >= 0; i--) {
    const [at, value] = LEAP_TABLE[i]!;
    if (utcUnixSec >= at) return value;
  }
  return LEAP_TABLE[0]![1];
}

/** UTC (unix seconds, calendar encoding) to Et. */
export function utcUnixToEt(utcUnixSec: number): Et {
  return utcUnixSec - J2000_UNIX_S + TT_MINUS_TAI_S + deltaAtSeconds(utcUnixSec);
}

/**
 * Et to UTC unix seconds. `base` is the unix instant plus its leap offset;
 * the offset is iterated to a fixed point so the leap-table lookup lands on
 * the true instant. A single pass seeded from a fixed year-2000 offset lands
 * on the wrong side of a boundary (and drops a whole second) for an epoch in
 * the last few seconds before a leap step, once the era's offset has drifted
 * from that seed; the fixed point removes that. It stays off by a second only
 * inside a true inserted leap second, an inherent UTC ambiguity.
 */
export function etToUtcUnix(et: Et): number {
  const base = et + J2000_UNIX_S - TT_MINUS_TAI_S;
  let unix = base - deltaAtSeconds(base);
  for (let i = 0; i < 4; i++) {
    const refined = base - deltaAtSeconds(unix);
    if (refined === unix) break;
    unix = refined;
  }
  return unix;
}

/** UT1 Julian date at an Et, with UT1 approximated by UTC plus deltaUt1Sec. */
export function jdUt1FromEt(et: Et, deltaUt1Sec = 0): number {
  return (etToUtcUnix(et) + deltaUt1Sec) / 86400 + 2440587.5;
}

const TWO_PI = 2 * Math.PI;
const DEG2RAD = Math.PI / 180;

/** Greenwich mean sidereal time, IAU 1982 (Vallado gstime), radians in [0, 2 pi). */
export function gmstRad(jdUt1: number): number {
  const tut1 = (jdUt1 - 2451545.0) / 36525.0;
  let temp = -6.2e-6 * tut1 * tut1 * tut1 + 0.093104 * tut1 * tut1
    + (876600.0 * 3600.0 + 8640184.812866) * tut1 + 67310.54841;
  temp = ((temp * DEG2RAD) / 240.0) % TWO_PI;
  if (temp < 0) temp += TWO_PI;
  return temp;
}

/** GMST at an Et directly, radians. */
export function gmstRadAtEt(et: Et, deltaUt1Sec = 0): number {
  return gmstRad(jdUt1FromEt(et, deltaUt1Sec));
}

/** TLE calendar epoch (full year, fractional UTC day of year) to unix seconds. */
export function yearDayToUtcUnix(fullYear: number, dayOfYear: number): number {
  return Date.UTC(fullYear, 0, 1) / 1000 + (dayOfYear - 1) * 86400;
}
