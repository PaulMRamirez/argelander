import { describe, it, expect } from 'vitest';
import { validateStrip } from '../src/index.js';
import type { Strip } from '../src/index.js';
import fixture from '../fixtures/strips/pushbroom.json';

const strip = fixture as unknown as Strip;

describe('SPEC-STRIP invariants', () => {
  it('accepts the pushbroom anchor fixture', () => {
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

  it('accepts zero-width segments (beads are not inflated)', () => {
    const seg = { ...strip.segments[0]!, right: strip.segments[0]!.left };
    expect(validateStrip({ ...strip, segments: [seg] }).ok).toBe(true);
  });

  it('rejects invalid sub-structure', () => {
    const seg = {
      ...strip.segments[0]!,
      sub: [{ kind: 'frame', corners: [[0, 0, 0], [1, 1, 1]] }],
    } as unknown as Strip['segments'][number];
    const r = validateStrip({ ...strip, segments: [seg] });
    expect(r.errors).toEqual(['segment 0 sub 0: corners invalid']);
  });

  it('rejects unordered quality tuples and negative look counts', () => {
    const base = strip.segments[0]!;
    const badRange = { ...base, quality: { incidenceDeg: [50, 20] as const } };
    expect(validateStrip({ ...strip, segments: [badRange] }).ok).toBe(false);
    const badCount = { ...base, quality: { lookCount: -1 } };
    expect(validateStrip({ ...strip, segments: [badCount] }).ok).toBe(false);
  });
});
