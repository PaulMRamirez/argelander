/**
 * Golden-image visual corpus (AGE-17). Every geometry family is rendered
 * through the real painter into the recording context and snapshotted as its
 * complete draw program: the ordered fills and strokes with the path, hue,
 * alpha, width, dash, composite, ellipse rotation, and now-glow in force at
 * each. That trace is the image; a raster is one deterministic rasterizer away
 * and carries no information the trace does not, so the golden stays a vector,
 * flake-free and diffable, with no canvas dependency crossing into the tests.
 *
 * Family geometry is locked under mechanism, the richest program; treatment
 * styling is locked on two anchors across all six treatments (see below), so
 * the corpus is the regression surface without the redundant 21-by-6 product.
 * The goldens are the engine's own output, not the atlas tiles re-projected:
 * the atlas stays a hand-authored exploration surface, and these lock what the
 * painter draws today so a regression in any family shows as a diff. The
 * numeric half of AGE-17 lives core-side, where fixtures.test and the sampler
 * round-trips pin every family's strip geometry against its model.
 */
import { describe, expect, it } from 'vitest';
import { GEOMETRY_FAMILIES } from 'argelander-core';
import { stripToGeo } from '../src/geo.js';
import { paintStrip, TREATMENTS } from '../src/paint.js';
import type { PaintOptions, Treatment } from '../src/paint.js';
import { FakeCtx, fixtureStrip, makeProjector } from './fake-ctx.js';

// The scale the painter tests already use: wide enough that mechanism clears
// its LOD gate, so every family renders its texture rather than an envelope.
const PROJECT = makeProjector(20);

/** Coordinates rounded to the pixel tenth: below what a viewer resolves, above float noise. */
const round = (n: number): number => Math.round(n * 10) / 10;

/** The now clock sits partway through the pass so now-trail extrudes a partial trail. */
function nowFor(first: number, last: number): number {
  return first + 0.6 * (last - first);
}

/** One painter run into the recorder, serialized to its ordered draw program. */
function trace(family: string, treatment: Treatment): string {
  const geo = stripToGeo(fixtureStrip(family));
  const first = geo.segments[0]!.etSec;
  const last = geo.segments[geo.segments.length - 1]!.etSec;
  const options: PaintOptions = { treatment, nowEtSec: nowFor(first, last) };
  const ctx = new FakeCtx();
  paintStrip(ctx, geo, PROJECT, options);
  return ctx.ops
    .map((o) => {
      const path = o.path.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
      // Rotation rides only ellipse footprints; the glow only the now overlay.
      // Appending them just where they apply keeps every other line stable and
      // still locks the two channels a recorder that drops them stays blind to.
      const rot = o.shape === 'ellipse' ? ` rot=${Math.round(o.rot * 1000) / 1000}` : '';
      const glow = o.shadowBlur > 0 ? ` glow=${o.shadowColor}/${o.shadowBlur}` : '';
      return `${o.op} ${o.shape} [${path}] f=${o.fillStyle} s=${o.strokeStyle} `
        + `w=${round(o.lineWidth)} dash=[${o.dash.join(',')}] comp=${o.composite}${rot}${glow}`;
    })
    .join('\n');
}

const families = [...GEOMETRY_FAMILIES].sort();

// The two coverage axes kept orthogonal so the corpus stays the regression
// surface without the redundant 21x6 cross-product. Family geometry is locked
// under mechanism, the richest program; treatment styling is locked on two
// anchors across all six treatments. Pushbroom (atlas tile 1) is the
// width-bearing anchor; profiler is a zero-width bead anchor, so the treatment
// branches that only fire when a strip has no cross-track width (paintGuide's
// all-zero-width track underlay under now-trail, the lone-bead paths) are held
// too. Per-treatment behavior on the remaining families (hue counts, quad
// connectivity, dashes, burst breaks) is asserted directly in paint.test, so a
// per-family per-treatment golden would re-lock the same geometry for no signal.
const STYLING_ANCHORS = ['pushbroom', 'profiler'] as const;

describe('golden-image visual corpus: family geometry and treatment styling (AGE-17)', () => {
  it('covers exactly the 21 families, so a new family cannot skip its golden', () => {
    expect(families.length).toBe(21);
    for (const anchor of STYLING_ANCHORS) expect(families).toContain(anchor);
  });

  // Mechanism paints the richest program (footprints, sub-swath quilts, beads,
  // events, looks), so a family that draws nothing there is a real defect, not
  // a treatment that happens to be empty for that geometry.
  for (const family of families) {
    it(`geometry: ${family} under mechanism`, () => {
      const program = trace(family, 'mechanism');
      expect(program.length).toBeGreaterThan(0);
      expect(program).toMatchSnapshot();
    });
  }

  for (const anchor of STYLING_ANCHORS) {
    for (const treatment of TREATMENTS) {
      it(`styling: ${anchor} under ${treatment}`, () => {
        expect(trace(anchor, treatment)).toMatchSnapshot();
      });
    }
  }
});
