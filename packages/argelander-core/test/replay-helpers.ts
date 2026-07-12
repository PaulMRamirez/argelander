/**
 * Shared machinery for the family sampler round-trip tests: fixture IO, the
 * tolerant deep comparison, and the model-fixture replay that regenerates
 * anchors under UPDATE_FIXTURES=1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { validateStrip } from '../src/index.js';
import type { InstrumentModel, Strip, Vec3 } from '../src/index.js';

export const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const UPDATE = process.env['UPDATE_FIXTURES'] === '1';
export const TOLERANCE = 1e-6;

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(fixturesDir + rel, 'utf8')) as T;
}

/** Deep comparison with numeric tolerance, covering sub-structure and quality. */
export function expectDeepClose(actual: unknown, fixture: unknown, path: string): void {
  if (typeof fixture === 'number') {
    expect(typeof actual, path).toBe('number');
    expect(Math.abs((actual as number) - fixture), path).toBeLessThanOrEqual(TOLERANCE);
    return;
  }
  if (Array.isArray(fixture)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(fixture.length);
    fixture.forEach((v, i) => expectDeepClose((actual as unknown[])[i], v, `${path}[${i}]`));
    return;
  }
  if (fixture !== null && typeof fixture === 'object') {
    const fixtureKeys = Object.keys(fixture as object).sort();
    expect(Object.keys(actual as object).sort(), path).toEqual(fixtureKeys);
    for (const key of fixtureKeys) {
      expectDeepClose(
        (actual as Record<string, unknown>)[key],
        (fixture as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
    return;
  }
  expect(actual, path).toEqual(fixture);
}

/** Model fixture round trip: sample, validate, compare against the anchor. */
export function replayFamily<S>(
  family: string,
  sample: (model: InstrumentModel, scene: S) => Strip,
  scene: S,
): Strip {
  const model = readJson<InstrumentModel>(`models/${family}.json`);
  const strip = sample(model, scene);
  expect(validateStrip(strip).errors).toEqual([]);
  if (UPDATE) {
    writeFileSync(`${fixturesDir}strips/${family}.json`, JSON.stringify(strip, null, 2) + '\n');
  }
  expectDeepClose(strip, readJson<Strip>(`strips/${family}.json`), family);
  return strip;
}

export const chord = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
