import { describe, it, expect } from 'vitest';
import { validateStrip } from '../src/index.js';
import type { Strip } from '../src/index.js';
import fixture from '../fixtures/pushbroom-pass.json';

const strip = fixture as unknown as Strip;

describe('SPEC-STRIP invariants', () => {
  it('accepts the pushbroom seed fixture', () => {
    const r = validateStrip(strip);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('rejects nonmonotonic time', () => {
    const bad: Strip = { ...strip, segments: [strip.segments[1]!, strip.segments[0]!] };
    const r = validateStrip(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('etSec decreases'))).toBe(true);
  });

  it('rejects missing provenance authority', () => {
    const bad = { ...strip, provenance: { authority: '', generatedBy: 'x' } } as Strip;
    expect(validateStrip(bad).ok).toBe(false);
  });
});
