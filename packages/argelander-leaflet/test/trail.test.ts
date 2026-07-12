import { describe, expect, it } from 'vitest';
import { applyTrailFade, trailFadeAlpha } from '../src/trail.js';
import { FakeCtx } from './fake-ctx.js';

describe('trail decay (AGE-10)', () => {
  it('realizes exponential decay: one time constant leaves 1/e', () => {
    expect(trailFadeAlpha(0, 4)).toBe(0);
    expect(trailFadeAlpha(4, 4)).toBeCloseTo(1 - 1 / Math.E, 9);
    expect(trailFadeAlpha(1000, 4)).toBeCloseTo(1, 6);
    expect(trailFadeAlpha(1, 4)).toBeGreaterThan(trailFadeAlpha(0.5, 4));
  });

  it('fades through destination-out and restores the composite mode', () => {
    const ctx = new FakeCtx();
    ctx.globalCompositeOperation = 'source-over';
    applyTrailFade(ctx, 100, 50, 0.25);
    const rects = ctx.ops.filter((o) => o.op === 'fillRect');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.composite).toBe('destination-out');
    expect(rects[0]!.fillStyle).toBe('rgba(0,0,0,0.25)');
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('is a no-op for a zero-length frame', () => {
    const ctx = new FakeCtx();
    applyTrailFade(ctx, 100, 50, trailFadeAlpha(0, 4));
    expect(ctx.ops).toHaveLength(0);
  });
});
