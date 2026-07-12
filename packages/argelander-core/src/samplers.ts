/**
 * Phase 1 along-track family samplers (AGE-02, AGE-03, AGE-17): whiskbroom,
 * framing, push-frame, multi-angle, and profiler, sampled over the same
 * conformance plane and pass clock as the Phase 0 anchors (SPEC-INSTRUMENT-
 * MODEL section 5). Pushbroom, the sixth along-track family, stays in
 * conformance.ts as the tile 1 anchor. Each scene transcribes its atlas tile
 * at 1 km per pixel; every strip fixture under fixtures/strips/ regenerates
 * from these samplers (UPDATE_FIXTURES=1), making the sampler output the
 * committed anchor. Recorded deviations from the atlas source: seeded frame
 * jitter is not replayed (framing), push-frame framelets are envelope-grade
 * sub-swath markers per the fixture signature, and the profiler altimeter
 * side chain (a separate instrument in the tile) is not part of the model.
 * Pure and dependency-free (AGE-01).
 */
import { conformanceStrip, numberParam, planeToBody, stateAt } from './conformance.js';
import type { ConformanceScene, PlanePoint } from './conformance.js';
import type {
  InstrumentModel, Strip, StripSegment, SubStructure, Vec3,
} from './types.js';

/** Straight tilted track over the conformance plane, the tile 1 pass shape. */
export interface AlongTrackScene extends ConformanceScene {
  tiltRad: number;
  trackLengthKm: number;
}

/** Atlas tile 2 on EARTH: mirror sweep with bowtie footprint growth. */
export const WHISKBROOM_SCENE: AlongTrackScene = {
  body: 'EARTH',
  frame: 'ITRF93',
  radiusKm: 6371,
  planeWidthKm: 320,
  planeHeightKm: 240,
  passSec: 10,
  segmentCount: 41,
  acquiringIndex: 28,
  tiltRad: 0.2,
  trackLengthKm: 426,
};

/** Atlas tile 5 on EARTH: discrete overlapping exposures. 14 frames at 0.72 s. */
export const FRAMING_SCENE: AlongTrackScene = {
  ...WHISKBROOM_SCENE,
  segmentCount: 14,
  acquiringIndex: 9,
};

/** Atlas tile 6 on EARTH: bead chains in beam pairs. 78 rows at 5.5 km. */
export const PROFILER_SCENE: AlongTrackScene = {
  ...WHISKBROOM_SCENE,
  segmentCount: 78,
  acquiringIndex: 53,
};

/** Atlas tile 16 on the MOON: butted framelet exposures. 34 at 0.3 s. */
export const PUSH_FRAME_SCENE: AlongTrackScene = {
  ...WHISKBROOM_SCENE,
  body: 'MOON',
  frame: 'IAU_MOON',
  radiusKm: 1737.4,
  segmentCount: 34,
  acquiringIndex: 23,
};

/** Atlas tile 17 on EARTH: fore, nadir, and aft stations over one corridor. */
export const MULTI_ANGLE_SCENE: AlongTrackScene = {
  ...WHISKBROOM_SCENE,
  segmentCount: 41,
  acquiringIndex: 28,
};

interface TrackBasis {
  dirX: number;
  dirY: number;
  nrmX: number;
  nrmY: number;
  cx: number;
  cy: number;
}

function trackBasis(scene: AlongTrackScene): TrackBasis {
  const dirX = Math.sin(scene.tiltRad);
  const dirY = Math.cos(scene.tiltRad);
  return {
    dirX, dirY, nrmX: -dirY, nrmY: dirX,
    cx: scene.planeWidthKm / 2, cy: scene.planeHeightKm / 2,
  };
}

/** Platform plane position at pass fraction sf, the tile 1 track equation. */
function trackPoint(scene: AlongTrackScene, b: TrackBasis, sf: number): PlanePoint {
  return [
    b.cx + (sf - 0.5) * scene.trackLengthKm * b.dirX,
    b.cy + (sf - 0.5) * scene.trackLengthKm * b.dirY,
  ];
}

/**
 * Footprint ellipse orientation: the cross-track direction measured from
 * local east, counterclockwise seen from outside the body, folded to
 * [0, pi) because an ellipse axis is orientation, not direction. Plane y
 * grows south, so north is the negated y component.
 */
function crossTrackRotationRad(b: TrackBasis): number {
  const raw = Math.atan2(-b.nrmY, b.nrmX);
  return ((raw % Math.PI) + Math.PI) % Math.PI;
}

