import { describe, expect, it } from 'vitest';
import {
  AGILE_SCENE, CONICAL_SCENE, GEO_RASTER_SCENE, LIMB_SCENE, STEP_SCAN_SCENE, TARGET_STARE_SCENE,
  generateAgileTaskingStrip, generateConicalRadiometerStrip, generateGeoRasterStrip,
  generateLimbOccultationStrip, generateStepScanSounderStrip, generateTargetStareStrip,
} from '../src/index.js';
import type { AlongTrackScene, InstrumentModel, Strip } from '../src/index.js';
import { TOLERANCE, chord, readJson, replayFamily as replay } from './replay-helpers.js';

type Sampler = (model: InstrumentModel, scene: AlongTrackScene) => Strip;

const FAMILIES: ReadonlyArray<readonly [string, Sampler, AlongTrackScene]> = [
  ['step-scan-sounder', generateStepScanSounderStrip, STEP_SCAN_SCENE],
  ['conical-radiometer', generateConicalRadiometerStrip, CONICAL_SCENE],
  ['limb-occultation', generateLimbOccultationStrip, LIMB_SCENE],
  ['geo-raster', generateGeoRasterStrip, GEO_RASTER_SCENE],
  ['agile-tasking', generateAgileTaskingStrip, AGILE_SCENE],
  ['target-stare', generateTargetStareStrip, TARGET_STARE_SCENE],
];

/** Read a model param straight from the fixture so assertions cite the source. */
function param(family: string, key: string): number {
  const model = readJson<InstrumentModel>(`models/${family}.json`);
  return model.params[key] as number;
}

describe('exotic family samplers replay their fixtures (AGE-03, AGE-17)', () => {
  for (const [family, sample, scene] of FAMILIES) {
    it(`regenerates the ${family} fixture from its model within tolerance`, () => {
      replay(family, sample, scene);
    });
  }

  it('applies the frozen state rule around each scene acquiring index', () => {
    for (const [family, sample, scene] of FAMILIES) {
      const strip = replay(family, sample, scene);
      const states = strip.segments.map((s) => s.state);
      expect(states.filter((s) => s === 'acquiring'), family).toHaveLength(1);
      expect(states.indexOf('acquiring'), family).toBe(scene.acquiringIndex);
    }
  });
});

describe('step-scan sounder mechanism (tile 3)', () => {
  it('lays positionsPerRow footprints per row, growing off-nadir by the model factors', () => {
    const strip = replay('step-scan-sounder', generateStepScanSounderStrip, STEP_SCAN_SCENE);
    const positions = param('step-scan-sounder', 'positionsPerRow');
    const r0 = param('step-scan-sounder', 'footprintRadiusKm');
    const crossGrowth = param('step-scan-sounder', 'crossGrowthFactor');
    for (const s of strip.segments) {
      const fps = (s.sub ?? []).filter((x) => x.kind === 'footprint');
      expect(fps).toHaveLength(positions);
    }
    const first = strip.segments[0]!.sub!.filter((x) => x.kind === 'footprint');
    const majors = first.map((f) => (f.kind === 'footprint' ? f.semiMajorKm : 0));
    // The nadir-most beam is near r0; the edge beam has grown by ~crossGrowth.
    expect(Math.min(...majors)).toBeLessThan(r0 * 1.1);
    // Outermost beam offset is u = (N-1)/N of the half-width, so q = (N-1)/N.
    const qEdge = (positions - 1) / positions;
    expect(Math.max(...majors)).toBeCloseTo(r0 * (1 + crossGrowth * qEdge * qEdge), 6);
  });
});

describe('conical radiometer mechanism (tile 4)', () => {
  it('carries one crescent footprint per segment on the sector chord', () => {
    const strip = replay('conical-radiometer', generateConicalRadiometerStrip, CONICAL_SCENE);
    const scanRadius = param('conical-radiometer', 'scanRadiusKm');
    const sectorHalf = param('conical-radiometer', 'sectorHalfAngleRad');
    const semiMajor = param('conical-radiometer', 'footprintSemiMajorKm');
    for (const s of strip.segments) {
      const fps = s.sub!.filter((x) => x.kind === 'footprint');
      expect(fps).toHaveLength(1);
      const fp = fps[0]!;
      if (fp.kind === 'footprint') expect(fp.semiMajorKm).toBeCloseTo(semiMajor, 9);
    }
    // The envelope is the cross-track chord the forward sector spans on the
    // ground circle: width = 2 * scanRadius * sin(sectorHalfAngle).
    const expectedChord = 2 * scanRadius * Math.sin(sectorHalf);
    for (const s of strip.segments) {
      expect(chord(s.left, s.right)).toBeCloseTo(expectedChord, 0);
    }
  });
});

