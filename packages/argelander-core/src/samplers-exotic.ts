/**
 * Phase 1 pointed and scanning exotic family samplers (AGE-02, AGE-03,
 * AGE-17): step-scan-sounder, conical-radiometer, limb-occultation,
 * geo-raster, agile-tasking, and target-stare, the six families that close
 * the 21-family sampler set. Each transcribes its atlas tile onto the shared
 * conformance plane at 1 km per pixel (the atlas is the visual reference,
 * these are the code-owned numeric anchors per the ADR-0007 two-tier scene
 * policy). Every fixture under fixtures/strips/ regenerates from these
 * samplers (UPDATE_FIXTURES=1). Samplers are deterministic: the atlas seeds
 * random task and event placement for visual variety, and that jitter is
 * replaced here by fixed, evenly spread placement so the anchor is stable.
 * Pure and dependency-free (AGE-01).
 */
import { conformanceStrip, numberParam, planeToBody, stateAt } from './conformance.js';
import type { PlanePoint } from './conformance.js';
import { cadenceEpochs, numberArrayParam, trackBasis, trackPoint } from './samplers.js';
import type { AlongTrackScene, TrackBasis } from './samplers.js';
import type { InstrumentModel, Strip, StripSegment, SubStructure, Vec3 } from './types.js';

/** Shared plane, pinned to the atlas tiles at 1 km per pixel. */
const PLANE = {
  body: 'EARTH',
  frame: 'ITRF93',
  radiusKm: 6371,
  planeWidthKm: 320,
  planeHeightKm: 240,
  tiltRad: 0.2,
  trackLengthKm: 426,
} as const;

/** Atlas tile 3: cross-track step-scan sounder, ellipse rows growing off-nadir. */
export const STEP_SCAN_SCENE: AlongTrackScene = { ...PLANE, passSec: 10, segmentCount: 17, acquiringIndex: 12 };
/** Atlas tile 4: conical scan, a forward crescent of constant-incidence footprints. */
export const CONICAL_SCENE: AlongTrackScene = { ...PLANE, passSec: 10, segmentCount: 41, acquiringIndex: 28 };
/** Atlas tile 13: limb sounder, a forward-displaced tangent bead chain plus occultation events. */
export const LIMB_SCENE: AlongTrackScene = { ...PLANE, passSec: 10, segmentCount: 72, acquiringIndex: 50 };
/** Atlas tile 15: geostationary raster of a fixed disk with revisited mesoscale sectors. */
export const GEO_RASTER_SCENE: AlongTrackScene = { ...PLANE, passSec: 14, segmentCount: 8, acquiringIndex: 5 };
/** Atlas tile 14: agile field of regard, one committed patch per task type. */
export const AGILE_SCENE: AlongTrackScene = { ...PLANE, passSec: 10, segmentCount: 4, acquiringIndex: 2 };
/** Atlas tile 18: target stare, a footprint anchored at a fixed point rotating and stretching with slant. */
export const TARGET_STARE_SCENE: AlongTrackScene = { ...PLANE, passSec: 10, segmentCount: 5, acquiringIndex: 2 };

function requireKind(model: InstrumentModel, kind: string): void {
  if (model.kind !== kind) throw new TypeError(`${kind} model required, got ${model.kind}`);
}

function segmentStep(model: InstrumentModel): number {
  const s = model.timing.segmentStepSec;
  if (!(s !== undefined && s > 0)) throw new TypeError(`model ${model.instrumentId}: timing.segmentStepSec required`);
  return s;
}

/** Ellipse orientation for a plane direction: from local east, folded to [0, pi). */
function rotationFromPlaneDir(dx: number, dy: number): number {
  const raw = Math.atan2(-dy, dx);
  return ((raw % Math.PI) + Math.PI) % Math.PI;
}

function crossTrackRotationRad(b: TrackBasis): number {
  return rotationFromPlaneDir(b.nrmX, b.nrmY);
}

function rot2(dx: number, dy: number, a: number): readonly [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
}

/** Oriented rectangle in the plane, long axis along (fwdX, fwdY), returned as body corners. */
function planeRect(scene: AlongTrackScene, cx: number, cy: number, fwdX: number, fwdY: number, halfAlong: number, halfCross: number): readonly [Vec3, Vec3, Vec3, Vec3] {
  const px = -fwdY;
  const py = fwdX;
  const lead: PlanePoint = [cx + fwdX * halfAlong, cy + fwdY * halfAlong];
  const trail: PlanePoint = [cx - fwdX * halfAlong, cy - fwdY * halfAlong];
  return [
    planeToBody(scene, [lead[0] - px * halfCross, lead[1] - py * halfCross]),
    planeToBody(scene, [lead[0] + px * halfCross, lead[1] + py * halfCross]),
    planeToBody(scene, [trail[0] + px * halfCross, trail[1] + py * halfCross]),
    planeToBody(scene, [trail[0] - px * halfCross, trail[1] - py * halfCross]),
  ];
}

