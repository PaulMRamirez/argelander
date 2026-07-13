/**
 * GeoJSON trajectory playback (ADR-0011, the inbound-state role of AGE-04),
 * the sibling of czml.ts: a platform's track as GeoJSON becomes pre-sampled
 * state tables and PresampledProvider does the serving. Where CZML reads
 * time-tagged Cartesian packets, this reads a LineString or MultiPoint of
 * geographic positions and lifts them to body-fixed states.
 *
 * Scope is honest and narrow, like czml.ts. Each vertex converts from
 * geographic (longitude, latitude degrees; elevation meters above the body
 * radius) to body-fixed kilometers through the shared geographicToVec3, an
 * analytic geocentric spherical conversion, no ellipsoid and no frames math,
 * so it is rendering grade. Each vertex gets an epoch one of two ways, and
 * never both: from a per-vertex event_seconds coordinate member (MMGIS
 * Enhanced GeoJSON, Unix seconds through utcUnixToEt), or, for a plain GeoJSON
 * that carries no per-vertex time, from a caller-supplied uniform time base
 * (a start Et and a step). Velocity comes from the positions by the same
 * weighted central differences czml uses (statesFromPositions), exactly
 * consistent with the positions the table carries.
 *
 * Refused with named errors, the way czml refuses INERTIAL frames and
 * constant positions: a Point or any geometry that is not a LineString or
 * MultiPoint (not a track), a track of fewer than two vertices, a plain
 * document with neither event_seconds nor a time base (no epoch source), and
 * a document that supplies both (an ambiguous epoch source).
 */
import type { BodyId, Correction, Et, FrameId, Seconds } from 'argelander-core';
import { PresampledProvider } from './presampled.js';
import type { PresampledProviderOptions, PresampledStateTable } from './presampled.js';
import { geographicToVec3 } from './geojson.js';
import { utcUnixToEt } from './time.js';
import { statesFromPositions } from './trajectory.js';

export interface GeoJsonStateMeta {
  /** The central body the positions are relative to; default EARTH. */
  observer?: BodyId;
  /** The label for the body-fixed geographic frame in your host; default ITRF93. */
  frame?: FrameId;
  correction?: Correction;
  /** Reference sphere radius for the geographic conversion, km; default Earth's 6371. */
  bodyRadiusKm?: number;
  /**
   * Uniform time base for a plain GeoJSON that carries no per-vertex time:
   * vertex i is at startEt + i * stepSec. Exclusive with a document's own
   * event_seconds; supplying both is refused.
   */
  timeBase?: { startEt: Et; stepSec: Seconds };
  /** Target name a single-feature document serves when it names none itself. */
  target?: BodyId;
}

interface ResolvedMeta {
  observer: BodyId;
  frame: FrameId;
  correction: Correction;
  bodyRadiusKm: number;
  timeBase: { startEt: Et; stepSec: Seconds } | undefined;
  target: BodyId | undefined;
}

interface GjGeometry { type?: unknown; coordinates?: unknown }
interface GjFeature { type?: unknown; coord_properties?: unknown; properties?: unknown; geometry?: GjGeometry }
interface GjDocument { type?: unknown; coord_properties?: unknown; features?: unknown }

function asStringArray(v: unknown): readonly string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;
}

