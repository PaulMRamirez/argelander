import { describe, expect, it } from 'vitest';
import {
  geoJsonStateProvider, geographicToVec3, parseGeoJsonStates, statesFromPositions,
} from '../src/index.js';
import { utcUnixToEt } from '../src/time.js';

/** A three-vertex Enhanced GeoJSON track: [lon, lat, elevation m, event_seconds]. */
const enhancedTrack = {
  type: 'FeatureCollection',
  coord_properties: ['longitude', 'latitude', 'elevation', 'event_seconds'],
  features: [{
    type: 'Feature',
    properties: { target: 'TRACK' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0, 0, 1000],
        [1, 0.5, 0, 1010],
        [2, 0.0, 200, 1020],
      ],
    },
  }],
};

const QUERY = { observer: 'EARTH', frame: 'ITRF93', correction: 'NONE' as const };

describe('GeoJSON state provider: Enhanced GeoJSON with per-vertex event_seconds', () => {
  it('lifts each vertex to a body-fixed state served at its epoch', async () => {
    const provider = geoJsonStateProvider(enhancedTrack, { bodyRadiusKm: 6371 });
    const etMid = utcUnixToEt(1010);
    const batch = await provider.states({ targets: ['TRACK'], ...QUERY, epochs: [etMid] });
    const expectedPos = geographicToVec3(1, 0.5, 0, 6371);
    expect(batch.states[0]).toBeCloseTo(expectedPos[0], 6);
    expect(batch.states[1]).toBeCloseTo(expectedPos[1], 6);
    expect(batch.states[2]).toBeCloseTo(expectedPos[2], 6);
    expect(batch.frame).toBe('ITRF93');
    expect(batch.correction).toBe('NONE');
  });

  it('velocity at a node equals the shared central differences', async () => {
    const coords = enhancedTrack.features[0]!.geometry.coordinates;
    const epochs = new Float64Array(coords.map((c) => utcUnixToEt(c[3]!)));
    const positions = new Float64Array(coords.flatMap((c) => [...geographicToVec3(c[0]!, c[1]!, c[2]!, 6371)]));
    const expected = statesFromPositions(epochs, positions);
    const provider = geoJsonStateProvider(enhancedTrack, { bodyRadiusKm: 6371 });
    const batch = await provider.states({ targets: ['TRACK'], ...QUERY, epochs: [epochs[1]!] });
    for (let axis = 0; axis < 3; axis++) {
      expect(batch.states[3 + axis]).toBeCloseTo(expected[1 * 6 + 3 + axis]!, 9);
    }
  });

  it('reads the target from feature properties.id when target is absent', () => {
    const doc = {
      type: 'Feature',
      coord_properties: ['longitude', 'latitude', 'elevation', 'event_seconds'],
      properties: { id: 'FROM-ID' },
      geometry: { type: 'MultiPoint', coordinates: [[0, 0, 0, 0], [1, 0, 0, 10]] },
    };
    const [table] = parseGeoJsonStates(doc);
    expect(table!.body).toBe('FROM-ID');
  });

  it('resolves the target from a top-level RFC 7946 feature id', () => {
    const doc = {
      type: 'Feature', id: 'RFC-ID',
      coord_properties: ['longitude', 'latitude', 'elevation', 'event_seconds'],
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0, 0, 0], [1, 0, 0, 10]] },
    };
    const [table] = parseGeoJsonStates(doc);
    expect(table!.body).toBe('RFC-ID');
  });

  const radiusAt = (table: { states: Float64Array }): number =>
    Math.hypot(table.states[0]!, table.states[1]!, table.states[2]!);

  it('reads elevation by name, not misreading event_seconds as an altitude when index 2 is not elevation', () => {
    // event_seconds sits at index 2 and there is no elevation member: elevation
    // must default to 0, not read the unix value as 1000 m.
    const doc = {
      type: 'Feature',
      coord_properties: ['longitude', 'latitude', 'event_seconds'],
      properties: { target: 'T' },
      geometry: { type: 'LineString', coordinates: [[0, 0, 1000], [1, 0, 1010]] },
    };
    const [table] = parseGeoJsonStates(doc, { bodyRadiusKm: 6371 });
    expect(radiusAt(table!)).toBeCloseTo(6371, 6);
  });

  it('reads elevation by name when it comes after event_seconds', () => {
    const doc = {
      type: 'Feature',
      coord_properties: ['longitude', 'latitude', 'event_seconds', 'elevation'],
      properties: { target: 'T' },
      geometry: { type: 'LineString', coordinates: [[0, 0, 0, 20000], [1, 0, 10, 20000]] },
    };
    const [table] = parseGeoJsonStates(doc, { bodyRadiusKm: 6371 });
    expect(radiusAt(table!)).toBeCloseTo(6391, 6); // 20000 m above the 6371 km radius
  });
});

describe('GeoJSON state provider: plain GeoJSON with a time base', () => {
  const plain = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { target: 'PLAIN' },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0]] },
    }],
  };

  it('assigns epochs from startEt and stepSec', async () => {
    const provider = geoJsonStateProvider(plain, { bodyRadiusKm: 6371, timeBase: { startEt: 100, stepSec: 30 } });
    const batch = await provider.states({ targets: ['PLAIN'], ...QUERY, epochs: [130] });
    expect(batch.states[0]).toBeCloseTo(geographicToVec3(1, 0, 0, 6371)[0], 6);
  });
});

describe('GeoJSON state provider: named refusals (like czml)', () => {
  const feature = (geometry: unknown, props: Record<string, unknown> = { target: 'X' }): object => ({
    type: 'Feature', properties: props, geometry,
  });

  it('refuses a plain track with no time source', () => {
    expect(() => parseGeoJsonStates(feature({ type: 'LineString', coordinates: [[0, 0], [1, 0]] })))
      .toThrow(/no per-vertex time/);
  });

  it('refuses both event_seconds and a time base as ambiguous', () => {
    const doc = {
      type: 'Feature', coord_properties: ['longitude', 'latitude', 'elevation', 'event_seconds'],
      properties: { target: 'X' },
      geometry: { type: 'LineString', coordinates: [[0, 0, 0, 1], [1, 0, 0, 2]] },
    };
    expect(() => parseGeoJsonStates(doc, { timeBase: { startEt: 0, stepSec: 1 } })).toThrow(/ambiguous/);
  });

  it('refuses a Point, a Polygon, and a one-vertex track', () => {
    expect(() => parseGeoJsonStates(feature({ type: 'Point', coordinates: [0, 0] }))).toThrow(/constant Point/);
    expect(() => parseGeoJsonStates(feature({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] }), { target: 'X' } as never))
      .toThrow(/unsupported/);
    const oneVertex = {
      type: 'Feature', coord_properties: ['longitude', 'latitude', 'elevation', 'event_seconds'],
      properties: { target: 'X' }, geometry: { type: 'LineString', coordinates: [[0, 0, 0, 1]] },
    };
    expect(() => parseGeoJsonStates(oneVertex)).toThrow(/at least two positions/);
  });

  it('refuses a document that is neither a Feature nor a FeatureCollection', () => {
    expect(() => parseGeoJsonStates({ type: 'GeometryCollection' } as object)).toThrow(/Feature or FeatureCollection/);
  });
});