function stringArrayParam(model: InstrumentModel, key: string): readonly string[] {
  const v = model.params[key];
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) {
    throw new TypeError(`model ${model.instrumentId}: string array param ${key} missing`);
  }
  return v as readonly string[];
}

/**
 * Tile 3: one segment per cross-track scan row, each row a set of
 * positionsPerRow footprint ellipses stepped across the swath. Off-nadir
 * growth is the atlas formula, the semi-major (cross-track) axis growing by
 * crossGrowthFactor and the semi-minor (along-track) by alongGrowthFactor,
 * each with the squared normalized offset.
 */
export function generateStepScanSounderStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'step-scan-sounder');
  const w = numberParam(model, 'swathHalfWidthKm');
  const positions = numberParam(model, 'positionsPerRow');
  const r0 = numberParam(model, 'footprintRadiusKm');
  const crossGrowth = numberParam(model, 'crossGrowthFactor');
  const alongGrowth = numberParam(model, 'alongGrowthFactor');
  if (!Number.isInteger(positions) || positions < 1) {
    throw new TypeError(`model ${model.instrumentId}: positionsPerRow must be a positive integer`);
  }
  const b = trackBasis(scene);
  const rotationRad = crossTrackRotationRad(b);
  const rows = cadenceEpochs(segmentStep(model), scene.passSec);
  const segments = rows.map((et, k): StripSegment => {
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    const sub: SubStructure[] = [];
    for (let j = 0; j < positions; j++) {
      const u = -w + (j + 0.5) * (2 * w) / positions;
      const q = Math.abs(u) / w;
      sub.push({
        kind: 'footprint',
        center: planeToBody(scene, [px + u * b.nrmX, py + u * b.nrmY]),
        semiMajorKm: r0 * (1 + crossGrowth * q * q),
        semiMinorKm: r0 * (1 + alongGrowth * q * q),
        rotationRad,
      });
    }
    return {
      etSec: et,
      left: planeToBody(scene, [px - w * b.nrmX, py - w * b.nrmY]),
      right: planeToBody(scene, [px + w * b.nrmX, py + w * b.nrmY]),
      state: stateAt(k, scene.acquiringIndex),
      sub,
    };
  });
  return conformanceStrip(model, scene, 'atlas-tile-03', segments);
}

/**
 * Tile 4: one crescent footprint per segment, sitting on a forward circle of
 * radius scanRadiusKm at the antenna spin phase, swept across the forward
 * sector of half-angle sectorHalfAngleRad. Constant incidence is the
 * mechanism: every footprint center is scanRadiusKm from its segment nadir.
 * The envelope is the cross-track chord the sector spans at the forward arc.
 */
