import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validateStrip } from 'argelander-core';
import type { Strip, Vec3 } from 'argelander-core';
import {
  RESERVED_COORD_PROPERTIES, enhancedGeoJsonToStrip, geoJsonToStrip, stripToEnhancedGeoJson, stripToGeoJson,
} from '../src/geojson.js';
import type { GeoJsonFeatureCollection } from '../src/geojson.js';
import { utcUnixToEt } from '../src/time.js';

const require = createRequire(import.meta.url);

function fixture(family: string): Strip {
  return JSON.parse(readFileSync(require.resolve(`argelander-core/fixtures/strips/${family}.json`), 'utf8')) as Strip;
}

/** Cross-track chord of a segment, km, for a rendering-grade edge comparison. */
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('Enhanced GeoJSON round trip (ADR-0011)', () => {
  // A plain swath, a resolution range, an incidence range, a look count: the
  // reserved fields the codec must carry losslessly across families.
  for (const family of ['pushbroom', 'stripmap-sar', 'flyby-swath', 'multi-angle', 'whiskbroom']) {
    it(`${family}: state and quality are deep-equal, epoch and edges rendering grade`, () => {
      const strip = fixture(family);
      const back = enhancedGeoJsonToStrip(stripToEnhancedGeoJson(strip)).strip;
      expect(back.segments.length).toBe(strip.segments.length);
      strip.segments.forEach((s, i) => {
        const b = back.segments[i]!;
        expect(b.state).toBe(s.state);
        expect(b.quality ?? null).toEqual(s.quality ?? null);
        // Epoch survives the Unix-second conversion to rendering grade.
        expect(b.etSec).toBeCloseTo(s.etSec, 6);
        // Edge direction is rendering grade; the radius is preserved exactly.
        expect(dist(b.left, s.left)).toBeLessThan(1e-6);
        expect(dist(b.right, s.right)).toBeLessThan(1e-6);
      });
    });
  }

  it('the re-imported strip passes validateStrip', () => {
    for (const family of ['pushbroom', 'stripmap-sar', 'flyby-swath', 'multi-angle']) {
      const back = enhancedGeoJsonToStrip(stripToEnhancedGeoJson(fixture(family))).strip;
      expect(validateStrip(back).errors).toEqual([]);
    }
  });

  it('reads the reserved members by name, so producer column order is free', () => {
    const strip = fixture('stripmap-sar');
    const fc = stripToEnhancedGeoJson(strip);
    // Re-order two members past the required longitude, latitude, elevation
    // (incidence and look count swap places); the codec finds them by name.
    const names = [...fc.coord_properties!];
    const iA = names.indexOf('incidence_deg_min');
    const iB = names.indexOf('look_count');
    [names[iA], names[iB]] = [names[iB]!, names[iA]!];
    const swap = (row: readonly (number | null)[]): (number | null)[] => {
      const r = [...row];
      [r[iA], r[iB]] = [r[iB]!, r[iA]!];
      return r;
    };
    const geom = fc.features[0]!.geometry as { type: 'MultiLineString'; coordinates: (number | null)[][][] };
    const reordered: GeoJsonFeatureCollection = {
      ...fc,
      coord_properties: names,
      features: [{ ...fc.features[0]!, geometry: { type: 'MultiLineString', coordinates: [geom.coordinates[0]!.map(swap), geom.coordinates[1]!.map(swap)] } }],
    };
    const back = enhancedGeoJsonToStrip(reordered).strip;
    expect(back.segments[0]!.quality).toEqual(strip.segments[0]!.quality);
  });
});

