/**
 * State hues and instrument textures (AGE-08): hue is reserved for
 * acquisition state by default, transcribed from the atlas palette so the
 * adapter and the visual regression corpus agree; instrument identity
 * defaults to a dash-pattern texture derived stably from the instrument id.
 * Overrides are explicit: passing a palette in PaintOptions is the override.
 */
import type { AcquisitionState } from 'argelander-core';

export interface Palette {
  committed: string;
  acquiring: string;
  planned: string;
  guide: string;
}

/** The atlas hues: teal committed, cyan acquiring, amber planned. */
export const ATLAS_PALETTE: Palette = {
  committed: '#4FAEBC',
  acquiring: '#66DBF8',
  planned: '#F0B255',
  guide: '#94B0CD',
};

export function stateColor(palette: Palette, state: AcquisitionState): string {
  return state === 'committed' ? palette.committed
    : state === 'acquiring' ? palette.acquiring
    : palette.planned;
}

/** '#RRGGBB' to 'rgba(r,g,b,a)'; used for every fill so alpha stays explicit. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Instrument-identity textures: solid plus three dash rhythms (AGE-08). */
export const DASH_PATTERNS: ReadonlyArray<readonly number[]> = [
  [],
  [4, 3],
  [1, 3],
  [6, 2, 1, 2],
];

/** Stable pattern choice from the instrument id. */
export function dashPatternFor(instrumentId: string): readonly number[] {
  let hash = 0;
  for (let i = 0; i < instrumentId.length; i++) {
    hash = (hash * 31 + instrumentId.charCodeAt(i)) >>> 0;
  }
  return DASH_PATTERNS[hash % DASH_PATTERNS.length]!;
}
