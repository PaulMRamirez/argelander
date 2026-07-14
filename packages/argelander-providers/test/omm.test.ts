import { describe, expect, it } from 'vitest';
import { DeepSpaceUnsupportedError, Sgp4Provider, parseOmm, parseOmms, parseTle } from '../src/index.js';
import type { Tle } from '../src/index.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// The demo ISS element set, the anchor every OMM form is checked against.
const L1 = '1 25544U 98067A   26192.31485778  .00005525  00000+0  10843-3 0  9998';
const L2 = '2 25544  51.6302 180.6822 0006688 282.4935  77.5305 15.48978902575497';

interface OmmFields {
  OBJECT_NAME: string; NORAD_CAT_ID: number; EPOCH: string; MEAN_MOTION: number;
  ECCENTRICITY: number; INCLINATION: number; RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number; MEAN_ANOMALY: number; BSTAR: number;
}

/** The same mean elements a Tle carries, expressed the way an OMM states them. */
function ommFieldsFromTle(t: Tle): OmmFields {
  return {
    OBJECT_NAME: t.name ?? 'UNNAMED',
    NORAD_CAT_ID: Number(t.satnum),
    EPOCH: new Date(t.epochUtcUnixSec * 1000).toISOString(),
    MEAN_MOTION: (t.meanMotionRadPerMin * 1440) / (2 * Math.PI),
    ECCENTRICITY: t.ecc,
    INCLINATION: t.inclRad * RAD2DEG,
    RA_OF_ASC_NODE: t.raanRad * RAD2DEG,
    ARG_OF_PERICENTER: t.argpRad * RAD2DEG,
    MEAN_ANOMALY: t.meanAnomalyRad * RAD2DEG,
    BSTAR: t.bstar,
  };
}

function fieldsToKvn(f: OmmFields): string {
  return [
    'CCSDS_OMM_VERS = 3.0', 'CREATION_DATE = 2026-07-11T00:00:00', 'ORIGINATOR = TEST',
    'META_START',
    `OBJECT_NAME = ${f.OBJECT_NAME}`, 'OBJECT_ID = 1998-067A', 'CENTER_NAME = EARTH',
    'REF_FRAME = TEME', 'TIME_SYSTEM = UTC', 'MEAN_ELEMENT_THEORY = SGP4',
    'META_STOP', 'DATA_START',
    `EPOCH = ${f.EPOCH}`, `MEAN_MOTION = ${f.MEAN_MOTION} [rev/day]`,
    `ECCENTRICITY = ${f.ECCENTRICITY}`, `INCLINATION = ${f.INCLINATION} [deg]`,
    `RA_OF_ASC_NODE = ${f.RA_OF_ASC_NODE} [deg]`, `ARG_OF_PERICENTER = ${f.ARG_OF_PERICENTER} [deg]`,
    `MEAN_ANOMALY = ${f.MEAN_ANOMALY} [deg]`, `NORAD_CAT_ID = ${f.NORAD_CAT_ID}`,
    `BSTAR = ${f.BSTAR} [1/ER]`, 'DATA_STOP',
  ].join('\n');
}

