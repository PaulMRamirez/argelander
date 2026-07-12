/**
 * Two-line element parsing (AGE-04). Strict: line markers, matching catalog
 * numbers, and the mod-10 checksum are all enforced, because a silently
 * misparsed TLE renders as a confidently wrong footprint. Only the fields
 * SGP4 consumes are extracted; ndot and nddot are ignored by the model.
 */
import type { Et } from 'argelander-core';
import { utcUnixToEt, yearDayToUtcUnix } from './time.js';

export interface Tle {
  /** Catalog number, trimmed, leading zeros preserved ('00005'). */
  readonly satnum: string;
  /** Optional line-0 style name, trimmed. */
  readonly name?: string;
  readonly epochYear: number;
  /** Fractional UTC day of year, 1-based. */
  readonly epochDayOfYear: number;
  readonly epochUtcUnixSec: number;
  readonly epochEt: Et;
  /** Drag term, 1 / earth radii. */
  readonly bstar: number;
  readonly inclRad: number;
  readonly raanRad: number;
  readonly ecc: number;
  readonly argpRad: number;
  readonly meanAnomalyRad: number;
  /** Kozai mean motion, radians per minute. */
  readonly meanMotionRadPerMin: number;
}

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

function checksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = line[i]!;
    if (ch >= '0' && ch <= '9') sum += ch.charCodeAt(0) - 48;
    else if (ch === '-') sum += 1;
  }
  return sum % 10;
}

function requireChecksum(line: string, which: string): void {
  const declared = line.charCodeAt(68) - 48;
  const computed = checksum(line);
  if (declared !== computed) {
    throw new Error(`TLE ${which} checksum mismatch: line declares ${line[68]}, computed ${computed}`);
  }
}

/** Assumed-decimal exponent field, e.g. ' 28098-4' is 0.28098e-4. */
function parseExpField(field: string, label: string): number {
  const t = field.trim();
  const m = /^([+-]?)(\d{5})([+-]\d)$/.exec(t);
  if (!m) throw new Error(`malformed TLE ${label} field "${field}"`);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * Number(m[2]) * 1e-5 * 10 ** Number(m[3]);
}

function parseFixed(field: string, label: string): number {
  const value = Number(field.trim());
  if (!Number.isFinite(value)) throw new Error(`malformed TLE ${label} field "${field}"`);
  return value;
}

export function parseTle(line1: string, line2: string, name?: string): Tle {
  if (line1.length < 69 || line2.length < 69) {
    throw new Error(`TLE lines must be at least 69 characters (got ${line1.length} and ${line2.length})`);
  }
  if (line1[0] !== '1' || line2[0] !== '2') {
    throw new Error(`TLE line markers must be '1' and '2' (got '${line1[0]}' and '${line2[0]}')`);
  }
  requireChecksum(line1, 'line 1');
  requireChecksum(line2, 'line 2');

  const satnum = line1.slice(2, 7).trim();
  const satnum2 = line2.slice(2, 7).trim();
  if (satnum !== satnum2) {
    throw new Error(`TLE catalog numbers disagree between lines: '${satnum}' vs '${satnum2}'`);
  }

  const yy = parseFixed(line1.slice(18, 20), 'epoch year');
  const epochYear = yy < 57 ? 2000 + yy : 1900 + yy;
  const epochDayOfYear = parseFixed(line1.slice(20, 32), 'epoch day');
  const bstar = parseExpField(line1.slice(53, 61), 'bstar');

  const inclDeg = parseFixed(line2.slice(8, 16), 'inclination');
  const raanDeg = parseFixed(line2.slice(17, 25), 'RAAN');
  const ecc = parseFixed(`0.${line2.slice(26, 33).trim()}`, 'eccentricity');
  const argpDeg = parseFixed(line2.slice(34, 42), 'argument of perigee');
  const maDeg = parseFixed(line2.slice(43, 51), 'mean anomaly');
  const meanMotionRevDay = parseFixed(line2.slice(52, 63), 'mean motion');

  if (!(ecc >= 0 && ecc < 1)) throw new Error(`TLE eccentricity ${ecc} outside [0, 1)`);
  if (!(meanMotionRevDay > 0)) throw new Error(`TLE mean motion ${meanMotionRevDay} must be positive`);

  const epochUtcUnixSec = yearDayToUtcUnix(epochYear, epochDayOfYear);
  const tle: Tle = {
    satnum,
    epochYear,
    epochDayOfYear,
    epochUtcUnixSec,
    epochEt: utcUnixToEt(epochUtcUnixSec),
    bstar,
    inclRad: inclDeg * DEG2RAD,
    raanRad: raanDeg * DEG2RAD,
    ecc,
    argpRad: argpDeg * DEG2RAD,
    meanAnomalyRad: maDeg * DEG2RAD,
    meanMotionRadPerMin: (meanMotionRevDay * TWO_PI) / 1440,
  };
  const trimmed = name?.trim();
  return trimmed ? { ...tle, name: trimmed } : tle;
}

export interface TleSet {
  line1: string;
  line2: string;
  name: string;
}

/**
 * Parse a Celestrak-shaped text blob into element sets (ADR-0009): 3-line
 * sets (name line, then lines 1 and 2) and bare 2-line sets both accepted,
 * blank lines and stray text skipped. A leading '0 ' on the name line (the
 * 3LE convention) is stripped; a missing name falls back to the catalog
 * number. Checksum and field validation stay where they are, in parseTle
 * and the provider, so this stays a splitter, not a validator.
 */
export function parseTles(text: string): TleSet[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const sets: TleSet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line1 = lines[i]!;
    if (!line1.startsWith('1 ') || line1.length < 69) continue;
    const line2 = lines[i + 1];
    if (!line2 || !line2.startsWith('2 ') || line2.length < 69) continue;
    let name = '';
    const before = i > 0 ? lines[i - 1]!.trim() : '';
    if (before && !before.startsWith('1 ') && !before.startsWith('2 ')) {
      name = before.startsWith('0 ') ? before.slice(2).trim() : before;
    }
    if (!name) name = `SAT ${line1.slice(2, 7).trim()}`;
    sets.push({ line1, line2, name });
    i++;
  }
  return sets;
}
