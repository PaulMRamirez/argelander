import type { QualityRange, Strip, StripSegment, SubStructure } from './types.js';

export interface ValidationResult {
  ok: boolean;
  errors: readonly string[];
}

const isFiniteVec = (v: readonly number[]): boolean =>
  Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x));

const STATES = new Set(['planned', 'acquiring', 'committed']);

const isOrderedTuple = (t: readonly number[]): boolean =>
  Array.isArray(t) && t.length === 2 && t.every((x) => Number.isFinite(x)) && t[0]! <= t[1]!;

function subErrors(sub: SubStructure, at: string): string[] {
  const errors: string[] = [];
  switch (sub.kind) {
    case 'sub-swath':
      if (!Number.isInteger(sub.index) || sub.index < 0) errors.push(`${at}: index invalid`);
      if (sub.burstId !== undefined && !sub.burstId) errors.push(`${at}: burstId empty`);
      break;
    case 'beads':
      if (!Array.isArray(sub.points) || sub.points.length === 0 || !sub.points.every(isFiniteVec)) {
        errors.push(`${at}: points invalid`);
      }
      break;
    case 'footprint':
      if (!isFiniteVec(sub.center)) errors.push(`${at}: center invalid`);
      if (!(sub.semiMajorKm >= 0) || !(sub.semiMinorKm >= 0) || !Number.isFinite(sub.rotationRad)) {
        errors.push(`${at}: ellipse invalid`);
      }
      break;
    case 'frame':
      if (!Array.isArray(sub.corners) || sub.corners.length !== 4 || !sub.corners.every(isFiniteVec)) {
        errors.push(`${at}: corners invalid`);
      }
      if (sub.frameId !== undefined && !sub.frameId) errors.push(`${at}: frameId empty`);
      break;
    case 'event':
      if (!isFiniteVec(sub.center)) errors.push(`${at}: center invalid`);
      if (sub.eventId !== undefined && !sub.eventId) errors.push(`${at}: eventId empty`);
      break;
    case 'look':
      if (!Number.isInteger(sub.index) || sub.index < 0) errors.push(`${at}: index invalid`);
      if (!Number.isFinite(sub.azimuthRad)) errors.push(`${at}: azimuthRad invalid`);
      break;
    case 'baseline':
      if (!isFiniteVec(sub.companion)) errors.push(`${at}: companion invalid`);
      break;
    case 'sector':
      if (!sub.sectorId) errors.push(`${at}: sectorId empty`);
      if (sub.refreshSec !== undefined && !(sub.refreshSec > 0)) errors.push(`${at}: refreshSec invalid`);
      break;
    default:
      errors.push(`${at}: kind invalid`);
  }
  return errors;
}

function qualityErrors(q: QualityRange, at: string): string[] {
  const errors: string[] = [];
  if (q.incidenceDeg !== undefined && !isOrderedTuple(q.incidenceDeg)) errors.push(`${at}: incidenceDeg invalid`);
  if (q.resolutionM !== undefined && !isOrderedTuple(q.resolutionM)) errors.push(`${at}: resolutionM invalid`);
  if (q.lookCount !== undefined && (!Number.isInteger(q.lookCount) || q.lookCount < 0)) errors.push(`${at}: lookCount invalid`);
  return errors;
}

/** Enforce SPEC-STRIP section 2 invariants. Pure, dependency-free (AGE-01). */
export function validateStrip(strip: Strip): ValidationResult {
  const errors: string[] = [];
  if (!strip.id) errors.push('id empty');
  if (!strip.body) errors.push('body empty');
  if (!strip.frame) errors.push('frame empty');
  if (!strip.instrumentId) errors.push('instrumentId empty');
  if (!strip.provenance || !strip.provenance.authority) errors.push('provenance.authority missing');
  if (strip.provenance && !strip.provenance.generatedBy) errors.push('provenance.generatedBy missing');
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
    if (s.sub !== undefined) {
      if (!Array.isArray(s.sub) || s.sub.length === 0) {
        errors.push(`segment ${i}: sub empty`);
      } else {
        s.sub.forEach((sub, j) => errors.push(...subErrors(sub, `segment ${i} sub ${j}`)));
      }
    }
    if (s.quality !== undefined) errors.push(...qualityErrors(s.quality, `segment ${i} quality`));
  });
  return { ok: errors.length === 0, errors };
}