describe('limb occultation mechanism (tile 13)', () => {
  it('displaces the tangent bead forward and pops three offset events', () => {
    const strip = replay('limb-occultation', generateLimbOccultationStrip, LIMB_SCENE);
    // Every segment is zero-width (limb never a ground ribbon) and carries a bead.
    for (const s of strip.segments) {
      expect(s.left).toEqual(s.right);
      expect(s.sub!.some((x) => x.kind === 'beads')).toBe(true);
    }
    const events = strip.segments.flatMap((s) => s.sub!.filter((x) => x.kind === 'event'));
    expect(events).toHaveLength(3);
    // The tangent bead leads the subsatellite point by tangentLeadSec of travel.
    const lead = param('limb-occultation', 'tangentLeadSec');
    const speed = LIMB_SCENE.trackLengthKm / LIMB_SCENE.passSec;
    const mid = strip.segments[20]!;
    const bead = mid.sub!.find((x) => x.kind === 'beads');
    if (bead?.kind !== 'beads') throw new Error('beads expected');
    expect(chord(bead.points[0]!, mid.left)).toBeCloseTo(lead * speed, 0);
  });
});

describe('geo raster mechanism (tile 15)', () => {
  it('rasters the fixed disk top to bottom with two revisited meso sectors', () => {
    const strip = replay('geo-raster', generateGeoRasterStrip, GEO_RASTER_SCENE);
    const revisit = param('geo-raster', 'mesoRevisitSec');
    // Scan lines march monotonically down the disk (the raster).
    const ys = strip.segments.map((s) => s.left[2]); // body z ~ north; decreasing top to bottom
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]! + TOLERANCE);
    // Chord width is widest at the disk equator, narrower at the poles.
    const widths = strip.segments.map((s) => chord(s.left, s.right));
    expect(Math.max(...widths)).toBeGreaterThan(widths[0]!);
    for (const s of strip.segments) {
      const sectors = s.sub!.filter((x) => x.kind === 'sector');
      expect(sectors).toHaveLength(2);
      for (const sector of sectors) {
        if (sector.kind === 'sector') expect(sector.refreshSec).toBe(revisit);
      }
      expect(s.sub!.filter((x) => x.kind === 'frame')).toHaveLength(2);
    }
  });
});

describe('agile tasking mechanism (tile 14)', () => {
  it('commits one patch per task type across the field of regard', () => {
    const strip = replay('agile-tasking', generateAgileTaskingStrip, AGILE_SCENE);
    const forHalf = param('agile-tasking', 'fieldOfRegardHalfKm');
    const model = readJson<InstrumentModel>('models/agile-tasking.json');
    const types = model.params.taskTypes as string[];
    expect(strip.segments).toHaveLength(types.length);
    // The field-of-regard band is the envelope; its width is 2 * the half.
    for (const s of strip.segments) {
      expect(chord(s.left, s.right)).toBeCloseTo(2 * forHalf, 0);
    }
    const frameIds = strip.segments.flatMap((s) => s.sub!.map((x) => (x.kind === 'frame' ? x.frameId : '')));
    // Stereo commits a convergent pair; corridor chains three frames.
    expect(frameIds.filter((f) => f?.startsWith('stereo')).length).toBe(2);
    expect(frameIds.filter((f) => f?.startsWith('corridor')).length).toBe(3);
  });
});

describe('target stare mechanism (tile 18)', () => {
  it('anchors at one point and stretches the patch to stretchMaxFactor at the dwell edges', () => {
    const strip = replay('target-stare', generateTargetStareStrip, TARGET_STARE_SCENE);
    const halfAlong = param('target-stare', 'patchHalfAlongKm');
    const stretchMax = param('target-stare', 'stretchMaxFactor');
    // All patches share one target: the near cross edge midpoint is invariant.
    const anchors = strip.segments.map((s): [number, number, number] => [
      (s.left[0] + s.right[0]) / 2, (s.left[1] + s.right[1]) / 2, (s.left[2] + s.right[2]) / 2,
    ]);
    // All patches share one target: the cross-edge midpoints coincide to the
    // centimetre (the residual is sphere curvature under the rotating look).
    for (let i = 1; i < anchors.length; i++) {
      expect(chord(anchors[i]!, anchors[0]!)).toBeLessThan(1e-3);
    }
    // Patch along-length runs from halfAlong at closest approach to
    // halfAlong * stretchMax at the dwell edges: the lead-to-trail edge.
    const alongLengths = strip.segments.map((s) => {
      const frame = s.sub![0]!;
      if (frame.kind !== 'frame') throw new Error('frame expected');
      const [leadLeft, , , trailLeft] = frame.corners;
      return chord(leadLeft, trailLeft);
    });
    expect(Math.min(...alongLengths)).toBeCloseTo(2 * halfAlong, 0);
    expect(Math.max(...alongLengths) / Math.min(...alongLengths)).toBeCloseTo(stretchMax, 1);
  });
});