export function generateConicalRadiometerStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'conical-radiometer');
  const scanRadius = numberParam(model, 'scanRadiusKm');
  const sectorHalf = numberParam(model, 'sectorHalfAngleRad');
  const spinPeriod = numberParam(model, 'spinPeriodSec');
  const semiMajor = numberParam(model, 'footprintSemiMajorKm');
  const semiMinor = numberParam(model, 'footprintSemiMinorKm');
  const b = trackBasis(scene);
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const et = (scene.passSec * i) / (n - 1);
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    const phase = ((et / spinPeriod) % 1 + 1) % 1;
    const psi = -sectorHalf + phase * 2 * sectorHalf;
    const fx = px + scanRadius * (Math.sin(psi) * b.nrmX + Math.cos(psi) * b.dirX);
    const fy = py + scanRadius * (Math.sin(psi) * b.nrmY + Math.cos(psi) * b.dirY);
    const lookX = fx - px;
    const lookY = fy - py;
    const base: PlanePoint = [px + scanRadius * Math.cos(sectorHalf) * b.dirX, py + scanRadius * Math.cos(sectorHalf) * b.dirY];
    const edge = scanRadius * Math.sin(sectorHalf);
    segments.push({
      etSec: et,
      left: planeToBody(scene, [base[0] - edge * b.nrmX, base[1] - edge * b.nrmY]),
      right: planeToBody(scene, [base[0] + edge * b.nrmX, base[1] + edge * b.nrmY]),
      state: stateAt(i, scene.acquiringIndex),
      sub: [{
        kind: 'footprint',
        center: planeToBody(scene, [fx, fy]),
        semiMajorKm: semiMajor,
        semiMinorKm: semiMinor,
        rotationRad: rotationFromPlaneDir(lookX, lookY),
      }],
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-04', segments);
}

/**
 * Tile 13: zero-width segments on the tangent-bead distance clock, each a
 * single bead at the tangent point displaced tangentLeadSec ahead of the
 * subsatellite point, decoupling the measurement chain from the ground
 * track. Three occultation events pop into existence, offset from the track,
 * as SubEvent markers carrying the model's eventRadiusKm (ADR-0010).
 */
export function generateLimbOccultationStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'limb-occultation');
  const lead = numberParam(model, 'tangentLeadSec');
  const beadStep = numberParam(model, 'tangentBeadStepKm');
  const eventRadius = numberParam(model, 'eventRadiusKm');
  const b = trackBasis(scene);
  const speed = scene.trackLengthKm / scene.passSec;
  const count = Math.floor(scene.trackLengthKm / beadStep) + 1;
  const eventAt = new Map<number, number>([
    [Math.round(count * 0.25), 60],
    [Math.round(count * 0.5), -48],
    [Math.round(count * 0.75), 54],
  ]);
  const segments: StripSegment[] = [];
  for (let k = 0; k < count; k++) {
    const et = (k * beadStep) / speed;
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    const tf = Math.min((et + lead) / scene.passSec, 1.12);
    const [tx, ty] = trackPoint(scene, b, tf);
    const nadir = planeToBody(scene, [px, py]);
    const sub: SubStructure[] = [{ kind: 'beads', points: [planeToBody(scene, [tx, ty])] }];
    const offset = eventAt.get(k);
    if (offset !== undefined) {
      sub.push({ kind: 'event', center: planeToBody(scene, [px + offset * b.nrmX, py + offset * b.nrmY]), radiusKm: eventRadius, eventId: `occ-${k}` });
    }
    segments.push({ etSec: et, left: nadir, right: nadir, state: stateAt(k, scene.acquiringIndex), sub });
  }
  return conformanceStrip(model, scene, 'atlas-tile-13', segments);
}

/**
 * Tile 15: the geostationary platform never moves. One segment per raster
 * scan line, top to bottom over fullDiskSec, the segment envelope the disk
 * chord at that line. Two mesoscale sectors ride every segment as SubSector
 * markers carrying the revisit clock, with their box outlines as frames.
 */
export function generateGeoRasterStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'geo-raster');
  const diskRadius = numberParam(model, 'diskRadiusKm');
  const fullDisk = numberParam(model, 'fullDiskSec');
  const mesoHalf = numberParam(model, 'mesoHalfWidthKm');
  const revisit = numberParam(model, 'mesoRevisitSec');
  const cx = scene.planeWidthKm / 2;
  const cy = scene.planeHeightKm / 2;
  const sites: readonly PlanePoint[] = [[cx - 40, cy - 30], [cx + 50, cy + 40]];
  const mesoFrames: readonly SubStructure[] = sites.map((s, index): SubStructure => ({
    kind: 'frame',
    corners: [
      planeToBody(scene, [s[0] - mesoHalf, s[1] - mesoHalf]),
      planeToBody(scene, [s[0] + mesoHalf, s[1] - mesoHalf]),
      planeToBody(scene, [s[0] + mesoHalf, s[1] + mesoHalf]),
      planeToBody(scene, [s[0] - mesoHalf, s[1] + mesoHalf]),
    ],
    frameId: `meso-${index}`,
  }));
  const mesoSectors: readonly SubStructure[] = sites.map((_, index): SubStructure => ({
    kind: 'sector', sectorId: `meso-${index}`, refreshSec: revisit,
  }));
  const segments = cadenceEpochs(segmentStep(model), scene.passSec).map((et, k): StripSegment => {
    const frac = Math.min(et / fullDisk, 1);
    const y = cy - diskRadius + frac * 2 * diskRadius;
    const dy = y - cy;
    const hw = Math.sqrt(Math.max(diskRadius * diskRadius - dy * dy, 0));
    return {
      etSec: et,
      left: planeToBody(scene, [cx - hw, y]),
      right: planeToBody(scene, [cx + hw, y]),
      state: stateAt(k, scene.acquiringIndex),
      sub: [...mesoSectors, ...mesoFrames],
    };
  });
  return conformanceStrip(model, scene, 'atlas-tile-15', segments);
}

/**
 * Tile 14: one committed patch per task type inside the field of regard, the
 * segment envelope the field-of-regard band. The atlas amber-to-teal
 * convention is carried by the state rule (planned ahead, committed behind).
 * Each task type has its own frame geometry: a point patch, a rotated strip,
 * a convergent stereo pair, and a chained corridor. Types are read from the
 * model and placed at evenly spread cross-track offsets, deterministic.
 */
