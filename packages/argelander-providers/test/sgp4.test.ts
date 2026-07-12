import { describe, expect, it } from 'vitest';
import { DeepSpaceUnsupportedError, sgp4Init, sgp4PropagateInto } from '../src/sgp4.js';
import { parseTle } from '../src/tle.js';

/*
 * Verification anchors from the published corpus of Vallado, Crawford, Hujsak,
 * Kelso, "Revisiting Spacetrack Report #3" (AIAA 2006-6753), tcppver.out,
 * WGS-72. Columns are minutes from epoch, TEME position km, TEME velocity km/s.
 */

const TLE_00005 = [
  '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
] as const;

const VER_00005: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
  [0.0, 7022.46529266, -1400.08296755, 0.03995155, 1.893841015, 6.405893759, 4.534807250],
  [360.0, -7154.03120202, -3783.17682504, -3536.19412294, 4.741887409, -4.151817765, -2.093935425],
  [720.0, -7134.59340119, 6531.68641334, 3260.27186483, -4.113793027, -2.911922039, -2.557327851],
  [1080.0, 5568.53901181, 4492.06992591, 3863.87641983, -4.209106476, 5.159719888, 2.744852980],
  [1440.0, -938.55923943, -6268.18748831, -4294.02924751, 7.536105209, -0.427127707, 0.989878080],
  [4320.0, -9060.47373569, 4658.70952502, 813.68673153, -2.232832783, -4.110453490, -3.157345433],
];

const TLE_06251 = [
  '1 06251U 62025E   06176.82412014  .00008885  00000-0  12808-3 0  3985',
  '2 06251  58.0579  54.0425 0030035 139.1568 221.1854 15.56387291  6774',
] as const;

const VER_06251: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
  [0.0, 3988.31022699, 5498.96657235, 0.90055879, -3.290032738, 2.357652820, 6.496623475],
  [120.0, -3935.69800083, 409.10980837, 5471.33577327, -3.374784183, -6.635211043, -1.942056221],
  [240.0, -1675.12766915, -5683.30432352, -3286.21510937, 5.282496925, 1.508674259, -5.354872978],
  [360.0, 4993.62642836, 2890.54969900, -3600.40145627, 0.347333429, 5.707031557, 5.070699638],
  [480.0, -1115.07959514, 4015.11691491, 5326.99727718, -5.524279443, -4.765738774, 2.402255961],
  [600.0, -4329.10008198, -5176.70287935, 409.65313857, 2.858408303, -2.933091792, -6.509690397],
  [720.0, 3692.60030028, -976.24265255, -5623.36447493, 3.897257243, 6.415554948, 1.429112190],
  [840.0, 2301.83510037, 5723.92394553, 2814.61514580, -5.110924966, -0.764510559, 5.662120145],
  [960.0, -4990.91637950, -2303.42547880, 3920.86335598, -0.993439372, -5.967458360, -4.759110856],
];

/** Deep-space case from the same corpus (period about 5832 min). */
const TLE_20413 = [
  '1 20413U 83020D   05363.79166667  .00000000  00000-0  00000+0 0  7041',
  '2 20413  12.3514 187.4253 7864447 196.3027 356.5478  0.24690082  7978',
] as const;

const POS_TOL_KM = 1e-6;
const VEL_TOL_KMS = 1e-9;

function checkCorpus(lines: readonly [string, string], rows: ReadonlyArray<readonly [number, number, number, number, number, number, number]>): void {
  const satrec = sgp4Init(parseTle(lines[0], lines[1]));
  const out = new Float64Array(6);
  for (const [tsince, x, y, z, vx, vy, vz] of rows) {
    sgp4PropagateInto(satrec, tsince, out, 0);
    expect(Math.abs(out[0]! - x), `x at ${tsince} min`).toBeLessThan(POS_TOL_KM);
    expect(Math.abs(out[1]! - y), `y at ${tsince} min`).toBeLessThan(POS_TOL_KM);
    expect(Math.abs(out[2]! - z), `z at ${tsince} min`).toBeLessThan(POS_TOL_KM);
    expect(Math.abs(out[3]! - vx), `vx at ${tsince} min`).toBeLessThan(VEL_TOL_KMS);
    expect(Math.abs(out[4]! - vy), `vy at ${tsince} min`).toBeLessThan(VEL_TOL_KMS);
    expect(Math.abs(out[5]! - vz), `vz at ${tsince} min`).toBeLessThan(VEL_TOL_KMS);
  }
}

describe('SGP4 near-earth propagation (AGE-04)', () => {
  it('reproduces the Spacetrack Report #3 corpus for satellite 00005', () => {
    checkCorpus(TLE_00005, VER_00005);
  });

  it('reproduces the corpus for satellite 06251 (low perigee, drag active)', () => {
    checkCorpus(TLE_06251, VER_06251);
  });

  it('keeps velocity consistent with finite-differenced position', () => {
    // SGP4 velocity is semi-analytic, not the exact time derivative of the
    // short-period-corrected position; the theory itself carries a smooth,
    // eccentricity-proportional residual (measured 1.2e-3 km/s at e=0.19,
    // 3.8e-5 at e=0.003). The corpus vectors above anchor absolute
    // correctness; this bound only guards against sign and frame errors.
    const cases: ReadonlyArray<readonly [readonly [string, string], number]> = [
      [TLE_00005, 2e-3],
      [TLE_06251, 1e-4],
    ];
    const dtMin = 1 / 600;
    const back = new Float64Array(6);
    const mid = new Float64Array(6);
    const fwd = new Float64Array(6);
    for (const [lines, bound] of cases) {
      const satrec = sgp4Init(parseTle(lines[0], lines[1]));
      for (const t of [0, 47.3, 360, 1201.5]) {
        sgp4PropagateInto(satrec, t - dtMin, back, 0);
        sgp4PropagateInto(satrec, t, mid, 0);
        sgp4PropagateInto(satrec, t + dtMin, fwd, 0);
        for (let ax = 0; ax < 3; ax++) {
          const fd = (fwd[ax]! - back[ax]!) / (2 * dtMin * 60);
          expect(Math.abs(fd - mid[ax + 3]!)).toBeLessThan(bound);
        }
      }
    }
  });

  it('refuses deep-space element sets until SDP4 lands (ADR-0008)', () => {
    const tle = parseTle(TLE_20413[0], TLE_20413[1]);
    expect(() => sgp4Init(tle)).toThrow(DeepSpaceUnsupportedError);
    expect(() => sgp4Init(tle)).toThrow(/225 min/);
  });
});
