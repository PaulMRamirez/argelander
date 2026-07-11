import { describe, expect, it } from 'vitest';
import {
  CoverageRefusalError, SOFT_MAX_EPOCHS_PER_QUERY,
  decodeQuat, decodeState, expandEpochs,
} from '../src/index.js';
import type { QuatBatch, StateBatch } from '../src/index.js';

/** Batch where every double equals its own flat index, making layout checks exact. */
function indexBatch(targets: string[], epochs: number[]): StateBatch {
  const n = epochs.length;
  return {
    targets,
    observer: 'EARTH',
    frame: 'ITRF93',
    correction: 'NONE',
    epochs: Float64Array.from(epochs),
    states: Float64Array.from({ length: targets.length * n * 6 }, (_, i) => i),
    lightTimes: Float64Array.from({ length: targets.length * n }, (_, i) => i),
  };
}

describe('SPEC-PROVIDER seam helpers', () => {
  it('expands explicit epoch lists verbatim', () => {
    expect([...expandEpochs([1, 2, 3.5])]).toEqual([1, 2, 3.5]);
  });

  it('expands ranges inclusive of end', () => {
    expect([...expandEpochs({ start: 0, end: 1, step: 0.25 })]).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([...expandEpochs({ start: 5, end: 5, step: 10 })]).toEqual([5]);
  });

  it('refuses invalid ranges', () => {
    expect(() => expandEpochs({ start: 1, end: 0, step: 1 })).toThrow(RangeError);
    expect(() => expandEpochs({ start: 0, end: 1, step: 0 })).toThrow(RangeError);
  });

  it('decodes states per the pinned flat layout: block (t * n + i) * 6', () => {
    const batch = indexBatch(['A', 'B'], [10, 20, 30]);
    const sample = decodeState(batch, 1, 2);
    expect(sample.etSec).toBe(30);
    expect(sample.positionKm).toEqual([30, 31, 32]);
    expect(sample.velocityKmS).toEqual([33, 34, 35]);
    expect(decodeState(batch, 0, 0).positionKm).toEqual([0, 1, 2]);
  });

  it('bounds-checks decoder indices', () => {
    const batch = indexBatch(['A'], [0]);
    expect(() => decodeState(batch, 1, 0)).toThrow(RangeError);
    expect(() => decodeState(batch, 0, 1)).toThrow(RangeError);
  });

  it('decodes scalar-first quaternions', () => {
    const quats: QuatBatch = {
      body: 'CASSINI',
      frame: 'J2000',
      bodyFrame: 'CASSINI_SC_COORD',
      epochs: Float64Array.from([0, 1]),
      quats: Float64Array.from({ length: 8 }, (_, i) => i),
    };
    expect(decodeQuat(quats, 1)).toEqual([4, 5, 6, 7]);
    expect(() => decodeQuat(quats, 2)).toThrow(RangeError);
  });

  it('carries the structured refusal shape (SPEC-PROVIDER section 4)', () => {
    const err = new CoverageRefusalError('CASSINI', { start: 0, end: 100 }, [{ start: 200, end: 300 }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CoverageRefusalError');
    expect(err.body).toBe('CASSINI');
    expect(err.requested).toEqual({ start: 0, end: 100 });
    expect(err.covered).toEqual([{ start: 200, end: 300 }]);
    expect(err.message).toContain('[200, 300]');
    const bare = new CoverageRefusalError('X', { start: 0, end: 1 }, []);
    expect(bare.message).toContain('none advertised');
  });

  it('pins the soft batch ceiling', () => {
    expect(SOFT_MAX_EPOCHS_PER_QUERY).toBe(65536);
  });
});