describe('Enhanced GeoJSON passthrough (ADR-0011: producer columns survive)', () => {
  it('an unmodeled column survives a round trip byte for byte', () => {
    const fc = stripToEnhancedGeoJson(fixture('pushbroom'));
    const geom = fc.features[0]!.geometry as { type: 'MultiLineString'; coordinates: (number | null)[][][] };
    // Inject a producer column MMGIS might attach: a per-vertex yaw.
    const yaw = (edge: number, i: number): number => edge * 100 + i + 0.5;
    const withYaw: GeoJsonFeatureCollection = {
      ...fc,
      coord_properties: [...fc.coord_properties!, 'yaw'],
      features: [{
        ...fc.features[0]!,
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            geom.coordinates[0]!.map((c, i) => [...c, yaw(0, i)]),
            geom.coordinates[1]!.map((c, i) => [...c, yaw(1, i)]),
          ],
        },
      }],
    };

    const { strip, passthrough } = enhancedGeoJsonToStrip(withYaw);
    expect(passthrough).toBeDefined();
    expect(passthrough!.names).toEqual(['yaw']);
    expect(passthrough!.left.map((v) => v[0])).toEqual(strip.segments.map((_, i) => yaw(0, i)));

    // Re-export with the sidecar; the yaw column comes back untouched.
    const out = stripToEnhancedGeoJson(strip, { passthrough: passthrough! });
    expect(out.coord_properties).toEqual([...RESERVED_COORD_PROPERTIES, 'yaw']);
    const outGeom = out.features[0]!.geometry as { type: 'MultiLineString'; coordinates: (number | null)[][][] };
    const yawIndex = out.coord_properties!.indexOf('yaw');
    expect(outGeom.coordinates[0]!.map((c) => c[yawIndex])).toEqual(strip.segments.map((_, i) => yaw(0, i)));
    expect(outGeom.coordinates[1]!.map((c) => c[yawIndex])).toEqual(strip.segments.map((_, i) => yaw(1, i)));
  });
});

describe('standard GeoJSON (RFC 7946)', () => {
  const isFiniteNumberGrid = (coords: unknown): boolean =>
    Array.isArray(coords) && coords.every((c) => Array.isArray(c)
      ? isFiniteNumberGrid(c)
      : typeof c === 'number' && Number.isFinite(c));

  it('exports a valid FeatureCollection with a numeric polygon and feature-level provenance', () => {
    const strip = fixture('stripmap-sar');
    const fc = stripToGeoJson(strip);
    expect(fc.type).toBe('FeatureCollection');
    const feature = fc.features[0]!;
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Polygon');
    expect(isFiniteNumberGrid(feature.geometry.coordinates)).toBe(true);
    // A polygon ring closes on itself (RFC 7946).
    const ring = (feature.geometry as unknown as { coordinates: number[][][] }).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // AGE-14 provenance at the feature level.
    expect(feature.properties.instrumentId).toBe(strip.instrumentId);
    expect(feature.properties.passId ?? strip.passId).toBeDefined();
    expect((feature.properties.quality as { incidenceDeg?: unknown }).incidenceDeg).toEqual([20, 45]);
    // Serializes and re-parses as plain JSON (no NaN, no undefined).
    expect(JSON.parse(JSON.stringify(fc))).toEqual(fc);
  });

  it('a zero-width track exports as a LineString', () => {
    const fc = stripToGeoJson(fixture('profiler'));
    expect(fc.features[0]!.geometry.type).toBe('LineString');
  });

  it('ingests a standard outline into a valid minimal strip', () => {
    const strip = fixture('pushbroom');
    const fc = stripToGeoJson(strip);
    const back = geoJsonToStrip(fc, { body: 'EARTH', frame: 'ITRF93', instrumentId: 'imported', bodyRadiusKm: 6371 });
    expect(validateStrip(back).errors).toEqual([]);
    expect(back.segments.every((s) => s.state === 'committed')).toBe(true);
    expect(back.provenance.generatedBy).toMatch(/outline grade/);
  });

  it('a single-segment strip exports RFC 7946-valid geometry, not a 3-position ring', () => {
    const one: Strip = {
      id: 'one', body: 'EARTH', frame: 'ITRF93', instrumentId: 'test',
      segments: [{ etSec: 0, left: [6371, 0, 5], right: [6371, 0, -5], state: 'committed' }],
      provenance: { authority: 'test', generatedBy: 'test' },
    };
    expect(stripToGeoJson(one).features[0]!.geometry.type).toBe('LineString');
    const zero: Strip = { ...one, segments: [{ etSec: 0, left: [6371, 0, 0], right: [6371, 0, 0], state: 'committed' }] };
    expect(stripToGeoJson(zero).features[0]!.geometry.type).toBe('Point');
  });
});

