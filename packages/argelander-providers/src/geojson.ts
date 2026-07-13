/**
 * Strip interchange codec (ADR-0011, AGE-04, AGE-14). Serializes a strip to
 * and from GeoJSON, at the providers layer so argelander-core keeps its zero
 * runtime dependencies and the frozen strip schema does not move: this is a
 * serialization that maps to and from the strip, never an extension of it.
 * Pure JSON, no dependency.
 *
 * Two formats. Standard GeoJSON (RFC 7946) is the universal lossy interop
 * path: a strip becomes one outline feature (a ribbon polygon, or a line for a
 * zero-width track) carrying the AGE-14 provenance at the feature level,
 * readable by any GIS. MMGIS Enhanced GeoJSON is the lossless render-host path:
 * the strip becomes a MultiLineString of its two edges whose vertices carry the
 * per-segment epoch, state, and quality through a file-level `coord_properties`
 * array (nasa-ammos.github.io/MMGIS/configure/formats/enhanced-geojson), which
 * names the members of every coordinate positionally after the required
 * longitude, latitude, elevation.
 *
 * The scope is the envelope: edges, epoch, state, quality, and the pass-through
 * of a producer's own columns. The mechanism sub-structure (footprints, beads,
 * frames, looks) is not interchanged; a strip that carried sub-structure comes
 * back at envelope grade. The edges convert through geographic coordinates
 * analytically (no frames math), so their direction is rendering grade while
 * their radius is preserved; the epoch converts through the providers' Unix
 * second (etToUtcUnix out, utcUnixToEt in), rendering grade across the leap
 * table. Both conventions are recorded on the reconstructed strip's provenance,
 * never hidden. Because the closed strip schema has no room for a producer's
 * own coordinate columns, ingest returns the strip alongside a passthrough
 * sidecar, and export reattaches it, so an unknown column survives a round trip
 * byte for byte without the strip widening.
 */
import type { AcquisitionState, Correction, Provenance, Strip, StripSegment, Vec3 } from 'argelander-core';
import { etToUtcUnix, utcUnixToEt } from './time.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** The acquisition state as a numeric coordinate member; a coordinate array holds numbers, not the string enum. */
const STATE_CODE: Readonly<Record<AcquisitionState, number>> = { planned: 0, acquiring: 1, committed: 2 };
const STATE_BY_CODE: readonly AcquisitionState[] = ['planned', 'acquiring', 'committed'];

/**
 * The coordinate members Argelander reserves, in the order it writes them. The
 * first three are the RFC 7946 position; the rest are the reserved metadata.
 * Quality tuples expand to a min and a max member because a coordinate member
 * is a scalar. Any coord_properties a document carries beyond these are
 * passthrough, neither read nor dropped.
 */
export const RESERVED_COORD_PROPERTIES = [
  'longitude', 'latitude', 'elevation',
  'event_seconds', 'state',
  'resolution_m_min', 'resolution_m_max',
  'incidence_deg_min', 'incidence_deg_max',
  'look_count',
] as const;

/** The unmodeled coordinate columns of an ingested document, kept so a round trip can reattach them. */
export interface StripPassthrough {
  /** Column names, in the order the values arrays hold them. */
  readonly names: readonly string[];
  /** Per-vertex values for the left edge; left[i] aligns with segment i. */
  readonly left: ReadonlyArray<ReadonlyArray<number | null>>;
  /** Per-vertex values for the right edge. */
  readonly right: ReadonlyArray<ReadonlyArray<number | null>>;
}

export interface EnhancedGeoJsonOptions {
  /** Producer columns to reattach after the reserved members (from a prior ingest). */
  passthrough?: StripPassthrough;
}

export interface StripFromGeoJson {
  strip: Strip;
  /** The unmodeled columns, present only for Enhanced GeoJSON that carried extras. */
  passthrough?: StripPassthrough;
}

/** GeoJSON value shapes, kept minimal and local so nothing is imported. */
type GeoValue = number | null;
type EnhancedPosition = readonly GeoValue[];
export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  coord_properties?: readonly string[];
  features: readonly GeoJsonFeature[];
}
export interface GeoJsonFeature {
  type: 'Feature';
  /** Feature-level coord_properties, overriding the file-level array (MMGIS). */
  coord_properties?: readonly string[];
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
}
export type GeoJsonGeometry =
  | { type: 'MultiLineString'; coordinates: readonly (readonly EnhancedPosition[])[] }
  | { type: 'LineString'; coordinates: readonly (readonly number[])[] }
  | { type: 'Point'; coordinates: readonly number[] }
  | { type: 'Polygon'; coordinates: readonly (readonly (readonly number[])[])[] };

