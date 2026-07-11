/**
 * Argelander core types. Normative shapes for SPEC-STRIP, SPEC-INSTRUMENT-MODEL,
 * and SPEC-PROVIDER, all frozen in Phase 0. Changes here are contract changes
 * and require an ADR.
 */

/** Body-fixed Cartesian kilometers. Tuple for typed-array friendliness. */
export type Vec3 = readonly [number, number, number];

/** SPICE scalar-first quaternion (w, x, y, z), the m2q layout. */
export type Quat = readonly [number, number, number, number];

/*
 * SPEC-PROVIDER: the inbound seam. Strict subset of the Bessel StateProvider
 * contract pinned at 668ed07 (AGE-19), plus the additive `id` and `coverage`
 * facets. Layout comments are load-bearing and transcribed from the pin.
 */

/** NAIF body name or numeric id string ('CASSINI', '699'). */
export type BodyId = string;

/** SPICE frame name ('J2000', 'IAU_SATURN', a CK frame). */
export type FrameId = string;

/** TDB seconds past J2000, the one time scale of the seam. */
export type Et = number;

export type Seconds = number;

/** Aberration correction, explicit at every call site and never defaulted. */
export type Correction = 'NONE' | 'LT' | 'LT+S' | 'CN' | 'CN+S';

/** Inclusive epoch range; expands to start, start + step, ... through end. */
export interface EpochRange {
  start: Et;
  end: Et;
  step: Seconds;
}

export interface StateQuery {
  targets: BodyId[];
  observer: BodyId;
  frame: FrameId;
  correction: Correction;
  epochs: Et[] | EpochRange;
}

/**
 * Zero-copy batch; flat arrays are JS owned and transferable. states holds
 * targets.length blocks of n samples of 6 doubles (x, y, z km then vx, vy,
 * vz km/s); the state of targets[t] at epochs[i] begins at
 * states[(t * n + i) * 6]; lightTimes[t * n + i] holds one-way light time
 * in seconds.
 */
export interface StateBatch {
  readonly targets: readonly BodyId[];
  readonly observer: BodyId;
  readonly frame: FrameId;
  readonly correction: Correction;
  readonly epochs: Float64Array;
  readonly states: Float64Array;
  readonly lightTimes: Float64Array;
}

/**
 * Orientation quaternions for one body: n samples of 4 doubles, SPICE
 * scalar-first (w, x, y, z); each sample rotates vectors expressed in
 * `frame` into the body-fixed frame in `bodyFrame`.
 */
export interface QuatBatch {
  readonly body: BodyId;
  readonly frame: FrameId;
  readonly bodyFrame: FrameId;
  readonly epochs: Float64Array;
  readonly quats: Float64Array;
}

/** Validity window advertised by a provider (SPEC-PROVIDER section 4). */
export interface CoverageWindow {
  readonly start: Et;
  readonly end: Et;
}

/**
 * The inbound seam (AGE-04, AGE-19). Async and flat-batch; `id` and
 * `coverage` are Argelander-additive relative to the Bessel contract. Epochs
 * outside coverage reject with a structured refusal (CoverageRefusalError in
 * provider.ts), never NaN fills and never clamping.
 */
export interface StateProvider {
  readonly id: string;
  states(q: StateQuery): Promise<StateBatch>;
  orientation(body: BodyId, frame: FrameId, epochs: Et[]): Promise<QuatBatch>;
  coverage?(body: BodyId): Promise<readonly CoverageWindow[]>;
}

/**
 * Decoder view over a StateBatch, not the seam (SPEC-PROVIDER section 1).
 * Materialized per sample by decodeState in provider.ts.
 */
export interface StateSample {
  etSec: Et;
  positionKm: Vec3;
  velocityKmS: Vec3;
}

/* SPEC-STRIP: the data spine. */

export type AcquisitionState = 'planned' | 'acquiring' | 'committed';

/** The 21 geometry families (AGE-03). */
export type GeometryFamily =
  | 'pushbroom' | 'whiskbroom' | 'step-scan-sounder' | 'conical-radiometer'
  | 'framing' | 'push-frame' | 'multi-angle' | 'profiler'
  | 'stripmap-sar' | 'scansar-tops' | 'spotlight-sar' | 'sweepsar-dbf'
  | 'bistatic-formation' | 'fan-beam-scatterometer' | 'pencil-beam-scatterometer'
  | 'bilateral-swath' | 'limb-occultation' | 'geo-raster'
  | 'agile-tasking' | 'target-stare' | 'flyby-swath';

/* Sub-structure: discriminated union on `kind` (SPEC-STRIP section 3). */