describe('codec robustness (review findings)', () => {
  const enhanced = (family: string): GeoJsonFeatureCollection => stripToEnhancedGeoJson(fixture(family));
  const mlsCoords = (fc: GeoJsonFeatureCollection): (number | null)[][][] =>
    (fc.features[0]!.geometry as unknown as { coordinates: (number | null)[][][] }).coordinates;

  it('refuses foreign Enhanced GeoJSON with no bodyRadiusKm, and honors a caller-supplied one', () => {
    const fc = enhanced('pushbroom');
    delete (fc.features[0]!.properties as Record<string, unknown>).bodyRadiusKm;
    expect(() => enhancedGeoJsonToStrip(fc)).toThrow(/bodyRadiusKm/);
    const back = enhancedGeoJsonToStrip(fc, { bodyRadiusKm: 6371 }).strip;
    expect(validateStrip(back).errors).toEqual([]);
  });

  it('reads a NaN coordinate member as absent, never a NaN edge or epoch', () => {
    const fc = enhanced('pushbroom');
    const coords = mlsCoords(fc);
    coords[0]![0]![3] = NaN; // event_seconds of the first left vertex
    const back = enhancedGeoJsonToStrip(fc).strip;
    expect(Number.isFinite(back.segments[0]!.etSec)).toBe(true);
    expect(validateStrip(back).errors).toEqual([]);
  });

  it('honors a feature-level coord_properties override', () => {
    const fc = enhanced('stripmap-sar');
    const feature = { ...fc.features[0]!, coord_properties: [...fc.coord_properties!] };
    const moved: GeoJsonFeatureCollection = { ...fc, coord_properties: ['longitude', 'latitude', 'elevation'], features: [feature] };
    const back = enhancedGeoJsonToStrip(moved).strip;
    expect(back.segments[0]!.quality).toEqual(fixture('stripmap-sar').segments[0]!.quality);
  });

  it('refuses empty edges and a MultiLineString that is not exactly two edges', () => {
    const empty = enhanced('pushbroom');
    (empty.features[0]!.geometry as unknown as { coordinates: unknown[][] }).coordinates = [[], []];
    expect(() => enhancedGeoJsonToStrip(empty)).toThrow(/must not be empty/);
    const three = enhanced('pushbroom');
    const c = mlsCoords(three);
    (three.features[0]!.geometry as unknown as { coordinates: unknown[] }).coordinates = [c[0]!, c[1]!, c[0]!];
    expect(() => enhancedGeoJsonToStrip(three)).toThrow(/exactly two edges/);
  });

  it('defaults an unreadable state to planned and discloses it', () => {
    const fc = enhanced('pushbroom');
    const stateIdx = fc.coord_properties!.indexOf('state');
    mlsCoords(fc).forEach((edge) => edge.forEach((v) => { v[stateIdx] = 9; })); // out of range
    const back = enhancedGeoJsonToStrip(fc).strip;
    expect(back.segments.every((s) => s.state === 'planned')).toBe(true);
    expect(back.provenance.generatedBy).toMatch(/state defaulted to planned/);
  });

  it('discloses an incomplete quality column rather than dropping it silently', () => {
    const strip = fixture('stripmap-sar'); // carries incidenceDeg [min, max]
    const fc = stripToEnhancedGeoJson(strip);
    // Drop the max member from the document, leaving a half-present pair.
    const maxIdx = fc.coord_properties!.indexOf('incidence_deg_max');
    const names = fc.coord_properties!.filter((_, i) => i !== maxIdx);
    const drop = (edge: (number | null)[][]): (number | null)[][] => edge.map((c) => c.filter((_, i) => i !== maxIdx));
    const geom = mlsCoords(fc);
    const partial: GeoJsonFeatureCollection = {
      ...fc, coord_properties: names,
      features: [{ ...fc.features[0]!, geometry: { type: 'MultiLineString', coordinates: [drop(geom[0]!), drop(geom[1]!)] } }],
    };
    const back = enhancedGeoJsonToStrip(partial).strip;
    expect(back.segments[0]!.quality?.incidenceDeg).toBeUndefined();
    expect(back.provenance.generatedBy).toMatch(/incomplete quality columns dropped: incidence_deg_min/);
  });

  it('keeps the epoch monotonic and rendering grade across a leap boundary (time.ts fixed point)', () => {
    const etB = utcUnixToEt(Date.UTC(2017, 0, 1) / 1000); // the 2017 leap step
    const edge = (z: number): Vec3 => [6371, 0, z];
    const strip: Strip = {
      id: 'leap', body: 'EARTH', frame: 'ITRF93', instrumentId: 'test',
      segments: [
        { etSec: etB - 5.5, left: edge(1), right: edge(-1), state: 'committed' },
        { etSec: etB - 5.0, left: edge(2), right: edge(-2), state: 'committed' },
      ],
      provenance: { authority: 'test', generatedBy: 'test' },
    };
    const back = enhancedGeoJsonToStrip(stripToEnhancedGeoJson(strip)).strip;
    expect(validateStrip(back).errors).toEqual([]); // monotonic etSec survives
    expect(back.segments[0]!.etSec).toBeCloseTo(etB - 5.5, 4);
    expect(back.segments[1]!.etSec).toBeCloseTo(etB - 5.0, 4);
  });
});