function radiusKm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function toGeographic(v: Vec3, refRadiusKm: number): { lonDeg: number; latDeg: number; elevationM: number } {
  const r = radiusKm(v);
  return {
    lonDeg: Math.atan2(v[1], v[0]) * RAD2DEG,
    latDeg: Math.asin(r > 0 ? v[2] / r : 0) * RAD2DEG,
    // Height above the strip's reference radius, meters; zero for a surface
    // edge, and it preserves any per-point radius exactly on reconstruction.
    elevationM: (r - refRadiusKm) * 1000,
  };
}

function fromGeographic(lonDeg: number, latDeg: number, elevationM: number, refRadiusKm: number): Vec3 {
  const la = latDeg * DEG2RAD;
  const lo = lonDeg * DEG2RAD;
  const r = refRadiusKm + elevationM / 1000;
  const c = Math.cos(la);
  return [r * c * Math.cos(lo), r * c * Math.sin(lo), r * Math.sin(la)];
}

/** The reserved members of one vertex, in RESERVED_COORD_PROPERTIES order, plus any passthrough. */
function vertexValues(
  edge: Vec3, segment: StripSegment, refRadiusKm: number, extra: readonly (number | null)[],
): GeoValue[] {
  const g = toGeographic(edge, refRadiusKm);
  const q = segment.quality;
  return [
    g.lonDeg, g.latDeg, g.elevationM,
    etToUtcUnix(segment.etSec),
    STATE_CODE[segment.state],
    q?.resolutionM ? q.resolutionM[0] : null,
    q?.resolutionM ? q.resolutionM[1] : null,
    q?.incidenceDeg ? q.incidenceDeg[0] : null,
    q?.incidenceDeg ? q.incidenceDeg[1] : null,
    q?.lookCount ?? null,
    ...extra,
  ];
}

function stripProperties(strip: Strip): Record<string, unknown> {
  return {
    id: strip.id, body: strip.body, frame: strip.frame, instrumentId: strip.instrumentId,
    ...(strip.missionId !== undefined ? { missionId: strip.missionId } : {}),
    ...(strip.mode !== undefined ? { mode: strip.mode } : {}),
    ...(strip.passId !== undefined ? { passId: strip.passId } : {}),
    authority: strip.provenance.authority,
    generatedBy: strip.provenance.generatedBy,
    ...(strip.provenance.correction !== undefined ? { correction: strip.provenance.correction } : {}),
    ...(strip.provenance.inputs !== undefined ? { inputs: strip.provenance.inputs } : {}),
  };
}

/**
 * Strip to MMGIS Enhanced GeoJSON: a MultiLineString of the left then right
 * edge whose vertices carry the reserved members and any reattached
 * passthrough, named by a file-level coord_properties array.
 */
export function stripToEnhancedGeoJson(strip: Strip, options: EnhancedGeoJsonOptions = {}): GeoJsonFeatureCollection {
  const ref = radiusKm(strip.segments[0]!.left);
  const pass = options.passthrough;
  const names = pass ? pass.names : [];
  // Pad every passthrough row to the column count so a short or missing row
  // never shifts a column: a vertex always carries one value per column.
  const padRow = (row: readonly (number | null)[] | undefined): (number | null)[] =>
    names.map((_, k) => (row && k < row.length ? row[k]! : null));
  const left = strip.segments.map((s, i) => vertexValues(s.left, s, ref, pass ? padRow(pass.left[i]) : []));
  const right = strip.segments.map((s, i) => vertexValues(s.right, s, ref, pass ? padRow(pass.right[i]) : []));
  return {
    type: 'FeatureCollection',
    coord_properties: [...RESERVED_COORD_PROPERTIES, ...names],
    features: [{
      type: 'Feature',
      properties: { ...stripProperties(strip), bodyRadiusKm: ref },
      geometry: { type: 'MultiLineString', coordinates: [left, right] },
    }],
  };
}