function numberArrayParam(model: InstrumentModel, key: string): readonly number[] {
  const v = model.params[key];
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new TypeError(`model ${model.instrumentId}: numeric array param ${key} missing`);
  }
  return v as readonly number[];
}

function requireKind(model: InstrumentModel, kind: string): void {
  if (model.kind !== kind) throw new TypeError(`${kind} model required, got ${model.kind}`);
}

/** Emission epochs k times stepSec through the pass, inclusive of a final on-clock epoch. */
function cadenceEpochs(stepSec: number, passSec: number): number[] {
  const epochs: number[] = [];
  for (let k = 0; k * stepSec <= passSec + 1e-9; k++) epochs.push(k * stepSec);
  return epochs;
}

/**
 * Regenerate the tile 2 strip: constant swath envelope, mirror sweep sampled
 * at timing.subStepSec within each segment window. The triangle scan law is
 * the atlas formula: phase = t times scanRateHz, position = the phase
 * triangle wave in [-1, 1] scaled by the swath half-width; footprints grow
 * with the squared normalized offset (the bowtie).
 */
export function generateWhiskbroomStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'whiskbroom');
  const w = numberParam(model, 'swathHalfWidthKm');
  const rate = numberParam(model, 'scanRateHz');
  const semiMajor = numberParam(model, 'footprintSemiMajorKm');
  const semiMinor = numberParam(model, 'footprintSemiMinorKm');
  const growth = numberParam(model, 'footprintGrowthFactor');
  const subStep = model.timing.subStepSec;
  if (!(subStep !== undefined && subStep > 0)) {
    throw new TypeError(`model ${model.instrumentId}: whiskbroom requires timing.subStepSec`);
  }
  const b = trackBasis(scene);
  const rotationRad = crossTrackRotationRad(b);
  const n = scene.segmentCount;
  const segStep = scene.passSec / (n - 1);
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const et = segStep * i;
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    const sub: SubStructure[] = [];
    for (let j = 0; j * subStep < segStep - 1e-9 && et + j * subStep <= scene.passSec + 1e-9; j++) {
      const tt = et + j * subStep;
      const phase = ((tt * rate) % 1 + 1) % 1;
      const tri = Math.abs(phase * 2 - 1) * 2 - 1;
      const u = w * tri;
      const grow = 1 + growth * tri * tri;
      const [fx, fy] = trackPoint(scene, b, tt / scene.passSec);
      sub.push({
        kind: 'footprint',
        center: planeToBody(scene, [fx + u * b.nrmX, fy + u * b.nrmY]),
        semiMajorKm: semiMajor * grow,
        semiMinorKm: semiMinor * grow,
        rotationRad,
      });
    }
    segments.push({
      etSec: et,
      left: planeToBody(scene, [px - w * b.nrmX, py - w * b.nrmY]),
      right: planeToBody(scene, [px + w * b.nrmX, py + w * b.nrmY]),
      state: stateAt(i, scene.acquiringIndex),
      sub,
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-02', segments);
}

/**
 * Regenerate the tile 5 strip: one segment per exposure at framePeriodSec,
 * each carrying a frame outline whose leading edge is widened by
 * overlapFactor (the atlas keystone). Time gaps between frames are the
 * signature; adapters must not interpolate across them.
 */
export function generateFramingStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'framing');
  const period = numberParam(model, 'framePeriodSec');
  const halfAlong = numberParam(model, 'frameHalfAlongKm');
  const halfCross = numberParam(model, 'frameHalfCrossKm');
  const overlap = numberParam(model, 'overlapFactor');
  const b = trackBasis(scene);
  const segments = cadenceEpochs(period, scene.passSec).map((et, k): StripSegment => {
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    const lead: PlanePoint = [px + halfAlong * b.dirX, py + halfAlong * b.dirY];
    const trail: PlanePoint = [px - halfAlong * b.dirX, py - halfAlong * b.dirY];
    const corners: readonly [Vec3, Vec3, Vec3, Vec3] = [
      planeToBody(scene, [lead[0] - halfCross * overlap * b.nrmX, lead[1] - halfCross * overlap * b.nrmY]),
      planeToBody(scene, [lead[0] + halfCross * overlap * b.nrmX, lead[1] + halfCross * overlap * b.nrmY]),
      planeToBody(scene, [trail[0] + halfCross * b.nrmX, trail[1] + halfCross * b.nrmY]),
      planeToBody(scene, [trail[0] - halfCross * b.nrmX, trail[1] - halfCross * b.nrmY]),
    ];
    return {
      etSec: et,
      left: planeToBody(scene, [px - halfCross * b.nrmX, py - halfCross * b.nrmY]),
      right: planeToBody(scene, [px + halfCross * b.nrmX, py + halfCross * b.nrmY]),
      state: stateAt(k, scene.acquiringIndex),
      sub: [{ kind: 'frame', corners, frameId: `frame-${k}` }],
    };
  });
  return conformanceStrip(model, scene, 'atlas-tile-05', segments);
}