export function generateAgileTaskingStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'agile-tasking');
  const forHalf = numberParam(model, 'fieldOfRegardHalfKm');
  const types = stringArrayParam(model, 'taskTypes');
  const b = trackBasis(scene);
  const n = types.length;
  const segments = types.map((type, i): StripSegment => {
    const et = scene.passSec * (0.2 + 0.6 * (n === 1 ? 0.5 : i / (n - 1)));
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    const u = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * 2 * (forHalf - 26);
    const cx = px + u * b.nrmX;
    const cy = py + u * b.nrmY;
    const sub: SubStructure[] = [];
    if (type === 'point') {
      sub.push({ kind: 'frame', corners: planeRect(scene, cx, cy, b.dirX, b.dirY, 12, 9), frameId: 'point' });
    } else if (type === 'strip') {
      const [fx, fy] = rot2(b.dirX, b.dirY, 0.5);
      sub.push({ kind: 'frame', corners: planeRect(scene, cx, cy, fx, fy, 28, 7), frameId: 'strip' });
    } else if (type === 'stereo') {
      const [ax, ay] = rot2(b.dirX, b.dirY, 0.22);
      const [cx2, cy2] = rot2(b.dirX, b.dirY, -0.22);
      sub.push({ kind: 'frame', corners: planeRect(scene, cx, cy, ax, ay, 13, 10), frameId: 'stereo-fore' });
      sub.push({ kind: 'frame', corners: planeRect(scene, cx, cy, cx2, cy2, 13, 10), frameId: 'stereo-aft' });
    } else {
      let hx = cx;
      let hy = cy;
      let dirX = b.dirX;
      let dirY = b.dirY;
      for (let s = 0; s < 3; s++) {
        const nx = hx + dirX * 22;
        const ny = hy + dirY * 22;
        sub.push({ kind: 'frame', corners: planeRect(scene, (hx + nx) / 2, (hy + ny) / 2, dirX, dirY, 11, 6), frameId: `corridor-${s}` });
        hx = nx;
        hy = ny;
        [dirX, dirY] = rot2(dirX, dirY, 0.35);
      }
    }
    return {
      etSec: et,
      left: planeToBody(scene, [px - forHalf * b.nrmX, py - forHalf * b.nrmY]),
      right: planeToBody(scene, [px + forHalf * b.nrmX, py + forHalf * b.nrmY]),
      state: stateAt(i, scene.acquiringIndex),
      sub,
    };
  });
  return conformanceStrip(model, scene, 'atlas-tile-14', segments);
}

/**
 * Tile 18: a footprint anchored at one fixed ground target while the
 * platform flies past. The patch looks back at the moving sat, so it rotates
 * through the dwell; slant-range stretch elongates it by stretchMaxFactor at
 * the dwell edges and back to unity at closest approach, making dwell
 * quality visible. Segments span the dwell window on the segment clock.
 */
export function generateTargetStareStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'target-stare');
  const halfAlong = numberParam(model, 'patchHalfAlongKm');
  const halfCross = numberParam(model, 'patchHalfCrossKm');
  const dwellStart = numberParam(model, 'dwellStartSec');
  const dwellEnd = numberParam(model, 'dwellEndSec');
  const stretchMax = numberParam(model, 'stretchMaxFactor');
  const b = trackBasis(scene);
  const dwellMid = (dwellStart + dwellEnd) / 2;
  const dwellHalf = (dwellEnd - dwellStart) / 2;
  const [nx0, ny0] = trackPoint(scene, b, dwellMid / scene.passSec);
  const offset = Math.min(scene.planeWidthKm, scene.planeHeightKm) * 0.2;
  const target: PlanePoint = [nx0 + offset * b.nrmX, ny0 + offset * b.nrmY];
  const step = segmentStep(model);
  const segments: StripSegment[] = [];
  for (let k = 0; dwellStart + k * step <= dwellEnd + 1e-9; k++) {
    const et = dwellStart + k * step;
    const [sx, sy] = trackPoint(scene, b, et / scene.passSec);
    let fx = sx - target[0];
    let fy = sy - target[1];
    const fm = Math.hypot(fx, fy) || 1;
    fx /= fm;
    fy /= fm;
    const kf = 1 + (stretchMax - 1) * Math.min(1, Math.abs(et - dwellMid) / dwellHalf);
    const px = -fy;
    const py = fx;
    segments.push({
      etSec: et,
      left: planeToBody(scene, [target[0] - px * halfCross, target[1] - py * halfCross]),
      right: planeToBody(scene, [target[0] + px * halfCross, target[1] + py * halfCross]),
      state: stateAt(k, scene.acquiringIndex),
      sub: [{ kind: 'frame', corners: planeRect(scene, target[0], target[1], fx, fy, halfAlong * kf, halfCross), frameId: `dwell-${k}` }],
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-18', segments);
}
