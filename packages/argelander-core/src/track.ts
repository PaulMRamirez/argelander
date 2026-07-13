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
  /**
   * Side-looking offset ribbon (stripmap SAR): `left` is the near-range edge
   * and `right` the far, on the imaged side, because nadir is never imaged.
   * Mutually exclusive with swathHalfWidthKm and scan.
   */
  offsetRangeKm?: { nearKm: number; farKm: number; side: 'left' | 'right' };
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
   * Cross-track step-scan sounder (ATMS, CrIS): positionsPerRow footprint
   * ellipses stepped across the swath each segment, growing off-nadir by
   * crossGrowthFactor (cross-track) and alongGrowthFactor (along-track) with
   * the squared normalized offset. Requires swathHalfWidthKm; exclusive with
   * scan, conical, and offsetRangeKm.
   */
  stepScan?: {
    positionsPerRow: number;
    footprintRadiusKm: number;
    crossGrowthFactor: number;
    alongGrowthFactor: number;
  };
  /**
   * Conical scan radiometer (GMI, AMSR2): one crescent footprint per segment
   * on a forward circle of radius scanRadiusKm at the antenna spin phase,
   * swept across the forward sector of half-angle sectorHalfAngleRad. Constant
   * incidence is the mechanism. A standalone posture: exclusive with
   * swathHalfWidthKm, scan, stepScan, offsetRangeKm, and beadOffsetsKm.
   */
  conical?: {
    scanRadiusKm: number;
    sectorHalfAngleRad: number;
    spinPeriodSec: number;
    footprintSemiMajorKm: number;
    footprintSemiMinorKm: number;
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

/**
 * Recompute segment states for an engine clock (AGE-13 groundwork): the last
 * segment at or before nowEtSec is acquiring, earlier ones committed, later
 * ones planned; a clock before the first segment leaves the whole strip
 * planned. Pure: returns a new strip sharing all segment geometry, which is
 * what lets a demo or a scrubbing clock re-emit states every tick cheaply.
 */
export function withStateRule(strip: Strip, nowEtSec: number): Strip {
  let acquiringIndex = -1;
  for (let i = 0; i < strip.segments.length; i++) {
    if (strip.segments[i]!.etSec <= nowEtSec + 1e-9) acquiringIndex = i;
  }
  return {
    ...strip,
    segments: strip.segments.map((s, i) => ({
      ...s,
      state: i < acquiringIndex ? 'committed' : i === acquiringIndex ? 'acquiring' : 'planned',
    })),
  };
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

  const stepScan = options.stepScan;
  if (stepScan) {
    if (!(halfWidth > 0)) throw new RangeError('stepScan requires a positive swathHalfWidthKm');
    if (scan) throw new RangeError('stepScan is exclusive with scan');
    if (!Number.isInteger(stepScan.positionsPerRow) || stepScan.positionsPerRow < 1) {
      throw new RangeError(`stepScan.positionsPerRow must be a positive integer, got ${stepScan.positionsPerRow}`);
    }
  }

  const conical = options.conical;
  if (conical) {
    if (halfWidth > 0 || scan || stepScan || options.offsetRangeKm || options.beadOffsetsKm?.length) {
      throw new RangeError('conical is a standalone posture, exclusive with swath, scan, stepScan, offsetRangeKm, and beadOffsetsKm');
    }
    if (!(conical.scanRadiusKm > 0 && conical.sectorHalfAngleRad > 0 && conical.spinPeriodSec > 0)) {
      throw new RangeError('conical requires positive scanRadiusKm, sectorHalfAngleRad, and spinPeriodSec');
    }
  }

  const offset = options.offsetRangeKm;
  if (offset) {
    if (halfWidth > 0 || scan || stepScan) {
      throw new RangeError('offsetRangeKm is exclusive with swathHalfWidthKm, scan, and stepScan');
    }
    if (!(offset.nearKm > 0 && offset.nearKm < offset.farKm)) {
      throw new RangeError(`offsetRangeKm needs 0 < nearKm < farKm, got ${offset.nearKm}, ${offset.farKm}`);
    }
    if (offset.side !== 'left' && offset.side !== 'right') {
      throw new RangeError(`offsetRangeKm.side must be 'left' or 'right', got ${String(offset.side)}`);
    }
  }
  const offSign = offset?.side === 'left' ? -1 : 1;
  const leftOffsetKm = offset ? offSign * offset.nearKm : -halfWidth;
  const rightOffsetKm = offset ? offSign * offset.farKm : halfWidth;

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
    if (stepScan) {
      const rotationRad = crossTrackRotationRad(nadir, cross);
      for (let j = 0; j < stepScan.positionsPerRow; j++) {
        const u = -halfWidth + (j + 0.5) * (2 * halfWidth) / stepScan.positionsPerRow;
        const q = Math.abs(u) / halfWidth;
        sub.push({
          kind: 'footprint',
          center: surfacePoint(radius, nadir, cross, u),
          semiMajorKm: stepScan.footprintRadiusKm * (1 + stepScan.crossGrowthFactor * q * q),
          semiMinorKm: stepScan.footprintRadiusKm * (1 + stepScan.alongGrowthFactor * q * q),
          rotationRad,
        });
      }
    }
    let minGrow = Infinity;
    let maxGrow = -Infinity;
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
        if (grow < minGrow) minGrow = grow;
        if (grow > maxGrow) maxGrow = grow;
        sub.push({
          kind: 'footprint',
          center: surfacePoint(radius, sNadir, sCross, tri * halfWidth),
          semiMajorKm: scan.footprintSemiMajorKm * grow,
          semiMinorKm: scan.footprintSemiMinorKm * grow,
          rotationRad: crossTrackRotationRad(sNadir, sCross),
        });
      }
    }

    let left: Vec3;
    let right: Vec3;
    if (conical) {
      // Forward tangent (along-track) is the orbit normal crossed with nadir;
      // the crescent sits on the ground circle at the spin phase, and the
      // envelope is the cross-track chord the sector spans on that circle.
      const along = unit([
        cross[1] * nadir[2] - cross[2] * nadir[1],
        cross[2] * nadir[0] - cross[0] * nadir[2],
        cross[0] * nadir[1] - cross[1] * nadir[0],
      ]);
      const dirAt = (psi: number): Vec3 => unit([
        Math.cos(psi) * along[0] + Math.sin(psi) * cross[0],
        Math.cos(psi) * along[1] + Math.sin(psi) * cross[1],
        Math.cos(psi) * along[2] + Math.sin(psi) * cross[2],
      ]);
      const phase = ((et / conical.spinPeriodSec) % 1 + 1) % 1;
      const psi = -conical.sectorHalfAngleRad + phase * 2 * conical.sectorHalfAngleRad;
      const centerDir = dirAt(psi);
      const centerPt = surfacePoint(radius, nadir, centerDir, conical.scanRadiusKm);
      left = surfacePoint(radius, nadir, dirAt(-conical.sectorHalfAngleRad), conical.scanRadiusKm);
      right = surfacePoint(radius, nadir, dirAt(conical.sectorHalfAngleRad), conical.scanRadiusKm);
      sub.push({
        kind: 'footprint',
        center: centerPt,
        semiMajorKm: conical.footprintSemiMajorKm,
        semiMinorKm: conical.footprintSemiMinorKm,
        rotationRad: crossTrackRotationRad(nadir, centerDir),
      });
    } else {
      left = surfacePoint(radius, nadir, cross, leftOffsetKm);
      right = surfacePoint(radius, nadir, cross, rightOffsetKm);
    }

    segments.push({
      etSec: et,
      left,
      right,
      state: i < acquiringIndex ? 'committed' : i === acquiringIndex ? 'acquiring' : 'planned',
      ...(sub.length ? { sub } : {}),
      // Scan segments record the footprint size range they actually swept,
      // in meters, which gives the quality-gradient treatment real variation.
      ...(scan && Number.isFinite(minGrow) ? {
        quality: {
          resolutionM: [
            scan.footprintSemiMajorKm * minGrow * 1000,
            scan.footprintSemiMajorKm * maxGrow * 1000,
          ] as const,
        },
      } : {}),
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