function numberAt(position: EnhancedPosition, index: number): number | null {
  if (index < 0 || index >= position.length) return null;
  const v = position[index];
  // A non-finite member (NaN, Infinity, a null, a string) reads as absent, so a
  // malformed document cannot smuggle a NaN into an edge or an epoch.
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function segmentQuality(pos: EnhancedPosition, idx: Record<string, number>): StripSegment['quality'] {
  const resMin = numberAt(pos, idx.resolution_m_min ?? -1);
  const resMax = numberAt(pos, idx.resolution_m_max ?? -1);
  const incMin = numberAt(pos, idx.incidence_deg_min ?? -1);
  const incMax = numberAt(pos, idx.incidence_deg_max ?? -1);
  const looks = numberAt(pos, idx.look_count ?? -1);
  const quality: { resolutionM?: [number, number]; incidenceDeg?: [number, number]; lookCount?: number } = {};
  if (resMin !== null && resMax !== null) quality.resolutionM = [resMin, resMax];
  if (incMin !== null && incMax !== null) quality.incidenceDeg = [incMin, incMax];
  if (looks !== null) quality.lookCount = looks;
  return Object.keys(quality).length ? quality : undefined;
}

export interface EnhancedGeoJsonImportOptions {
  /**
   * The body radius the edges were measured against, kilometers. A GeoJSON
   * coordinate carries no radius, so a foreign document that lacks the
   * bodyRadiusKm feature property Argelander writes must supply it here; the
   * codec refuses rather than fabricating one.
   */
  bodyRadiusKm?: number;
}

const QUALITY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['resolution_m_min', 'resolution_m_max'],
  ['incidence_deg_min', 'incidence_deg_max'],
];

/**
 * MMGIS Enhanced GeoJSON to strip plus a passthrough sidecar. Reads the
 * reserved members by name from coord_properties (so a producer may order them
 * freely, and a feature-level array overrides the file-level one) and gathers
 * every other column into the sidecar unmodified. Approximations it had to make
 * (a defaulted state, an incomplete quality column it could not model) are
 * disclosed on the strip provenance rather than hidden.
 */
export function enhancedGeoJsonToStrip(fc: GeoJsonFeatureCollection, options: EnhancedGeoJsonImportOptions = {}): StripFromGeoJson {
  const feature = fc.features[0];
  if (!feature || feature.geometry.type !== 'MultiLineString') {
    throw new RangeError('enhancedGeoJsonToStrip expects a FeatureCollection whose first feature is a MultiLineString');
  }
  const names = feature.coord_properties ?? fc.coord_properties;
  if (!names || names[0] !== 'longitude' || names[1] !== 'latitude' || names[2] !== 'elevation') {
    throw new RangeError('Enhanced GeoJSON needs coord_properties beginning longitude, latitude, elevation');
  }
  const idx: Record<string, number> = {};
  names.forEach((n, i) => { idx[n] = i; });
  const reserved = new Set<string>(RESERVED_COORD_PROPERTIES);
  const passNames = names.filter((n) => !reserved.has(n));
  const passIdx = passNames.map((n) => idx[n]!);

  const edges = feature.geometry.coordinates;
  if (edges.length !== 2) {
    throw new RangeError(`Enhanced GeoJSON MultiLineString needs exactly two edges (left, right), got ${edges.length}`);
  }
  const [leftCoords, rightCoords] = edges;
  if (!leftCoords || !rightCoords || leftCoords.length !== rightCoords.length) {
    throw new RangeError('Enhanced GeoJSON MultiLineString needs a left and a right edge of equal length');
  }
  if (leftCoords.length === 0) throw new RangeError('Enhanced GeoJSON MultiLineString edges must not be empty');

  const props = feature.properties;
  const ref = typeof props.bodyRadiusKm === 'number' ? props.bodyRadiusKm
    : typeof options.bodyRadiusKm === 'number' ? options.bodyRadiusKm
      : undefined;
  if (ref === undefined || !(ref > 0)) {
    throw new RangeError('Enhanced GeoJSON needs a positive bodyRadiusKm, in the document or supplied by the caller');
  }

  const segments: StripSegment[] = [];
  const passLeft: (number | null)[][] = [];
  const passRight: (number | null)[][] = [];
  let stateDefaulted = 0;
  for (let i = 0; i < leftCoords.length; i++) {
    const lp = leftCoords[i]!;
    const rp = rightCoords[i]!;
    const code = numberAt(lp, idx.state ?? -1);
    let state: AcquisitionState;
    if (code !== null && Number.isInteger(code) && code >= 0 && code < STATE_BY_CODE.length) {
      state = STATE_BY_CODE[code]!;
    } else {
      // No recoverable state; the conservative default is planned, not the
      // most-real committed, and the count is disclosed on provenance.
      state = 'planned';
      stateDefaulted++;
    }
    const eventSec = numberAt(lp, idx.event_seconds ?? -1);
    const quality = segmentQuality(lp, idx);
    segments.push({
      etSec: eventSec !== null ? utcUnixToEt(eventSec) : 0,
      left: edgeVec(lp, idx, ref),
      right: edgeVec(rp, idx, ref),
      state,
      ...(quality ? { quality } : {}),
    });
    passLeft.push(passIdx.map((j) => numberAt(lp, j)));
    passRight.push(passIdx.map((j) => numberAt(rp, j)));
  }

  const notes: string[] = [];
  if (stateDefaulted) notes.push(`state defaulted to planned for ${stateDefaulted} of ${segments.length} segments`);
  const dropped = QUALITY_PAIRS
    .filter(([a, b]) => names.includes(a) !== names.includes(b))
    .flatMap(([a, b]) => [a, b].filter((n) => names.includes(n)));
  if (dropped.length) notes.push(`incomplete quality columns dropped: ${dropped.join(', ')}`);

  const strip: Strip = {
    id: asString(props.id, 'imported-strip'),
    body: asString(props.body, 'UNKNOWN'),
    frame: asString(props.frame, 'UNKNOWN'),
    instrumentId: asString(props.instrumentId, 'imported'),
    ...(typeof props.missionId === 'string' ? { missionId: props.missionId } : {}),
    ...(typeof props.mode === 'string' ? { mode: props.mode } : {}),
    ...(typeof props.passId === 'string' ? { passId: props.passId } : {}),
    segments,
    provenance: importProvenance(props, notes),
  };
  return passNames.length ? { strip, passthrough: { names: passNames, left: passLeft, right: passRight } } : { strip };
}