/**
 * Regenerate the tile 16 strip: one segment per exposure at framePeriodSec,
 * full swath envelope, bandCount sub-swath markers naming the bonded filter
 * bands. Envelope grade per the fixture signature: frameletHalfAlongKm is
 * declarative data for mechanism-grade rendering (Phase 2), not consumed
 * here.
 */
export function generatePushFrameStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'push-frame');
  const w = numberParam(model, 'swathHalfWidthKm');
  const period = numberParam(model, 'framePeriodSec');
  const bandCount = numberParam(model, 'bandCount');
  if (!Number.isInteger(bandCount) || bandCount < 1) {
    throw new TypeError(`model ${model.instrumentId}: bandCount must be a positive integer`);
  }
  const b = trackBasis(scene);
  const bands: readonly SubStructure[] = Array.from(
    { length: bandCount },
    (_, index) => ({ kind: 'sub-swath', index }),
  );
  const segments = cadenceEpochs(period, scene.passSec).map((et, k): StripSegment => {
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    return {
      etSec: et,
      left: planeToBody(scene, [px - w * b.nrmX, py - w * b.nrmY]),
      right: planeToBody(scene, [px + w * b.nrmX, py + w * b.nrmY]),
      state: stateAt(k, scene.acquiringIndex),
      sub: [...bands],
    };
  });
  return conformanceStrip(model, scene, 'atlas-tile-16', segments);
}

/**
 * Regenerate the tile 17 strip: one common corridor envelope on the segment
 * clock, one sub-swath marker per view station in stationLeadsSec order, and
 * lookCount equal to the station count, one look accrued per station.
 */
export function generateMultiAngleStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'multi-angle');
  const w = numberParam(model, 'swathHalfWidthKm');
  const leads = numberArrayParam(model, 'stationLeadsSec');
  const b = trackBasis(scene);
  const stations: readonly SubStructure[] = leads.map((_, index) => ({ kind: 'sub-swath', index }));
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const et = (scene.passSec * i) / (n - 1);
    const [px, py] = trackPoint(scene, b, i / (n - 1));
    segments.push({
      etSec: et,
      left: planeToBody(scene, [px - w * b.nrmX, py - w * b.nrmY]),
      right: planeToBody(scene, [px + w * b.nrmX, py + w * b.nrmY]),
      state: stateAt(i, scene.acquiringIndex),
      sub: [...stations],
      quality: { lookCount: leads.length },
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-17', segments);
}

/**
 * Regenerate the tile 6 strip: zero-width segments on the bead clock (one
 * row every beadStepKm of along-track distance), each carrying the bead row
 * of every beam pair, offsets in beamOffsetsKm order split by plus and minus
 * pairSplitKm. Sparse geometry: never inflated to a ribbon (AGE-09).
 */
export function generateProfilerStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'profiler');
  const offsets = numberArrayParam(model, 'beamOffsetsKm');
  const split = numberParam(model, 'pairSplitKm');
  const beadStep = numberParam(model, 'beadStepKm');
  const b = trackBasis(scene);
  const speed = scene.trackLengthKm / scene.passSec;
  const segments: StripSegment[] = [];
  for (let k = 0; k * beadStep <= scene.trackLengthKm + 1e-9; k++) {
    const et = (k * beadStep) / speed;
    const [px, py] = trackPoint(scene, b, et / scene.passSec);
    const points: Vec3[] = [];
    for (const offset of offsets) {
      for (const s of [-split, split]) {
        const u = offset + s;
        points.push(planeToBody(scene, [px + u * b.nrmX, py + u * b.nrmY]));
      }
    }
    const nadir = planeToBody(scene, [px, py]);
    segments.push({
      etSec: et,
      left: nadir,
      right: nadir,
      state: stateAt(k, scene.acquiringIndex),
      sub: [{ kind: 'beads', points }],
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-06', segments);
}
