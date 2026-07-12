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
   * Whiskbroom-style scan mechanism riding the track: footprint ellipses
   * sweep the swath on the triangle law of the whiskbroom sampler, sampled
   * at subStepSec between segment epochs (nadir and cross-track directions
   * interpolate between the bracketing states, rendering grade). Gives the
   * mechanism treatment something to reveal when LOD zooms in (AGE-09).
   */
  scan?: {
    scanRateHz: number;
    subStepSec: number;
    footprintSemiMajorKm: number;
    footprintSemiMinorKm: number;
    footprintGrowthFactor: number;
  };
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

function unit(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
}

/**
 * Footprint orientation: the cross-track direction from local east,
 * counterclockwise seen from outside the body, folded to [0, pi). East
 * degenerates at the poles; the fold to zero there is rendering grade.
 */
function crossTrackRotationRad(nadir: Vec3, cross: Vec3): number {
  const em = Math.hypot(-nadir[1], nadir[0]);
  if (em < 1e-9) return 0;
  const east: Vec3 = [-nadir[1] / em, nadir[0] / em, 0];
  const north: Vec3 = [
    nadir[1] * east[2] - nadir[2] * east[1],
    nadir[2] * east[0] - nadir[0] * east[2],
    nadir[0] * east[1] - nadir[1] * east[0],
  ];
  const raw = Math.atan2(
    cross[0] * north[0] + cross[1] * north[1] + cross[2] * north[2],
    cross[0] * east[0] + cross[1] * east[1] + cross[2] * east[2],
  );
  return ((raw % Math.PI) + Math.PI) % Math.PI;
}

/** The whiskbroom triangle scan law: phase in cycles to position in [-1, 1]. */
function trianglePosition(phase: number): number {
  const fract = ((phase % 1) + 1) % 1;
  return Math.abs(fract * 2 - 1) * 2 - 1;
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

  const nadirs: Vec3[] = [];
  const crosses: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const sample = decodeState(batch, targetIndex, i);
    const [px, py, pz] = sample.positionKm;
    const [vx, vy, vz] = sample.velocityKmS;
    const pm = Math.hypot(px, py, pz);
    if (!(pm > 0)) throw new RangeError(`degenerate position at epoch index ${i}`);
    nadirs.push([px / pm, py / pm, pz / pm]);
    const hx = py * vz - pz * vy;
    const hy = pz * vx - px * vz;
    const hz = px * vy - py * vx;
    const hm = Math.hypot(hx, hy, hz);
    if (!(hm > 0)) throw new RangeError(`degenerate state at epoch index ${i}: position and velocity are parallel`);
    crosses.push([hx / hm, hy / hm, hz / hm]);
  }

  const scan = options.scan;
  if (scan && !(halfWidth > 0)) {
    throw new RangeError('scan requires a positive swathHalfWidthKm');
  }
  if (scan && !(scan.subStepSec > 0)) {
    throw new RangeError('scan.subStepSec must be positive');
  }

  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const et = batch.epochs[i]!;
    const nadir = nadirs[i]!;
    const cross = crosses[i]!;

    const sub: SubStructure[] = [];
    if (options.beadOffsetsKm?.length) {
      sub.push({
        kind: 'beads',
        points: options.beadOffsetsKm.map((d) => surfacePoint(radius, nadir, cross, d)),
      });
    }
    if (scan) {
      const nextEt = i + 1 < n ? batch.epochs[i + 1]! : et;
      for (let j = 0; j === 0 || et + j * scan.subStepSec < nextEt - 1e-9; j++) {
        const tt = et + j * scan.subStepSec;
        const f = nextEt > et ? (tt - et) / (nextEt - et) : 0;
        const sNadir = f === 0 ? nadir : unit([
          nadir[0] + f * (nadirs[i + 1]![0] - nadir[0]),
          nadir[1] + f * (nadirs[i + 1]![1] - nadir[1]),
          nadir[2] + f * (nadirs[i + 1]![2] - nadir[2]),
        ]);
        const sCross = f === 0 ? cross : unit([
          cross[0] + f * (crosses[i + 1]![0] - cross[0]),
          cross[1] + f * (crosses[i + 1]![1] - cross[1]),
          cross[2] + f * (crosses[i + 1]![2] - cross[2]),
        ]);
        const tri = trianglePosition(tt * scan.scanRateHz);
        const grow = 1 + scan.footprintGrowthFactor * tri * tri;
        sub.push({
          kind: 'footprint',
          center: surfacePoint(radius, sNadir, sCross, tri * halfWidth),
          semiMajorKm: scan.footprintSemiMajorKm * grow,
          semiMinorKm: scan.footprintSemiMinorKm * grow,
          rotationRad: crossTrackRotationRad(sNadir, sCross),
        });
      }
    }

    segments.push({
      etSec: et,
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