/** Membership in a numbered sub-swath, receive beam, view station, or framelet band. */
export interface SubSwath {
  kind: 'sub-swath';
  index: number;
  /** Burst identifier for quilted modes (TOPS/ScanSAR). */
  burstId?: string;
}

/** Bead, shot, or sample center positions. */
export interface SubBeads {
  kind: 'beads';
  points: readonly Vec3[];
}

/**
 * One resolved sample footprint ellipse. rotationRad turns the semi-major
 * axis from local east, counterclockwise seen from outside the body.
 */
export interface SubFootprint {
  kind: 'footprint';
  center: Vec3;
  semiMajorKm: number;
  semiMinorKm: number;
  rotationRad: number;
}

/** A discrete exposure, tasked patch, or sector box outline. */
export interface SubFrame {
  kind: 'frame';
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
  frameId?: string;
}

/** A point measurement event that pops into existence rather than being swept. */
export interface SubEvent {
  kind: 'event';
  center: Vec3;
  eventId?: string;
}

/** An azimuth look direction contributing to the segment. */
export interface SubLook {
  kind: 'look';
  index: number;
  azimuthRad: number;
}

/** Companion platform position; the baseline is the measurement. */
export interface SubBaseline {
  kind: 'baseline';
  companion: Vec3;
}

/** A named raster sector with its own refresh clock. */
export interface SubSector {
  kind: 'sector';
  sectorId: string;
  refreshSec?: number;
}

export type SubStructure =
  | SubSwath | SubBeads | SubFootprint | SubFrame
  | SubEvent | SubLook | SubBaseline | SubSector;

/** Quality vocabulary (SPEC-STRIP section 4): ordered [min, max] tuples. */
export interface QualityRange {
  incidenceDeg?: readonly [number, number];
  resolutionM?: readonly [number, number];
  lookCount?: number;
}

export interface StripSegment {
  /** Seconds past J2000 TDB. */
  etSec: Et;
  left: Vec3;
  right: Vec3;
  state: AcquisitionState;
  sub?: readonly SubStructure[];
  quality?: QualityRange;
}

export interface Provenance {
  /** Computing authority, per the Bessel AnalysisProduct contract (AGE-20). */
  authority: string;
  generatedBy: string;
  /** Correction requested at the provider seam; always present on provider-derived strips. */
  correction?: Correction;
  inputs?: readonly string[];
}

export interface Strip {
  id: string;
  /** SPICE body name, e.g. EARTH, MARS, TITAN. */
  body: string;
  /** Body-fixed frame name, e.g. ITRF93, IAU_MARS. */
  frame: string;
  instrumentId: string;
  missionId?: string;
  mode?: string;
  passId?: string;
  segments: readonly StripSegment[];
  provenance: Provenance;
}

/* SPEC-INSTRUMENT-MODEL: declarative data, not code (AGE-03, AGE-18). */

export type MountKind = 'fixed' | 'gimbal' | 'scan-mirror' | 'spin';

/** One element of the mount chain, ordered platform-outward (spec section 3). */
export interface MountElement {
  kind: MountKind;
  /** Articulation axis, unit vector in the frame of the previous element. */
  axis?: Vec3;
  /** Articulation half-range about axis, radians. */
  halfRangeRad?: number;
  /** Rotation rate about axis, radians per second. */
  rateRadS?: number;
}

export interface TimingModel {
  /** Segment emission cadence, seconds. */
  segmentStepSec: number;
  /** Sub-sample cadence within a segment where the mechanism requires one. */
  subStepSec?: number;
}

/** Sampling outside validity is a structured refusal (spec section 1). */
export interface ValidityWindow {
  start: Et;
  end: Et;
}

export type ParamValue =
  | number | string | boolean
  | readonly number[] | readonly string[];

export interface InstrumentModel {
  kind: GeometryFamily;
  name: string;
  /** Stable identity carried into Strip.instrumentId. */
  instrumentId: string;
  /** Mount chain, ordered platform-outward; empty means body-fixed nadir. */
  mount: readonly MountElement[];
  timing: TimingModel;
  validity?: ValidityWindow;
  /** Family-specific vocabulary, frozen in SPEC-INSTRUMENT-MODEL section 4. */
  params: Readonly<Record<string, ParamValue>>;
}

/**
 * AnalysisProduct envelope for strips (AGE-20, ADR-0004). Field-level
 * alignment with the Bessel product contract is deferred by ADR-0007; the
 * envelope is additive around the frozen strip payload.
 */
export interface StripProduct {
  kind: 'acquisition-strip';
  strip: Strip;
}
