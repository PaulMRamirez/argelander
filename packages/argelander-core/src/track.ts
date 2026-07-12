/**
 * Provider-to-strip bridge (AGE-04): turn one target's block of a StateBatch
 * into a strip by analytic spherical footprint geometry. The nadir ground
 * point is the position direction scaled to the body surface, the cross-track
 * direction is the orbit normal (position cross velocity), and edges and
 * beads sit at great-circle offsets. Rendering grade per the non-goals:
 * spherical body, no light-time along the ground, states arrive from a
 * provider and are never computed here. Pure and dependency-free (AGE-01);
 * the caller names the body radius because the batch does not carry one.
 */
import { decodeState } from './provider.js';
import type { StateBatch, Strip, StripSegment, SubStructure, Vec3 } from './types.js';

export interface TrackStripOptions {
  id: string;
  /** SPICE body name for the strip envelope, e.g. EARTH. */
  body: string;
  bodyRadiusKm: number;
  instrumentId: string;
  /** Computing authority for provenance, normally the provider id (AGE-20). */
  authority: string;
  generatedBy: string;
  missionId?: string;
  mode?: string;
  passId?: string;
  /** Ribbon half-width on the ground; omit or zero for a zero-width track. */
  swathHalfWidthKm?: number;
  /** Cross-track bead offsets per segment; sparse geometry, never a ribbon (AGE-09). */
  beadOffsetsKm?: readonly number[];
  /**
   * Engine clock for the state rule: the last segment at or before it is
   * acquiring, earlier committed, later planned. Defaults to the last epoch.
   */
  nowEtSec?: number;
}

/** Great-circle offset from the nadir direction toward the cross-track unit. */
function surfacePoint(radiusKm: number, nadir: Vec3, cross: Vec3, offsetKm: number): Vec3 {
  const theta = offsetKm / radiusKm;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    radiusKm * (nadir[0] * c + cross[0] * s),
    radiusKm * (nadir[1] * c + cross[1] * s),
    radiusKm * (nadir[2] * c + cross[2] * s),
  ];
}

export function trackStrip(batch: StateBatch, targetIndex: number, options: TrackStripOptions): Strip {
  const n = batch.epochs.length;
  if (n === 0) throw new RangeError('trackStrip requires a non-empty batch');
  const radius = options.bodyRadiusKm;
  if (!(radius > 0)) throw new RangeError(`bodyRadiusKm must be positive, got ${radius}`);
  const halfWidth = options.swathHalfWidthKm ?? 0;
  const nowEtSec = options.nowEtSec ?? batch.epochs[n - 1]!;

  let acquiringIndex = -1;
  for (let i = 0; i < n; i++) {
    if (batch.epochs[i]! <= nowEtSec + 1e-9) acquiringIndex = i;
  }

  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const sample = decodeState(batch, targetIndex, i);
    const [px, py, pz] = sample.positionKm;
    const [vx, vy, vz] = sample.velocityKmS;
    const pm = Math.hypot(px, py, pz);
    if (!(pm > 0)) throw new RangeError(`degenerate position at epoch index ${i}`);
    const nadir: Vec3 = [px / pm, py / pm, pz / pm];
    const hx = py * vz - pz * vy;
    const hy = pz * vx - px * vz;
    const hz = px * vy - py * vx;
    const hm = Math.hypot(hx, hy, hz);
    if (!(hm > 0)) throw new RangeError(`degenerate state at epoch index ${i}: position and velocity are parallel`);
    const cross: Vec3 = [hx / hm, hy / hm, hz / hm];

    const sub: SubStructure[] = [];
    if (options.beadOffsetsKm?.length) {
      sub.push({
        kind: 'beads',
        points: options.beadOffsetsKm.map((d) => surfacePoint(radius, nadir, cross, d)),
      });
    }

    segments.push({
      etSec: sample.etSec,
      left: surfacePoint(radius, nadir, cross, -halfWidth),
      right: surfacePoint(radius, nadir, cross, halfWidth),
      state: i < acquiringIndex ? 'committed' : i === acquiringIndex ? 'acquiring' : 'planned',
      ...(sub.length ? { sub } : {}),
    });
  }

  return {
    id: options.id,
    body: options.body,
    frame: batch.frame,
    instrumentId: options.instrumentId,
    ...(options.missionId !== undefined ? { missionId: options.missionId } : {}),
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.passId !== undefined ? { passId: options.passId } : {}),
    segments,
    provenance: {
      authority: options.authority,
      generatedBy: options.generatedBy,
      correction: batch.correction,
      inputs: [`target:${batch.targets[targetIndex] ?? targetIndex}`],
    },
  };
}