function edgeVec(pos: EnhancedPosition, idx: Record<string, number>, ref: number): Vec3 {
  const lon = numberAt(pos, idx.longitude ?? 0) ?? 0;
  const lat = numberAt(pos, idx.latitude ?? 1) ?? 0;
  const elev = numberAt(pos, idx.elevation ?? 2) ?? 0;
  return fromGeographic(lon, lat, elev, ref);
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length ? v : fallback;
}

function importProvenance(props: Record<string, unknown>, notes: readonly string[]): Provenance {
  // The producing component and the conventions this import approximated,
  // disclosed rather than hidden (ADR-0011): geographic direction and the
  // Unix-second epoch are rendering grade, sub-structure is not carried, plus
  // any per-import notes (a defaulted state, a dropped incomplete quality column).
  const base = 'enhancedGeoJsonToStrip: envelope grade, geographic and unix-second rendering grade';
  return {
    authority: asString(props.authority, 'geojson'),
    generatedBy: notes.length ? `${base}; ${notes.join('; ')}` : base,
    ...(isCorrection(props.correction) ? { correction: props.correction } : {}),
    ...(Array.isArray(props.inputs) ? { inputs: props.inputs.filter((x): x is string => typeof x === 'string') } : {}),
  };
}

function isCorrection(v: unknown): v is Correction {
  return v === 'NONE' || v === 'LT' || v === 'LT+S' || v === 'CN' || v === 'CN+S';
}

/** Aggregate quality across a strip: the widest resolution and incidence ranges, the largest look count. */
function aggregateQuality(strip: Strip): Record<string, unknown> {
  let rMin = Infinity; let rMax = -Infinity; let iMin = Infinity; let iMax = -Infinity; let looks = -Infinity;
  for (const s of strip.segments) {
    const q = s.quality;
    if (q?.resolutionM) { rMin = Math.min(rMin, q.resolutionM[0]); rMax = Math.max(rMax, q.resolutionM[1]); }
    if (q?.incidenceDeg) { iMin = Math.min(iMin, q.incidenceDeg[0]); iMax = Math.max(iMax, q.incidenceDeg[1]); }
    if (q?.lookCount !== undefined) looks = Math.max(looks, q.lookCount);
  }
  return {
    ...(Number.isFinite(rMin) ? { resolutionM: [rMin, rMax] } : {}),
    ...(Number.isFinite(iMin) ? { incidenceDeg: [iMin, iMax] } : {}),
    ...(Number.isFinite(looks) ? { lookCount: looks } : {}),
  };
}

/**
 * Strip to standard GeoJSON (RFC 7946): a single outline feature carrying the
 * AGE-14 provenance at the feature level, lossy and universal. A width-bearing
 * strip becomes a Polygon (left edge forward, right edge back, closed); a
 * zero-width track becomes a LineString.
 */
