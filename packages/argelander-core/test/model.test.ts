import { describe, expect, it } from 'vitest';
import { FAMILY_REQUIRED_PARAMS, GEOMETRY_FAMILIES, validateInstrumentModel } from '../src/index.js';
import type { InstrumentModel } from '../src/index.js';

const valid: InstrumentModel = {
  kind: 'pushbroom',
  name: 'test pushbroom',
  instrumentId: 'test-01',
  mount: [],
  timing: { segmentStepSec: 0.25 },
  params: { swathHalfWidthKm: 62.4 },
};

describe('SPEC-INSTRUMENT-MODEL envelope', () => {
  it('lists 21 families with a required-param vocabulary each', () => {
    expect(GEOMETRY_FAMILIES.length).toBe(21);
    for (const family of GEOMETRY_FAMILIES) {
      expect(FAMILY_REQUIRED_PARAMS[family].length).toBeGreaterThan(0);
    }
  });

  it('accepts a minimal valid model', () => {
    expect(validateInstrumentModel(valid).errors).toEqual([]);
  });

  it('rejects an unknown kind', () => {
    const bad = { ...valid, kind: 'sideways-broom' } as unknown as InstrumentModel;
    expect(validateInstrumentModel(bad).errors.some((e) => e.includes('kind unknown'))).toBe(true);
  });

  it('rejects a missing required param', () => {
    const bad = { ...valid, params: {} };
    expect(validateInstrumentModel(bad).errors).toEqual(['param swathHalfWidthKm missing or invalid']);
  });

  it('rejects nonpositive timing and inverted validity', () => {
    expect(validateInstrumentModel({ ...valid, timing: { segmentStepSec: 0 } }).ok).toBe(false);
    expect(validateInstrumentModel({ ...valid, validity: { start: 10, end: 5 } }).ok).toBe(false);
  });

  it('rejects a bad mount element', () => {
    const bad = { ...valid, mount: [{ kind: 'tripod' }] } as unknown as InstrumentModel;
    expect(validateInstrumentModel(bad).errors).toEqual(['mount 0: kind invalid']);
  });
});
