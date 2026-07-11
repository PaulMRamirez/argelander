/**
 * Instrument model machine forms (SPEC-INSTRUMENT-MODEL sections 2 and 4):
 * the family list, the per-family required-parameter vocabulary, and the
 * envelope validator. Pure and dependency-free (AGE-01).
 */
import type { GeometryFamily, InstrumentModel, ParamValue } from './types.js';
import type { ValidationResult } from './validate.js';

/** Machine form of the spec section 4 table. Completeness is type-checked. */
export const FAMILY_REQUIRED_PARAMS: Readonly<Record<GeometryFamily, readonly string[]>> = {
  'pushbroom': ['swathHalfWidthKm'],
  'whiskbroom': ['swathHalfWidthKm', 'scanRateHz', 'footprintSemiMajorKm', 'footprintSemiMinorKm', 'footprintGrowthFactor'],
  'step-scan-sounder': ['swathHalfWidthKm', 'positionsPerRow', 'footprintRadiusKm', 'crossGrowthFactor', 'alongGrowthFactor'],
  'conical-radiometer': ['scanRadiusKm', 'sectorHalfAngleRad', 'spinPeriodSec', 'footprintSemiMajorKm', 'footprintSemiMinorKm'],
  'framing': ['framePeriodSec', 'frameHalfAlongKm', 'frameHalfCrossKm', 'overlapFactor'],
  'push-frame': ['swathHalfWidthKm', 'frameletHalfAlongKm', 'bandCount', 'framePeriodSec'],
  'multi-angle': ['swathHalfWidthKm', 'stationLeadsSec'],
  'profiler': ['beamOffsetsKm', 'pairSplitKm', 'beadStepKm'],
  'stripmap-sar': ['nearRangeKm', 'farRangeKm', 'side'],
  'scansar-tops': ['subSwathRangesKm', 'burstPeriodSec'],
  'spotlight-sar': ['patchHalfAlongKm', 'patchHalfCrossKm', 'dwellSec'],
  'sweepsar-dbf': ['nearRangeKm', 'farRangeKm', 'beamCount'],
  'bistatic-formation': ['nearRangeKm', 'farRangeKm', 'alongTrackSepKm', 'crossTrackAmpKm'],
  'fan-beam-scatterometer': ['nearRangeKm', 'farRangeKm', 'azimuthLooksRad', 'beamPeriodSec'],
  'pencil-beam-scatterometer': ['innerRadiusKm', 'outerRadiusKm', 'spinPeriodSec', 'beamPhaseOffsetRad'],
  'bilateral-swath': ['gapHalfWidthKm', 'outerEdgeKm', 'nadirBeadStepKm'],
  'limb-occultation': ['tangentLeadSec', 'tangentBeadStepKm', 'eventRadiusKm'],
  'geo-raster': ['diskRadiusKm', 'fullDiskSec', 'mesoHalfWidthKm', 'mesoRevisitSec'],
  'agile-tasking': ['fieldOfRegardHalfKm', 'taskTypes'],
  'target-stare': ['patchHalfAlongKm', 'patchHalfCrossKm', 'dwellStartSec', 'dwellEndSec', 'stretchMaxFactor'],
  'flyby-swath': ['nearEdgeOffsetKm', 'minWidthKm', 'widthGrowthKm', 'widthExponent'],
};

/** The 21 geometry families (AGE-03), in spec order. */
export const GEOMETRY_FAMILIES = Object.keys(FAMILY_REQUIRED_PARAMS) as readonly GeometryFamily[];

const MOUNT_KINDS = new Set(['fixed', 'gimbal', 'scan-mirror', 'spin']);

const isFiniteVec3 = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x));

function paramPresent(v: ParamValue | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'boolean') return true;
  return v.length > 0 && v.every((x) => typeof x === 'number' ? Number.isFinite(x) : x.length > 0);
}

/** Enforce the SPEC-INSTRUMENT-MODEL common envelope and required params. */
export function validateInstrumentModel(model: InstrumentModel): ValidationResult {
  const errors: string[] = [];
  const required = FAMILY_REQUIRED_PARAMS[model.kind];
  if (!required) errors.push(`kind unknown: ${String(model.kind)}`);
  if (!model.name) errors.push('name empty');
  if (!model.instrumentId) errors.push('instrumentId empty');
  if (!Array.isArray(model.mount)) {
    errors.push('mount missing');
  } else {
    model.mount.forEach((el, i) => {
      if (!MOUNT_KINDS.has(el.kind)) errors.push(`mount ${i}: kind invalid`);
      if (el.axis !== undefined && !isFiniteVec3(el.axis)) errors.push(`mount ${i}: axis invalid`);
      if (el.halfRangeRad !== undefined && !Number.isFinite(el.halfRangeRad)) errors.push(`mount ${i}: halfRangeRad invalid`);
      if (el.rateRadS !== undefined && !Number.isFinite(el.rateRadS)) errors.push(`mount ${i}: rateRadS invalid`);
    });
  }
  if (!model.timing || !(model.timing.segmentStepSec > 0) || !Number.isFinite(model.timing.segmentStepSec)) {
    errors.push('timing.segmentStepSec must be finite and positive');
  } else if (model.timing.subStepSec !== undefined && !(model.timing.subStepSec > 0 && Number.isFinite(model.timing.subStepSec))) {
    errors.push('timing.subStepSec must be finite and positive');
  }
  if (model.validity !== undefined) {
    const { start, end } = model.validity;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(start < end)) {
      errors.push('validity window invalid');
    }
  }
  if (!model.params) {
    errors.push('params missing');
  } else if (required) {
    for (const key of required) {
      if (!paramPresent(model.params[key])) errors.push(`param ${key} missing or invalid`);
    }
  }
  return { ok: errors.length === 0, errors };
}
