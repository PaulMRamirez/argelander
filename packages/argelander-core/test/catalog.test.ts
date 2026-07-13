import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GEOMETRY_FAMILIES, PUSHBROOM_SCENE, generatePushbroomStrip, validateInstrumentModel, validateStrip,
} from '../src/index.js';
import type { InstrumentModel } from '../src/index.js';

const catalogDir = fileURLToPath(new URL('../catalog/', import.meta.url));
const names = readdirSync(catalogDir)
  .filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const load = (id: string): InstrumentModel =>
  JSON.parse(readFileSync(`${catalogDir}${id}.json`, 'utf8')) as InstrumentModel;
const families = new Set<string>(GEOMETRY_FAMILIES);

describe('real instrument catalog (AGE-18: models as data, not code)', () => {
  it('carries the seeded instruments, separate from the 21 conformance anchors', () => {
    expect(names.length).toBe(25);
    for (const id of ['aviris-3', 'aviris-5', 'hytes', 'prism', 'master', 'lvis', 'gliht-als',
      'uavsar-lband', 'uavsar-pband', 'uavsar-kaband', 'landsat-8-oli', 'icesat-2-atlas', 'earthcare-msi']) {
      expect(names).toContain(id);
    }
  });

  for (const id of names) {
    it(`${id}: valid model, known family, cited`, () => {
      const model = load(id);
      expect(validateInstrumentModel(model).errors).toEqual([]);
      expect(families.has(model.kind)).toBe(true);
      expect(model.instrumentId).toBe(id);
      // AGE-18: the source of each instrument's optics is cited.
      expect(typeof model.params.sourceUrl).toBe('string');
      expect((model.params.sourceUrl as string).length).toBeGreaterThan(0);
      expect(typeof model.params.sourceNote).toBe('string');
    });
  }

  it('maps each real instrument onto the expected family', () => {
    expect(load('aviris-3').kind).toBe('pushbroom');
    expect(load('hytes').kind).toBe('pushbroom');
    expect(load('prism').kind).toBe('pushbroom');
    expect(load('master').kind).toBe('whiskbroom');
    expect(load('lvis').kind).toBe('whiskbroom');
    expect(load('gliht-als').kind).toBe('whiskbroom');
    expect(load('uavsar-lband').kind).toBe('stripmap-sar');
    expect(load('landsat-8-oli').kind).toBe('pushbroom');
  });

  it('converts a satellite swath width to the half-width', () => {
    expect(load('landsat-8-oli').params.swathHalfWidthKm).toBe(92.5); // 185 / 2
    expect(load('sentinel-2a-msi').params.swathHalfWidthKm).toBe(145); // 290 / 2
    expect(load('icesat-2-atlas').params.swathHalfWidthKm).toBe(3.25); // 6.5 / 2
  });

  it('gives the whiskbroom lidars a real footprint growth from the scan angle', () => {
    // footprintGrowthFactor = 1/cos^2(scanHalf) - 1; G-LiHT at 30 deg -> 1/0.75 - 1 = 1/3.
    expect(load('gliht-als').params.footprintGrowthFactor).toBeCloseTo(1 / 3, 3);
  });

  it('orders the UAVSAR ranges and keeps the imaged side', () => {
    const u = load('uavsar-lband').params;
    expect(u.side).toBe('left');
    expect(u.nearRangeKm as number).toBeGreaterThan(0);
    expect(u.nearRangeKm as number).toBeLessThan(u.farRangeKm as number);
  });

  it('a catalog model renders to a valid strip through the pushbroom sampler', () => {
    // The proof that a catalog model is engine-consumable, not just valid data.
    const strip = generatePushbroomStrip(load('landsat-8-oli'), PUSHBROOM_SCENE);
    expect(validateStrip(strip).errors).toEqual([]);
    expect(strip.instrumentId).toBe('landsat-8-oli');
    expect(strip.segments.length).toBeGreaterThan(0);
  });
});
