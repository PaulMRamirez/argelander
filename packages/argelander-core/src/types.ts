/** Argelander core types. Normative shapes for SPEC-STRIP, SPEC-INSTRUMENT-MODEL, SPEC-PROVIDER (draft, Phase 0). */

/** Body-fixed Cartesian kilometers. Tuple for typed-array friendliness. */
export type Vec3 = readonly [number, number, number];

export type Quat = readonly [number, number, number, number];

export type AcquisitionState = 'planned' | 'acquiring' | 'committed';

/** The 21 geometry families (AGE-03). */
export type GeometryFamily =
  | 'pushbroom' | 'whiskbroom' | 'step-scan-sounder' | 'conical-radiometer'
  | 'framing' | 'push-frame' | 'multi-angle' | 'profiler'
  | 'stripmap-sar' | 'scansar-tops' | 'spotlight-sar' | 'sweepsar-dbf'
  | 'bistatic-formation' | 'fan-beam-scatterometer' | 'pencil-beam-scatterometer'
  | 'bilateral-swath' | 'limb-occultation' | 'geo-raster'
  | 'agile-tasking' | 'target-stare' | 'flyby-swath';

export interface SubStructure {
  /** Sub-swath index, beam index, or framelet band. */
  index?: number;
  /** Burst identifier for TOPS/ScanSAR quilts. */
  burstId?: string;
  /** Bead or beam center positions for sparse geometries. */
  points?: readonly Vec3[];
}

export interface QualityRange {
  incidenceDegMin?: number;
  incidenceDegMax?: number;
  resolutionM?: number;
}

export interface StripSegment {
  /** Seconds past J2000 TDB. */
  etSec: number;
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

/** Declarative instrument model (AGE-03, AGE-18): data, not code. */
export interface InstrumentModel {
  kind: GeometryFamily;
  name: string;
  /** Family-specific parameters; vocabulary frozen in Phase 0. */
  params: Readonly<Record<string, number | string | boolean>>;
}

export interface StateSample {
  etSec: number;
  positionKm: Vec3;
  velocityKmS: Vec3;
  attitude?: Quat;
}

/** Strict subset of the Bessel StateProvider contract (AGE-19). */
export interface StateProvider {
  id: string;
  frame: string;
  getState(etSec: number): StateSample;
  sample?(t0Sec: number, t1Sec: number, dtSec: number): readonly StateSample[];
}

/** AnalysisProduct envelope for strips (AGE-20). */
export interface StripProduct {
  kind: 'acquisition-strip';
  strip: Strip;
}
