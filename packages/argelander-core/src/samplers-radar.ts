/**
 * Phase 1 radar and scatterometer family samplers (AGE-02, AGE-03, AGE-17):
 * stripmap-sar, scansar-tops, spotlight-sar, sweepsar-dbf, bistatic-formation,
 * fan-beam-scatterometer, pencil-beam-scatterometer, and bilateral-swath,
 * sampled over the conformance plane on the tile 1 pass shape like the
 * along-track families in samplers.ts. Scenes are code-owned per the
 * ADR-0007 addendum, transcribing atlas tiles 7 through 12, 19, and 20 at
 * 1 km per pixel; fixtures regenerate as sampler anchors (UPDATE_FIXTURES=1).
 * Recorded deviations from the atlas source: the seeded spotlight patch
 * offsets are pinned in the scene, the fan-beam twin is a single right swath
 * per the fixture signature (the left swath is a second strip sharing passId,
 * the flyby noodle rule), and the pencil-beam spin phase follows the model
 * spinPeriodSec where the hand-authored fixture had drifted from it. Pure
 * and dependency-free (AGE-01).
 */
import { conformanceStrip, numberParam, planeToBody, stateAt } from './conformance.js';
import type { PlanePoint } from './conformance.js';
import {
  cadenceEpochs, numberArrayParam, trackBasis, trackPoint,
} from './samplers.js';
import type { AlongTrackScene, TrackBasis } from './samplers.js';
import type {
  InstrumentModel, Strip, StripSegment, SubStructure, Vec3,
} from './types.js';