function featureTable(feature: GjFeature, fileNames: readonly string[] | undefined, meta: ResolvedMeta, index: number): PresampledStateTable {
  const props = (feature.properties && typeof feature.properties === 'object' ? feature.properties : {}) as Record<string, unknown>;
  const target = typeof props.target === 'string' ? props.target
    : typeof props.id === 'string' ? props.id
      : meta.target ?? `geojson-track-${index}`;

  const geometry = feature.geometry;
  const type = geometry?.type;
  if (type === 'Point') throw new Error(`track '${target}': a constant Point cannot make a track`);
  if (type !== 'LineString' && type !== 'MultiPoint') {
    throw new Error(`track '${target}': geometry '${String(type)}' is unsupported; provide a LineString or MultiPoint`);
  }
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords)) throw new Error(`track '${target}': geometry.coordinates must be an array`);
  if (coords.length < 2) throw new Error(`track '${target}': a track needs at least two positions, got ${coords.length}`);

  const names = asStringArray(feature.coord_properties) ?? fileNames;
  const eventIdx = names ? names.indexOf('event_seconds') : -1;
  const hasEvent = eventIdx >= 0;
  const base = meta.timeBase;
  if (hasEvent && base) {
    throw new Error(`track '${target}': both event_seconds and a time base supplied; the epoch source is ambiguous, provide one`);
  }
  if (!hasEvent && !base) {
    throw new Error(`track '${target}': plain GeoJSON has no per-vertex time; carry event_seconds (Enhanced GeoJSON) or supply a uniform time base (startEt, stepSec)`);
  }
  if (base && !(base.stepSec > 0)) throw new Error(`track '${target}': time base stepSec must be positive`);

  const n = coords.length;
  const epochs = new Float64Array(n);
  const positions = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = coords[i];
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') {
      throw new Error(`track '${target}': position ${i} must be [longitude, latitude, ...] numbers`);
    }
    const elevationM = typeof c[2] === 'number' ? c[2] : 0;
    const v = geographicToVec3(c[0], c[1], elevationM, meta.bodyRadiusKm);
    positions[i * 3 + 0] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
    if (hasEvent) {
      const unixSec = c[eventIdx];
      if (typeof unixSec !== 'number' || !Number.isFinite(unixSec)) {
        throw new Error(`track '${target}': event_seconds missing or not a finite number at position ${i}`);
      }
      epochs[i] = utcUnixToEt(unixSec);
    } else {
      epochs[i] = base!.startEt + i * base!.stepSec;
    }
  }

  return {
    body: target,
    observer: meta.observer,
    frame: meta.frame,
    correction: meta.correction,
    epochs,
    states: statesFromPositions(epochs, positions),
  };
}

/** Parse a GeoJSON document (text or the parsed object) into state tables. */
export function parseGeoJsonStates(geojson: string | object, meta: GeoJsonStateMeta = {}): PresampledStateTable[] {
  const resolved: ResolvedMeta = {
    observer: meta.observer ?? 'EARTH',
    frame: meta.frame ?? 'ITRF93',
    correction: meta.correction ?? 'NONE',
    bodyRadiusKm: meta.bodyRadiusKm ?? 6371,
    timeBase: meta.timeBase,
    target: meta.target,
  };
  if (!(resolved.bodyRadiusKm > 0)) throw new Error('GeoJSON state bodyRadiusKm must be positive');
  const document = (typeof geojson === 'string' ? JSON.parse(geojson) : geojson) as GjDocument | GjFeature;

  let features: GjFeature[];
  let fileNames: readonly string[] | undefined;
  if (document.type === 'FeatureCollection') {
    const raw = (document as GjDocument).features;
    if (!Array.isArray(raw)) throw new Error('GeoJSON FeatureCollection needs a features array');
    features = raw as GjFeature[];
    fileNames = asStringArray((document as GjDocument).coord_properties);
  } else if (document.type === 'Feature') {
    features = [document as GjFeature];
  } else {
    throw new Error(`GeoJSON must be a Feature or FeatureCollection, got '${String(document.type)}'`);
  }

  const tables = features.map((f, i) => featureTable(f, fileNames, resolved, i));
  if (tables.length === 0) throw new Error('GeoJSON carries no track features');
  return tables;
}

/** The GeoJSON trajectory provider: parsed tracks served by PresampledProvider. */
export function geoJsonStateProvider(
  geojson: string | object,
  meta: GeoJsonStateMeta = {},
  options: PresampledProviderOptions = {},
): PresampledProvider {
  return new PresampledProvider(parseGeoJsonStates(geojson, meta), { id: options.id ?? 'geojson-state' });
}
