import type { Strip, StripSegment } from './types.js';

export interface ValidationResult {
  ok: boolean;
  errors: readonly string[];
}

const isFiniteVec = (v: readonly number[]): boolean =>
  v.length === 3 && v.every((x) => Number.isFinite(x));

const STATES = new Set(['planned', 'acquiring', 'committed']);

/** Enforce SPEC-STRIP section 2 invariants. Pure, dependency-free (AGE-01). */
export function validateStrip(strip: Strip): ValidationResult {
  const errors: string[] = [];
  if (!strip.body) errors.push('body empty');
  if (!strip.frame) errors.push('frame empty');
  if (!strip.instrumentId) errors.push('instrumentId empty');
  if (!strip.provenance || !strip.provenance.authority) errors.push('provenance.authority missing');
  const segs = strip.segments;
  if (!segs || segs.length === 0) {
    errors.push('segments empty');
    return { ok: false, errors };
  }
  let prevEt = Number.NEGATIVE_INFINITY;
  segs.forEach((s: StripSegment, i: number) => {
    if (!Number.isFinite(s.etSec)) errors.push(`segment ${i}: etSec not finite`);
    if (s.etSec < prevEt) errors.push(`segment ${i}: etSec decreases`);
    prevEt = s.etSec;
    if (!isFiniteVec(s.left)) errors.push(`segment ${i}: left edge invalid`);
    if (!isFiniteVec(s.right)) errors.push(`segment ${i}: right edge invalid`);
    if (!STATES.has(s.state)) errors.push(`segment ${i}: state invalid`);
  });
  return { ok: errors.length === 0, errors };
}