const EARTH_PASS: AlongTrackScene = {
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

/** Tile 7 with the demonstration incidence range of the worked example. */
export interface StripmapScene extends AlongTrackScene {
  incidenceDeg: readonly [number, number];
}

/** Atlas tile 7 on VENUS (Magellan heritage): side-looking offset ribbon. */
export const STRIPMAP_SAR_SCENE: StripmapScene = {
  ...EARTH_PASS,
  body: 'VENUS',
  frame: 'IAU_VENUS',
  radiusKm: 6051.8,
  incidenceDeg: [20, 45],
};

/** Atlas tile 8 on EARTH: 19 bursts hopping across three sub-swaths. */
export const SCANSAR_TOPS_SCENE: AlongTrackScene = {
  ...EARTH_PASS,
  segmentCount: 19,
  acquiringIndex: 12,
};

/** One tasked spotlight patch: dwell center as a pass fraction, cross-track offset. */
export interface SpotlightPatch {
  centerSf: number;
  crossOffsetKm: number;
}

export interface SpotlightScene extends AlongTrackScene {
  /** Time-ordered patches; the atlas seeds these, the scene pins them. */
  patches: readonly SpotlightPatch[];
}

/** Atlas tile 9 on EARTH: two dwells of five segments each. */
export const SPOTLIGHT_SAR_SCENE: SpotlightScene = {
  ...EARTH_PASS,
  segmentCount: 10,
  acquiringIndex: 6,
  patches: [
    { centerSf: 0.3, crossOffsetKm: 60 },
    { centerSf: 0.72, crossOffsetKm: 52 },
  ],
};

/** Atlas tile 20 on EARTH: NISAR-style full swath, five receive beams. */
export const SWEEPSAR_DBF_SCENE: AlongTrackScene = { ...EARTH_PASS };

export interface BistaticScene extends AlongTrackScene {
  /** Cross-track helix cycles per pass (the atlas draws two). */
  helixCycles: number;
}

/** Atlas tile 19 on EARTH: TanDEM-style pair, shared swath, helix baseline. */
export const BISTATIC_FORMATION_SCENE: BistaticScene = {
  ...EARTH_PASS,
  helixCycles: 2,
};

/** Atlas tile 10 on EARTH: fore, mid, and aft looks cycling over one swath. */
export const FAN_BEAM_SCENE: AlongTrackScene = {
  ...EARTH_PASS,
  segmentCount: 84,
  acquiringIndex: 58,
};

/** Atlas tile 11 on EARTH: two spinning pencil beams, no nadir gap. */
export const PENCIL_BEAM_SCENE: AlongTrackScene = {
  ...EARTH_PASS,
  segmentCount: 81,
  acquiringIndex: 56,
};

/** Atlas tile 12 on EARTH: one near-nadir swath plus the gap altimeter chain. */
export const BILATERAL_SWATH_SCENE: AlongTrackScene = { ...EARTH_PASS };

function requireKind(model: InstrumentModel, kind: string): void {
  if (model.kind !== kind) throw new TypeError(`${kind} model required, got ${model.kind}`);
}

/** Imaged-side sign: 'right' is the positive cross-track normal. */
function sideSign(model: InstrumentModel): 1 | -1 {
  const side = model.params['side'];
  if (side === 'right') return 1;
  if (side === 'left') return -1;
  throw new TypeError(`model ${model.instrumentId}: param side must be 'left' or 'right', got ${String(side)}`);
}

/** Near/far pairs from a flat range list (subSwathRangesKm). */
function rangePairs(model: InstrumentModel, key: string): ReadonlyArray<readonly [number, number]> {
  const flat = numberArrayParam(model, key);
  if (flat.length % 2 !== 0) {
    throw new TypeError(`model ${model.instrumentId}: param ${key} must hold near/far pairs, got ${flat.length} values`);
  }
  const pairs: (readonly [number, number])[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const near = flat[i]!;
    const far = flat[i + 1]!;
    if (!(near < far)) throw new TypeError(`model ${model.instrumentId}: param ${key} pair ${i / 2} has near ${near} not below far ${far}`);
    pairs.push([near, far]);
  }
  return pairs;
}

/** Offset ribbon edges at a plane point: near and far along the signed normal. */
function offsetEdges(
  scene: AlongTrackScene, b: TrackBasis, p: PlanePoint, near: number, far: number, sign: 1 | -1,
): { left: Vec3; right: Vec3 } {
  return {
    left: planeToBody(scene, [p[0] + sign * near * b.nrmX, p[1] + sign * near * b.nrmY]),
    right: planeToBody(scene, [p[0] + sign * far * b.nrmX, p[1] + sign * far * b.nrmY]),
  };
}

/**
 * Regenerate the tile 7 strip: a side-looking offset ribbon on the segment
 * clock, nadir never imaged, `left` the near-range edge. Plain envelope per
 * SPEC-STRIP section 3, with the worked-example incidence range as quality.
 */
export function generateStripmapSarStrip(model: InstrumentModel, scene: StripmapScene): Strip {
  requireKind(model, 'stripmap-sar');
  const near = numberParam(model, 'nearRangeKm');
  const far = numberParam(model, 'farRangeKm');
  const sign = sideSign(model);
  const b = trackBasis(scene);
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const et = (scene.passSec * i) / (n - 1);
    const p = trackPoint(scene, b, i / (n - 1));
    segments.push({
      etSec: et,
      ...offsetEdges(scene, b, p, near, far, sign),
      state: stateAt(i, scene.acquiringIndex),
      quality: { incidenceDeg: scene.incidenceDeg },
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-07', segments, `${sign === 1 ? 'right' : 'left'}-looking`);
}

/**
 * Regenerate the tile 8 strip: the beam hops across the sub-swaths in
 * bursts, one segment per burst at burstPeriodSec, cycling sub-swath
 * index k modulo the pair count, each tagged with its burstId. The seams
 * between bursts are time gaps and adapters must not interpolate them.
 */
export function generateScansarTopsStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'scansar-tops');
  const pairs = rangePairs(model, 'subSwathRangesKm');
  const period = numberParam(model, 'burstPeriodSec');
  const b = trackBasis(scene);
  const segments = cadenceEpochs(period, scene.passSec).map((et, k): StripSegment => {
    const p = trackPoint(scene, b, et / scene.passSec);
    const sw = k % pairs.length;
    const [near, far] = pairs[sw]!;
    return {
      etSec: et,
      ...offsetEdges(scene, b, p, near, far, 1),
      state: stateAt(k, scene.acquiringIndex),
      sub: [{ kind: 'sub-swath', index: sw, burstId: `burst-${String(k).padStart(2, '0')}` }],
    };
  });
  return conformanceStrip(model, scene, 'atlas-tile-08', segments);
}

/**
 * Regenerate the tile 9 strip: the beam stares at each pinned patch for
 * dwellSec centered on the patch pass fraction, segments on the model
 * segment clock within the dwell and nothing between dwells. The patch
 * outline rides every dwell segment as a frame sub; geometry is static
 * while the platform moves, which is the spotlight signature.
 */
export function generateSpotlightSarStrip(model: InstrumentModel, scene: SpotlightScene): Strip {
  requireKind(model, 'spotlight-sar');
  const halfAlong = numberParam(model, 'patchHalfAlongKm');
  const halfCross = numberParam(model, 'patchHalfCrossKm');
  const dwell = numberParam(model, 'dwellSec');
  const step = model.timing.segmentStepSec;
  const b = trackBasis(scene);
  const segments: StripSegment[] = [];
  let emission = 0;
  for (let p = 0; p < scene.patches.length; p++) {
    const patch = scene.patches[p]!;
    const [cx, cy] = trackPoint(scene, b, patch.centerSf);
    const px = cx + patch.crossOffsetKm * b.nrmX;
    const py = cy + patch.crossOffsetKm * b.nrmY;
    const lead: PlanePoint = [px + halfAlong * b.dirX, py + halfAlong * b.dirY];
    const trail: PlanePoint = [px - halfAlong * b.dirX, py - halfAlong * b.dirY];
    const corners: readonly [Vec3, Vec3, Vec3, Vec3] = [
      planeToBody(scene, [lead[0] - halfCross * b.nrmX, lead[1] - halfCross * b.nrmY]),
      planeToBody(scene, [lead[0] + halfCross * b.nrmX, lead[1] + halfCross * b.nrmY]),
      planeToBody(scene, [trail[0] + halfCross * b.nrmX, trail[1] + halfCross * b.nrmY]),
      planeToBody(scene, [trail[0] - halfCross * b.nrmX, trail[1] - halfCross * b.nrmY]),
    ];
    const left = planeToBody(scene, [px - halfCross * b.nrmX, py - halfCross * b.nrmY]);
    const right = planeToBody(scene, [px + halfCross * b.nrmX, py + halfCross * b.nrmY]);
    const start = patch.centerSf * scene.passSec - dwell / 2;
    for (let j = 0; j * step <= dwell + 1e-9; j++) {
      segments.push({
        etSec: start + j * step,
        left,
        right,
        state: stateAt(emission, scene.acquiringIndex),
        sub: [{ kind: 'frame', corners, frameId: `patch-${p + 1}` }],
      });
      emission++;
    }
  }
  return conformanceStrip(model, scene, 'atlas-tile-09', segments, 'dwell');
}

/**
 * Regenerate the tile 20 strip: transmit floods the full near-to-far swath
 * while beamCount receive beams sweep it electronically; the envelope is one
 * ribbon and the beams are sub-swath markers, so width no longer costs
 * resolution and the strip stays one unit of bookkeeping.
 */
export function generateSweepsarDbfStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'sweepsar-dbf');
  const near = numberParam(model, 'nearRangeKm');
  const far = numberParam(model, 'farRangeKm');
  const beamCount = numberParam(model, 'beamCount');
  if (!Number.isInteger(beamCount) || beamCount < 1) {
    throw new TypeError(`model ${model.instrumentId}: beamCount must be a positive integer`);
  }
  const b = trackBasis(scene);
  const beams: readonly SubStructure[] = Array.from(
    { length: beamCount },
    (_, index) => ({ kind: 'sub-swath', index }),
  );
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const et = (scene.passSec * i) / (n - 1);
    const p = trackPoint(scene, b, i / (n - 1));
    segments.push({
      etSec: et,
      ...offsetEdges(scene, b, p, near, far, 1),
      state: stateAt(i, scene.acquiringIndex),
      sub: [...beams],
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-20', segments);
}

/**
 * Regenerate the tile 19 strip: one illuminator ribbon whose every segment
 * carries the companion position as a baseline sub, the companion leading by
 * alongTrackSepKm and weaving crossTrackAmpKm through helixCycles sine
 * cycles per pass. The baseline is the measurement.
 */
export function generateBistaticFormationStrip(model: InstrumentModel, scene: BistaticScene): Strip {
  requireKind(model, 'bistatic-formation');
  const near = numberParam(model, 'nearRangeKm');
  const far = numberParam(model, 'farRangeKm');
  const sep = numberParam(model, 'alongTrackSepKm');
  const amp = numberParam(model, 'crossTrackAmpKm');
  const b = trackBasis(scene);
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const sf = i / (n - 1);
    const [px, py] = trackPoint(scene, b, sf);
    const weave = amp * Math.sin(2 * Math.PI * scene.helixCycles * sf);
    const companion = planeToBody(scene, [
      px + sep * b.dirX + weave * b.nrmX,
      py + sep * b.dirY + weave * b.nrmY,
    ]);
    segments.push({
      etSec: scene.passSec * sf,
      ...offsetEdges(scene, b, [px, py], near, far, 1),
      state: stateAt(i, scene.acquiringIndex),
      sub: [{ kind: 'baseline', companion }],
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-19', segments);
}

/**
 * Regenerate the tile 10 strip: one swath of the twin (the left swath is a
 * second strip sharing passId), the beam cycling fore, mid, aft on the
 * beamPeriodSec clock; each segment carries its look direction. The
 * crosshatch of azimuths is the sampling.
 */
export function generateFanBeamScatterometerStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'fan-beam-scatterometer');
  const near = numberParam(model, 'nearRangeKm');
  const far = numberParam(model, 'farRangeKm');
  const looks = numberArrayParam(model, 'azimuthLooksRad');
  const period = numberParam(model, 'beamPeriodSec');
  const b = trackBasis(scene);
  const segments = cadenceEpochs(period, scene.passSec).map((et, k): StripSegment => {
    const p = trackPoint(scene, b, et / scene.passSec);
    const look = k % looks.length;
    return {
      etSec: et,
      ...offsetEdges(scene, b, p, near, far, 1),
      state: stateAt(k, scene.acquiringIndex),
      sub: [{ kind: 'look', index: look, azimuthRad: looks[look]! }],
    };
  });
  return conformanceStrip(model, scene, 'atlas-tile-10', segments, 'right-swath');
}

/**
 * Regenerate the tile 11 strip: the envelope spans both sides out to the
 * outer beam radius (no nadir gap), and each segment carries the two
 * spinning beam sample points as beads, phase 2 pi t over spinPeriodSec for
 * the inner beam and beamPhaseOffsetRad ahead for the outer.
 */
export function generatePencilBeamScatterometerStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'pencil-beam-scatterometer');
  const inner = numberParam(model, 'innerRadiusKm');
  const outer = numberParam(model, 'outerRadiusKm');
  const spin = numberParam(model, 'spinPeriodSec');
  const phaseOffset = numberParam(model, 'beamPhaseOffsetRad');
  const b = trackBasis(scene);
  const n = scene.segmentCount;
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    const et = (scene.passSec * i) / (n - 1);
    const [px, py] = trackPoint(scene, b, i / (n - 1));
    const beam = (radius: number, psi: number): Vec3 => planeToBody(scene, [
      px + radius * (Math.cos(psi) * b.nrmX + Math.sin(psi) * b.dirX),
      py + radius * (Math.cos(psi) * b.nrmY + Math.sin(psi) * b.dirY),
    ]);
    const psi = (2 * Math.PI * et) / spin;
    segments.push({
      etSec: et,
      left: planeToBody(scene, [px - outer * b.nrmX, py - outer * b.nrmY]),
      right: planeToBody(scene, [px + outer * b.nrmX, py + outer * b.nrmY]),
      state: stateAt(i, scene.acquiringIndex),
      sub: [{ kind: 'beads', points: [beam(inner, psi), beam(outer, psi + phaseOffset)] }],
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-11', segments);
}

/**
 * Regenerate the tile 12 strip: one near-nadir swath of the pair (the other
 * side is a second strip sharing passId) with `left` at the gap edge, plus
 * the gap altimeter chain as beads on the nadirBeadStepKm distance clock,
 * each bead attached to the segment whose time window contains it. The gap
 * is rendered honestly and never healed.
 */
export function generateBilateralSwathStrip(model: InstrumentModel, scene: AlongTrackScene): Strip {
  requireKind(model, 'bilateral-swath');
  const gap = numberParam(model, 'gapHalfWidthKm');
  const outerEdge = numberParam(model, 'outerEdgeKm');
  const beadStep = numberParam(model, 'nadirBeadStepKm');
  const b = trackBasis(scene);
  const speed = scene.trackLengthKm / scene.passSec;
  const n = scene.segmentCount;
  const segStep = scene.passSec / (n - 1);
  const segments: StripSegment[] = [];
  let bead = 0;
  for (let i = 0; i < n; i++) {
    const et = segStep * i;
    const p = trackPoint(scene, b, i / (n - 1));
    const points: Vec3[] = [];
    while (bead * beadStep <= scene.trackLengthKm + 1e-9 && (bead * beadStep) / speed < et + segStep - 1e-9) {
      const beadEt = (bead * beadStep) / speed;
      const [bx, by] = trackPoint(scene, b, beadEt / scene.passSec);
      points.push(planeToBody(scene, [bx, by]));
      bead++;
    }
    segments.push({
      etSec: et,
      ...offsetEdges(scene, b, p, gap, outerEdge, 1),
      state: stateAt(i, scene.acquiringIndex),
      ...(points.length > 0 ? { sub: [{ kind: 'beads' as const, points }] } : {}),
    });
  }
  return conformanceStrip(model, scene, 'atlas-tile-12', segments, 'right-swath');
}
