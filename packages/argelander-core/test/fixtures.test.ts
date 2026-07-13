import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GEOMETRY_FAMILIES, validateInstrumentModel, validateStrip } from '../src/index.js';
import type { InstrumentModel, Strip } from '../src/index.js';
import { validateAgainstSchema } from './schema-lite.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));
const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../schemas/strip.schema.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

const names = (dir: string): string[] =>
  readdirSync(fixturesDir + dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

describe('fixture corpus: one model and one strip per family (AGE-03)', () => {
  it('covers exactly the 21 geometry families', () => {
    const families = [...GEOMETRY_FAMILIES].sort();
    expect(GEOMETRY_FAMILIES.length).toBe(21);
    expect(names('models')).toEqual(families);
    expect(names('strips')).toEqual(families);
  });

  for (const family of names('models')) {
    it(`model ${family} passes validateInstrumentModel`, () => {
      const model = JSON.parse(readFileSync(`${fixturesDir}models/${family}.json`, 'utf8')) as InstrumentModel;
      expect(model.kind).toBe(family);
      expect(validateInstrumentModel(model).errors).toEqual([]);
    });
  }

  for (const family of names('strips')) {
    it(`strip ${family} passes validateStrip and the JSON schema`, () => {
      const raw = JSON.parse(readFileSync(`${fixturesDir}strips/${family}.json`, 'utf8')) as Strip;
      expect(validateStrip(raw).errors).toEqual([]);
      expect(validateAgainstSchema(schema, raw)).toEqual([]);
    });
  }
});

describe('the schema is closed (SPEC-STRIP section 6)', () => {
  it('rejects unknown fields and bad sub kinds', () => {
    const strip = JSON.parse(readFileSync(`${fixturesDir}strips/pushbroom.json`, 'utf8')) as Record<string, unknown>;
    expect(validateAgainstSchema(schema, { ...strip, extra: 1 })).not.toEqual([]);
    const seg = { etSec: 0, left: [1, 2, 3], right: [1, 2, 3], state: 'committed', sub: [{ kind: 'nope' }] };
    expect(validateAgainstSchema(schema, { ...strip, segments: [seg] })).not.toEqual([]);
  });

  it('rejects a non-positive event radiusKm at the schema layer (ADR-0010)', () => {
    const strip = JSON.parse(readFileSync(`${fixturesDir}strips/pushbroom.json`, 'utf8')) as Record<string, unknown>;
    const seg = { etSec: 0, left: [1, 2, 3], right: [1, 2, 3], state: 'committed', sub: [{ kind: 'event', center: [1, 2, 3], radiusKm: 0 }] };
    expect(validateAgainstSchema(schema, { ...strip, segments: [seg] })).not.toEqual([]);
    const ok = { etSec: 0, left: [1, 2, 3], right: [1, 2, 3], state: 'committed', sub: [{ kind: 'event', center: [1, 2, 3], radiusKm: 3.4 }] };
    expect(validateAgainstSchema(schema, { ...strip, segments: [ok] })).toEqual([]);
  });
});