export function stripToGeoJson(strip: Strip): GeoJsonFeatureCollection {
  const ref = radiusKm(strip.segments[0]!.left);
  const ll = (v: Vec3): [number, number] => {
    const g = toGeographic(v, ref);
    return [g.lonDeg, g.latDeg];
  };
  const zeroWidth = strip.segments.every((s) =>
    s.left[0] === s.right[0] && s.left[1] === s.right[1] && s.left[2] === s.right[2]);
  const properties = { ...stripProperties(strip), quality: aggregateQuality(strip) };
  const n = strip.segments.length;
  let geometry: GeoJsonGeometry;
  if (zeroWidth) {
    // A single point is a Point; two or more a LineString (RFC 7946 needs a
    // LineString to carry at least two positions).
    geometry = n === 1
      ? { type: 'Point', coordinates: ll(strip.segments[0]!.left) }
      : { type: 'LineString', coordinates: strip.segments.map((s) => ll(s.left)) };
  } else if (n === 1) {
    // One cross-track segment is a line, not a polygon (a ring needs four positions).
    geometry = { type: 'LineString', coordinates: [ll(strip.segments[0]!.left), ll(strip.segments[0]!.right)] };
  } else {
    const forward = strip.segments.map((s) => ll(s.left));
    const backward = strip.segments.map((s) => ll(s.right)).reverse();
    geometry = { type: 'Polygon', coordinates: [ccw([...forward, ...backward, forward[0]!])] };
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties, geometry }] };
}

/** RFC 7946: an exterior ring SHOULD wind counterclockwise (positive shoelace area). */
function ccw(ring: readonly [number, number][]): [number, number][] {
  let area = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    area += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return area < 0 ? [...ring].reverse() : [...ring];
}

/**
 * Standard GeoJSON to a minimal outline-only strip: geometry only, no epochs
 * (a plain LineString or Polygon has none), so segments take a unit time base
 * and the committed state, and the provenance discloses the outline grade.
 * A Polygon is split at its midpoint into the forward left edge and the
 * reversed right edge, which is exact for a ribbon this codec produced and
 * best-effort for a foreign polygon (an odd or non-ribbon ring pairs
 * approximately); a LineString or Point becomes a zero-width track.
 */
export function geoJsonToStrip(fc: GeoJsonFeatureCollection, meta: { body: string; frame: string; instrumentId: string; bodyRadiusKm: number }): Strip {
  const feature = fc.features[0];
  if (!feature) throw new RangeError('geoJsonToStrip expects at least one feature');
  const ref = meta.bodyRadiusKm;
  const vec = (c: readonly number[]): Vec3 => fromGeographic(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, ref);
  let lefts: Vec3[];
  let rights: Vec3[];
  if (feature.geometry.type === 'Point') {
    lefts = [vec(feature.geometry.coordinates)];
    rights = lefts;
  } else if (feature.geometry.type === 'LineString') {
    lefts = feature.geometry.coordinates.map(vec);
    rights = lefts;
  } else if (feature.geometry.type === 'Polygon') {
    const ring = feature.geometry.coordinates[0] ?? [];
    const open = ring.length > 1 && sameXY(ring[0]!, ring[ring.length - 1]!) ? ring.slice(0, -1) : ring;
    const half = Math.floor(open.length / 2);
    lefts = open.slice(0, half).map(vec);
    rights = open.slice(half).reverse().map(vec);
  } else {
    throw new RangeError('geoJsonToStrip expects a Point, LineString, or Polygon feature');
  }
  const n = Math.min(lefts.length, rights.length);
  const segments: StripSegment[] = [];
  for (let i = 0; i < n; i++) {
    segments.push({ etSec: i, left: lefts[i]!, right: rights[i]!, state: 'committed' });
  }
  if (!segments.length) throw new RangeError('geoJsonToStrip produced no segments');
  const p = feature.properties;
  return {
    id: asString(p.id, 'imported-outline'),
    body: meta.body,
    frame: meta.frame,
    instrumentId: asString(p.instrumentId, meta.instrumentId),
    ...(typeof p.missionId === 'string' ? { missionId: p.missionId } : {}),
    ...(typeof p.mode === 'string' ? { mode: p.mode } : {}),
    ...(typeof p.passId === 'string' ? { passId: p.passId } : {}),
    segments,
    provenance: {
      authority: asString(p.authority, 'geojson'),
      generatedBy: 'geoJsonToStrip: outline grade, no epochs (unit time base), committed state',
    },
  };
}

function sameXY(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