function fieldsToXml(f: OmmFields): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<omm id="CCSDS_OMM_VERS" version="3.0"><body><segment>
<metadata><OBJECT_NAME>${f.OBJECT_NAME}</OBJECT_NAME><OBJECT_ID>1998-067A</OBJECT_ID>
<CENTER_NAME>EARTH</CENTER_NAME><REF_FRAME>TEME</REF_FRAME><TIME_SYSTEM>UTC</TIME_SYSTEM>
<MEAN_ELEMENT_THEORY>SGP4</MEAN_ELEMENT_THEORY></metadata>
<data><meanElements><EPOCH>${f.EPOCH}</EPOCH><MEAN_MOTION>${f.MEAN_MOTION}</MEAN_MOTION>
<ECCENTRICITY>${f.ECCENTRICITY}</ECCENTRICITY><INCLINATION>${f.INCLINATION}</INCLINATION>
<RA_OF_ASC_NODE>${f.RA_OF_ASC_NODE}</RA_OF_ASC_NODE><ARG_OF_PERICENTER>${f.ARG_OF_PERICENTER}</ARG_OF_PERICENTER>
<MEAN_ANOMALY>${f.MEAN_ANOMALY}</MEAN_ANOMALY></meanElements>
<tleParameters><NORAD_CAT_ID>${f.NORAD_CAT_ID}</NORAD_CAT_ID><BSTAR>${f.BSTAR}</BSTAR></tleParameters>
</data></segment></body></omm>`;
}

async function track(provider: Sgp4Provider, epochEt: number): Promise<Float64Array> {
  const batch = await provider.states({
    targets: ['25544'], observer: 'EARTH', frame: 'TEME', correction: 'NONE',
    epochs: { start: epochEt, end: epochEt + 3600, step: 300 },
  });
  return batch.states;
}

describe('parseOmm (AGE-04, PHASE-5): the modern element container feeds the SGP4 path', () => {
  const tle = parseTle(L1, L2, 'ISS (ZARYA)');
  const fields = ommFieldsFromTle(tle);
  const forms: Array<[string, string | object]> = [
    ['GP JSON', fields as unknown as object],
    ['OMM KVN', fieldsToKvn(fields)],
    ['OMM XML', fieldsToXml(fields)],
  ];

  for (const [label, doc] of forms) {
    it(`${label} parses to the same elements as the TLE`, () => {
      const t = parseOmm(doc);
      expect(t.inclRad).toBeCloseTo(tle.inclRad, 9);
      expect(t.raanRad).toBeCloseTo(tle.raanRad, 9);
      expect(t.ecc).toBeCloseTo(tle.ecc, 9);
      expect(t.argpRad).toBeCloseTo(tle.argpRad, 9);
      expect(t.meanAnomalyRad).toBeCloseTo(tle.meanAnomalyRad, 9);
      expect(t.meanMotionRadPerMin).toBeCloseTo(tle.meanMotionRadPerMin, 12);
      expect(t.bstar).toBeCloseTo(tle.bstar, 12);
      expect(t.epochEt).toBeCloseTo(tle.epochEt, 2);
      expect(t.satnum).toBe('25544');
      expect(t.name).toBe('ISS (ZARYA)');
    });

    it(`${label} renders the same ground track as the TLE`, async () => {
      const fromTle = new Sgp4Provider([{ line1: L1, line2: L2, name: 'ISS' }], { id: 'tle' });
      const fromOmm = new Sgp4Provider([parseOmm(doc)], { id: 'omm' });
      const [a, b] = await Promise.all([track(fromTle, tle.epochEt), track(fromOmm, tle.epochEt)]);
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        // The only difference is the epoch's millisecond quantization through
        // the ISO string, a few millimetres; a real misparse would be kilometres.
        expect(Math.abs(b[i]! - a[i]!)).toBeLessThan(0.02);
      }
    });
  }

  it('parses a real Celestrak GP JSON that omits the frame and theory metadata', () => {
    const celestrak = [{
      OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-07-11T07:33:23.712384',
      MEAN_MOTION: 15.48978902, ECCENTRICITY: 0.0006688, INCLINATION: 51.6302,
      RA_OF_ASC_NODE: 180.6822, ARG_OF_PERICENTER: 282.4935, MEAN_ANOMALY: 77.5305,
      EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: 25544,
      ELEMENT_SET_NO: 999, REV_AT_EPOCH: 57549, BSTAR: 0.00010843,
      MEAN_MOTION_DOT: 0.00005525, MEAN_MOTION_DDOT: 0,
    }];
    const [t] = parseOmms(celestrak);
    expect(t!.inclRad).toBeCloseTo(51.6302 * DEG2RAD, 9);
    expect(t!.satnum).toBe('25544');
    expect(t!.name).toBe('ISS (ZARYA)');
    expect(() => new Sgp4Provider([t!])).not.toThrow();
  });

  it('parseOmms returns every element set, from a JSON array and a multi-segment XML', () => {
    const two = [ommFieldsFromTle(tle), { ...ommFieldsFromTle(tle), NORAD_CAT_ID: 43013, OBJECT_NAME: 'TWIN' }];
    expect(parseOmms(two as unknown as object)).toHaveLength(2);
    const xml = `<omm><body>${fieldsToXml(fields).match(/<segment>[\s\S]*<\/segment>/)![0]}${fieldsToXml({ ...fields, NORAD_CAT_ID: 43013 }).match(/<segment>[\s\S]*<\/segment>/)![0]}</body></omm>`;
    expect(parseOmms(xml)).toHaveLength(2);
  });

  it('parseOmm refuses a multi-object document', () => {
    const two = [ommFieldsFromTle(tle), ommFieldsFromTle(tle)];
    expect(() => parseOmm(two as unknown as object)).toThrow(/single element set/);
  });

  it('refuses malformed and out-of-scope element sets', () => {
    const base = ommFieldsFromTle(tle) as unknown as Record<string, unknown>;
    expect(() => parseOmm({ ...base, EPOCH: undefined })).toThrow(/EPOCH/);
    expect(() => parseOmm({ ...base, ECCENTRICITY: 1.4 })).toThrow(/eccentricity/);
    expect(() => parseOmm({ ...base, MEAN_MOTION: 0 })).toThrow(/mean motion/);
    expect(() => parseOmm({ ...base, REF_FRAME: 'EME2000' })).toThrow(/REF_FRAME/);
    expect(() => parseOmm({ ...base, MEAN_ELEMENT_THEORY: 'DSST' })).toThrow(/MEAN_ELEMENT_THEORY/);
    expect(() => parseOmm({ ...base, TIME_SYSTEM: 'TAI' })).toThrow(/TIME_SYSTEM/);
    expect(() => parseOmm('')).toThrow(/empty/);
    expect(() => parseOmms([])).toThrow(/empty/);
  });

  it('reads a multi-message KVN, the Celestrak bulk download shape', () => {
    const doc = `${fieldsToKvn(fields)}\n${fieldsToKvn({ ...fields, NORAD_CAT_ID: 43013, OBJECT_NAME: 'TWIN' })}`;
    const sets = parseOmms(doc);
    expect(sets).toHaveLength(2);
    expect(sets[1]!.satnum).toBe('43013');
  });

  it('parses a CCSDS ordinal (day-of-year) epoch to the same instant as the calendar form', () => {
    const calendar = parseOmm({ ...ommFieldsFromTle(tle), EPOCH: '2026-07-11T00:00:00' });
    const ordinal = parseOmm({ ...ommFieldsFromTle(tle), EPOCH: '2026-192T00:00:00' });
    expect(ordinal.epochEt).toBeCloseTo(calendar.epochEt, 6);
  });

  it('parses a deep-space element set but refuses it where a deep-space TLE is refused', () => {
    const molniya = {
      OBJECT_NAME: 'MOLNIYA', NORAD_CAT_ID: 44444, EPOCH: '2026-07-11T00:00:00',
      MEAN_MOTION: 2.006, ECCENTRICITY: 0.72, INCLINATION: 63.4,
      RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 270, MEAN_ANOMALY: 10, BSTAR: 0,
    };
    expect(() => parseOmm(molniya)).not.toThrow();
    expect(() => new Sgp4Provider([parseOmm(molniya)])).toThrow(DeepSpaceUnsupportedError);
  });
});
