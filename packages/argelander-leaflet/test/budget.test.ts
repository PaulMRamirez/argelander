/**
 * Performance budget (AGE-15): 60 fps with 20 animated layers, LOD degrading
 * gracefully before the frame rate does. Two things are provable here without
 * a GPU. The degradation lever is deterministic: below its width threshold a
 * strip paints its envelope, not its mechanism, and the envelope emits
 * strictly fewer draw primitives, so the engine sheds work by count before it
 * sheds frames. The per-frame cost is the JS the adapter spends walking 20
 * strips into the recording context each repaint, the slice AGE owns; the
 * recorder's own bookkeeping is counted alongside the walk, so the figure is
 * an upper bound on the adapter's JS, not an isolate of it. The rasterizer's
 * share is the host's, observed only qualitatively in a browser (the live demo
 * stays smooth, noted in goals/PHASE-1.md), because a recording context cannot
 * stand in for pixels.
 *
 * The frame-time assertion is loose on purpose. The JS walk of 20 fixture
 * strips is sub-millisecond on any reference machine and stays well under the
 * 16.67 ms frame even under a heavily loaded CI runner, so a generous ceiling
 * catches a real order-of-magnitude regression without flaking on scheduler
 * noise. The number it prints is the datum; the ceiling is the guard.
 */
import { describe, expect, it } from 'vitest';
import { GEOMETRY_FAMILIES } from 'argelander-core';
import { stripToGeo } from '../src/geo.js';
import { medianProjectedWidthPx, paintStrip } from '../src/paint.js';
import type { GeoStrip } from '../src/geo.js';
import type { PaintOptions } from '../src/paint.js';
import { FakeCtx, fixtureStrip, makeProjector } from './fake-ctx.js';

const PROJECT = makeProjector(20);
const FRAME_BUDGET_MS = 1000 / 60; // 16.67 ms

/** Twenty animated layers: the 21 families cycled to a full constellation. */
function twentyLayers(): GeoStrip[] {
  const families = [...GEOMETRY_FAMILIES].sort();
  return Array.from({ length: 20 }, (_, i) => stripToGeo(fixtureStrip(families[i % families.length]!)));
}

/** Total draw primitives one strip emits under the given options. */
function opCount(geo: GeoStrip, options: PaintOptions): number {
  const ctx = new FakeCtx();
  paintStrip(ctx, geo, PROJECT, options);
  return ctx.ops.length;
}

/** Median of a sample, robust to the occasional GC pause a mean would smear. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

describe('AGE-15 graceful degradation: LOD sheds primitives before frames', () => {
  it('every swath-bearing family emits strictly fewer ops as envelope than mechanism', () => {
    // The population is chosen independently of the outcome: a family bears a
    // swath when its median cross-track width projects above zero, the same
    // quantity paintStrip's LOD gate reads. Asserting the inequality over that
    // population (rather than gating the assertion on the inequality itself,
    // which would re-check its own guard and never fail) makes the check
    // load-bearing: a swath family that stopped shedding primitives fails here
    // instead of being silently skipped.
    const swath = [...GEOMETRY_FAMILIES].sort().filter(
      (family) => medianProjectedWidthPx(stripToGeo(fixtureStrip(family)), PROJECT) > 0,
    );
    // Only the pure bead and point families lack a swath; if this population
    // collapses, the proof has quietly narrowed and the floor catches it.
    expect(swath.length).toBeGreaterThanOrEqual(18);
    for (const family of swath) {
      const geo = stripToGeo(fixtureStrip(family));
      // 0 keeps the strip in mechanism, Infinity drops it to its envelope.
      const mechanism = opCount(geo, { treatment: 'mechanism', mechanismMinWidthPx: 0 });
      const envelope = opCount(geo, { treatment: 'mechanism', mechanismMinWidthPx: Infinity });
      expect(envelope, `${family}: envelope must shed ops versus mechanism`).toBeLessThan(mechanism);
    }
  });
});

describe('AGE-15 frame budget: 20 layers repainted within the frame', () => {
  it('the per-frame JS repaint of 20 layers stays well inside 16.67 ms', () => {
    const layers = twentyLayers();
    const options: PaintOptions = { treatment: 'mechanism', mechanismMinWidthPx: 0 };
    const frame = (): void => {
      // A fresh context per frame models the clear-and-repaint the host does;
      // reusing one would let ops accumulate and measure the wrong thing.
      const ctx = new FakeCtx();
      for (const geo of layers) paintStrip(ctx, geo, PROJECT, options);
    };
    for (let i = 0; i < 20; i++) frame(); // warm the JIT before timing
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      frame();
      samples.push(performance.now() - t0);
    }
    const med = median(samples);
    const p95 = samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)]!;
    // Surfaced to the run log so the measured datum is recorded alongside the
    // browser fps in the phase ledger, not just asserted away.
    console.log(`AGE-15 node repaint of 20 mechanism layers: median ${med.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms (budget ${FRAME_BUDGET_MS.toFixed(2)} ms)`);
    expect(med).toBeLessThan(FRAME_BUDGET_MS);
  });
});
