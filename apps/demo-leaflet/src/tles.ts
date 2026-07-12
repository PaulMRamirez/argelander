/**
 * Demonstration constellation. TLEs fetched from Celestrak 2026-07-11; the
 * demo clock runs from each element epoch, so the SGP4 coverage fence is
 * always satisfied no matter when the page loads. One platform state feeds
 * every instrument on the satellite, the engine posture; swath and beam
 * figures are demonstration values, not instrument truth.
 */
export interface DemoInstrument {
  /** Stable id, joined with the satellite name into Strip.instrumentId. */
  id: string;
  label: string;
  /** Ribbon half-width, km; omit for a bead or offset instrument. */
  swathHalfWidthKm?: number;
  /** Cross-track beam offsets, km; beads chain, never a ribbon. */
  beadOffsetsKm?: readonly number[];
  /** Whiskbroom-style scan mechanism revealed by LOD when zoomed in. */
  scan?: {
    scanRateHz: number;
    subStepSec: number;
    footprintSemiMajorKm: number;
    footprintSemiMinorKm: number;
    footprintGrowthFactor: number;
  };
  /** Side-looking offset ribbon; nadir is never imaged. */
  offsetRangeKm?: { nearKm: number; farKm: number; side: 'left' | 'right' };
  /** Bilateral pair with a nadir gap: two ribbons sharing the passId. */
  bilateralKm?: { gapKm: number; outerKm: number };
  /**
   * Tasked acquisition windows, seconds from the element epoch: one strip
   * per window sharing the passId, with honest gaps between (SPEC-STRIP).
   * Omitted means the instrument acquires through the whole pass.
   */
  taskWindowsSec?: ReadonlyArray<readonly [number, number]>;
}

export interface DemoSat {
  name: string;
  line1: string;
  line2: string;
  instruments: readonly DemoInstrument[];
}

export const DEMO_SATS: readonly DemoSat[] = [
  {
    name: 'ISS (ZARYA)',
    line1: '1 25544U 98067A   26192.31485778  .00005525  00000+0  10843-3 0  9998',
    line2: '2 25544  51.6302 180.6822 0006688 282.4935  77.5305 15.48978902575497',
    instruments: [
      {
        id: 'demo-scanner',
        label: 'demo whiskbroom, 160 km',
        swathHalfWidthKm: 80,
        scan: {
          scanRateHz: 0.05,
          subStepSec: 2.5,
          footprintSemiMajorKm: 12,
          footprintSemiMinorKm: 8,
          footprintGrowthFactor: 0.8,
        },
      },
    ],
  },
  {
    name: 'TERRA',
    line1: '1 25994U 99068A   26192.88621611  .00000205  00000+0  50793-4 0  9998',
    line2: '2 25994  97.9443 241.4516 0003278 129.2185 343.1618 14.61122111413215',
    instruments: [
      {
        id: 'modis',
        label: 'MODIS: 2330 km whiskbroom',
        swathHalfWidthKm: 1165,
        scan: {
          scanRateHz: 0.02,
          subStepSec: 2.5,
          footprintSemiMajorKm: 40,
          footprintSemiMinorKm: 24,
          footprintGrowthFactor: 1.2,
        },
      },
      {
        id: 'aster',
        label: 'ASTER: tasked 60 km scenes',
        swathHalfWidthKm: 30,
        taskWindowsSec: [[600, 900], [2400, 2700], [4200, 4500]],
      },
    ],
  },
  {
    name: 'SENTINEL-1A',
    line1: '1 39634U 14016A   26192.77890475 -.00000105  00000+0 -12473-4 0  9992',
    line2: '2 39634  98.1786 199.9525 0001444  86.5450 273.5915 14.59199380653608',
    instruments: [
      {
        id: 'c-sar',
        label: 'C-SAR: tasked IW slots, right-looking',
        offsetRangeKm: { nearKm: 250, farKm: 400, side: 'right' },
        taskWindowsSec: [[480, 1080], [2040, 2580], [3660, 4440]],
      },
    ],
  },
  {
    name: 'LANDSAT 9',
    line1: '1 49260U 21088A   26191.81894687  .00000149  00000+0  43075-4 0  9996',
    line2: '2 49260  98.2341 261.7009 0001512 185.5660 174.5522 14.57104464254446',
    instruments: [
      {
        id: 'oli-2',
        label: 'OLI-2: 185 km pushbroom',
        swathHalfWidthKm: 92.5,
      },
    ],
  },
  {
    name: 'SWOT',
    line1: '1 54754U 22173A   26192.85432307  .00000072  00000+0  50415-4 0  9999',
    line2: '2 54754  77.6107   2.0082 0000286  77.4832 282.6352 14.00172172182604',
    instruments: [
      {
        id: 'karin',
        label: 'KaRIn: twin 50 km swaths',
        bilateralKm: { gapKm: 10, outerKm: 60 },
      },
      {
        id: 'poseidon-3c',
        label: 'Poseidon-3C: nadir altimeter',
        beadOffsetsKm: [0],
      },
    ],
  },
  {
    name: 'ICESAT-2',
    line1: '1 43613U 18070A   26192.77524931  .00005871  00000+0  21289-3 0  9996',
    line2: '2 43613  92.0090 297.6232 0005707  72.9096 287.2778 15.28312552436213',
    instruments: [
      {
        id: 'atlas',
        label: 'ATLAS: three beam-pair bead chains',
        beadOffsetsKm: [-3.3, 0, 3.3],
      },
    ],
  },
];

/** One orbit-ish pass window from each element epoch. */
export const PASS_WINDOW_SEC = 5400;
export const PASS_STEP_SEC = 15;
