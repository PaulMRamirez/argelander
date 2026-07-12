/**
 * Conformance scenes and samplers: numeric replay of atlas tiles 1
 * (pushbroom) and 21 (flyby-swath) per SPEC-INSTRUMENT-MODEL section 5.
 * The atlas is the visual reference; these are the numeric reference.
 * Pure and dependency-free (AGE-01, AGE-17).
 */
import type {
  AcquisitionState, InstrumentModel, Strip, StripSegment, Vec3,
} from './types.js';

/** Plane point on the conformance tile, kilometers; y grows south (canvas convention). */
export type PlanePoint = readonly [number, number];

export interface ConformanceScene {
  body: string;
  frame: string;
  radiusKm: number;
  planeWidthKm: number;
  planeHeightKm: number;
  passSec: number;
  segmentCount: number;
  /** Index of the single acquiring segment; earlier committed, later planned. */
  acquiringIndex: number;
}

export interface PushbroomScene extends ConformanceScene {
  tiltRad: number;
  trackLengthKm: number;
}

export interface FlybyScene extends ConformanceScene {
  controlPoints: readonly [PlanePoint, PlanePoint, PlanePoint];
  /** Plane point the cross-track normal orients toward. */
  bodyCenter: PlanePoint;
  /** Amplitude a of the pacing u(sf) = sf - (a / 2 pi) sin(2 pi sf). */
  paceAmplitude: number;
}

/** Atlas tile 1 on EARTH, frozen in SPEC-INSTRUMENT-MODEL section 5. */
export const PUSHBROOM_SCENE: PushbroomScene = {
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

/** Atlas tile 21 on TITAN, frozen in SPEC-INSTRUMENT-MODEL section 5. */
export const FLYBY_SCENE: FlybyScene = {
  body: 'TITAN',
  frame: 'IAU_TITAN',
  radiusKm: 2575,
  planeWidthKm: 320,
  planeHeightKm: 240,
  passSec: 10,
  segmentCount: 41,
  acquiringIndex: 28,
  controlPoints: [[-30, 43.2], [160, 120], [350, 43.2]],
  bodyCenter: [160, 283.2],
  paceAmplitude: 0.6,
};

/**
 * Embed a tile-plane point onto the body sphere: east = x - w/2,
 * north = h/2 - y, position = R times the unit vector of (R, east, north),
 * body-fixed x through longitude 0 latitude 0 and z north.
 */
export function planeToBody(scene: ConformanceScene, p: PlanePoint): Vec3 {
  const east = p[0] - scene.planeWidthKm / 2;
  const north = scene.planeHeightKm / 2 - p[1];
  const k = scene.radiusKm / Math.hypot(scene.radiusKm, east, north);
  return [scene.radiusKm * k, east * k, north * k];
}

/** State rule shared by every conformance-plane sampler (spec section 5). */
export function stateAt(i: number, acquiringIndex: number): AcquisitionState {
  return i < acquiringIndex ? 'committed' : i === acquiringIndex ? 'acquiring' : 'planned';
}

/** Required numeric param access shared by the family samplers. */
export function numberParam(model: InstrumentModel, key: string): number {
  const v = model.params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`model ${model.instrumentId}: numeric param ${key} missing`);
  }
  return v;
}

/** Strip envelope shared by every conformance-plane sampler. */
export function conformanceStrip(model: InstrumentModel, scene: ConformanceScene, tile: string, segments: readonly StripSegment[]): Strip {
  return {
    id: `conformance-${model.kind}`,
    body: scene.body,
    frame: scene.frame,
    instrumentId: model.instrumentId,
    missionId: 'conformance',
    mode: 'nominal',
    passId: 'pass-0',
    segments,
    provenance: {
      authority: 'argelander-core@0.0.1',
      generatedBy: 'conformance-sampler',
      correction: 'NONE',
      inputs: [`model:${model.instrumentId}`, `scene:${tile}`],
    },
  };
}

/** Regenerate the tile 1 strip: straight track, constant swath (spec section 5). */
export function generatePushbroomStrip(model: InstrumentModel, scene: PushbroomScene): Strip {
  if (model.kind !== 'pushbroom') throw new TypeError(`pushbroom model required, got ${model.kind}`);
  const w = numberParam(model, 'swathHalfWidthKm');
  const dirX = Math.sin(scene.tiltRad);
  const dirY = Math.cos(scene.tiltRad);
  const nrmX = -dirY;
  const nrmY = dirX;
  const cx = scene.planeWidthKm / 2;
  const cy = scene.planeHeightKm / 2;
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const sf = i / (n - 1);
    const sx = cx + (sf - 0.5) * scene.trackLengthKm * dirX;
    const sy = cy + (sf - 0.5) * scene.trackLengthKm * dirY;
    segments.push({
      etSec: scene.passSec * sf,
      left: planeToBody(scene, [sx - w * nrmX, sy - w * nrmY]),
      right: planeToBody(scene, [sx + w * nrmX, sy + w * nrmY]),
      state: stateAt(i, scene.acquiringIndex),
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-01', segments);
}

/** Regenerate the tile 21 strip: Bezier arc, paced, width varying (spec section 5). */
export function generateFlybyStrip(model: InstrumentModel, scene: FlybyScene): Strip {
  if (model.kind !== 'flyby-swath') throw new TypeError(`flyby-swath model required, got ${model.kind}`);
  const nearOffset = numberParam(model, 'nearEdgeOffsetKm');
  const minWidth = numberParam(model, 'minWidthKm');
  const growth = numberParam(model, 'widthGrowthKm');
  const exponent = numberParam(model, 'widthExponent');
  const [p0, p1, p2] = scene.controlPoints;
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const sf = i / (n - 1);
    const u = sf - (scene.paceAmplitude / (2 * Math.PI)) * Math.sin(2 * Math.PI * sf);
    const a = (1 - u) * (1 - u);
    const b = 2 * u * (1 - u);
    const c = u * u;
    const px = a * p0[0] + b * p1[0] + c * p2[0];
    const py = a * p0[1] + b * p1[1] + c * p2[1];
    let tx = 2 * (1 - u) * (p1[0] - p0[0]) + 2 * u * (p2[0] - p1[0]);
    let ty = 2 * (1 - u) * (p1[1] - p0[1]) + 2 * u * (p2[1] - p1[1]);
    const tm = Math.hypot(tx, ty) || 1;
    tx /= tm;
    ty /= tm;
    let nx = -ty;
    let ny = tx;
    if ((scene.bodyCenter[0] - px) * nx + (scene.bodyCenter[1] - py) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const nd = Math.min(1, Math.abs(u - 0.5) * 2);
    const width = minWidth + growth * Math.pow(nd, exponent);
    segments.push({
      etSec: scene.passSec * sf,
      left: planeToBody(scene, [px + nearOffset * nx, py + nearOffset * ny]),
      right: planeToBody(scene, [px + (nearOffset + width) * nx, py + (nearOffset + width) * ny]),
      state: stateAt(i, scene.acquiringIndex),
      quality: { resolutionM: [3 * width, 4.5 * width] },
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-21', segments);
}
