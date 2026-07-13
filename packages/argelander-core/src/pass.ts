/**
 * Pass orchestration (ADR-0009, AGE-04): one instrument's pass into its
 * strips, the loop every host was rewriting. One atomic states() query per
 * tasked window so the gaps between windows are real (SPEC-STRIP section
 * 2), one strip per window sharing the passId, the bilateral pair
 * decomposed into two side-looking strips. Core owns both interfaces this
 * speaks, so nothing new crosses a seam; the helper computes nothing, it
 * orchestrates. Errors propagate as thrown: failure isolation across a
 * constellation is host policy, one try/catch per instrument.
 */
import { trackStrip } from './track.js';
import type { TrackStripOptions } from './track.js';
import type { BodyId, Correction, Et, FrameId, StateProvider, Strip } from './types.js';

/**
 * The trackStrip posture options passStrips forwards, in one list so the
 * type and the forwarding cannot drift: adding a posture to trackStrip means
 * adding it here, and both the Posture type and the forwarding derive from
 * this array. DECOR_KEYS are the subset that also rides each side of a
 * bilateral pair (the rest describe a single-strip envelope the bilateral
 * decomposition owns itself).
 */
const POSTURE_KEYS = [
  'swathHalfWidthKm', 'offsetRangeKm', 'beadOffsetsKm', 'scan', 'stepScan', 'conical', 'subSwaths', 'looks',
] as const satisfies readonly (keyof TrackStripOptions)[];
const DECOR_KEYS = ['subSwaths', 'looks'] as const satisfies readonly (keyof TrackStripOptions)[];

type Posture = Pick<TrackStripOptions, typeof POSTURE_KEYS[number] | 'nowEtSec'>;

/** The defined entries of `obj` at `keys`, ready to spread. Generic and
 * cast-free, so the forwarded value types are still checked against their
 * source: the drift the key array guards against stays guarded here too. */
function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

export interface PassStripsOptions extends Posture {
  target: BodyId;
  observer: BodyId;
  frame: FrameId;
  /** Defaults to 'NONE', the only value the standalone providers accept. */
  correction?: Correction;
  bodyRadiusKm: number;
  instrumentId: string;
  generatedBy: string;
  /** Defaults to the provider's id, the AGE-20 convention. */
  authority?: string;
  missionId?: string;
  mode?: string;
  /** All windows share it; defaults to 'pass-0'. */
  passId?: string;
  /**
   * Strip id prefix; defaults to the instrumentId with '/' folded to '-'
   * joined with the passId. The fold is lossy, so sibling instruments whose
   * ids collapse to the same prefix ('a/b' and 'a-b') must set this
   * explicitly to keep Strip.id unique; the collision cannot be detected in
   * one call.
   */
  idPrefix?: string;
  /** Acquisition windows as absolute Et spans; one strip per window. */
  windows: ReadonlyArray<readonly [Et, Et]>;
  stepSec: number;
  /**
   * Bilateral decomposition: two side-looking strips per window sharing the
   * passId, one per side of the nadir gap. Exclusive with the ribbon and
   * bead postures, which describe single-strip instruments.
   */
  bilateralKm?: { gapKm: number; outerKm: number };
}

export async function passStrips(provider: StateProvider, options: PassStripsOptions): Promise<Strip[]> {
  if (options.windows.length === 0) throw new RangeError('passStrips requires at least one window');
  if (options.bilateralKm && (options.swathHalfWidthKm !== undefined || options.offsetRangeKm || options.scan || options.stepScan || options.conical || options.beadOffsetsKm)) {
    throw new RangeError('bilateralKm is exclusive with the single-strip postures');
  }
  const passId = options.passId ?? 'pass-0';
  // The passId is folded into the default id, so the same instrument built
  // over two passes does not emit byte-identical Strip.ids. A caller running
  // sibling instruments whose ids fold to the same prefix (the '/'-to-'-'
  // fold is lossy) must still set idPrefix; that collision is not locally
  // detectable, and the JSDoc on idPrefix says so.
  const prefix = options.idPrefix ?? `${options.instrumentId.replace(/\//g, '-')}-${passId}`;
  const common = {
    body: options.observer,
    bodyRadiusKm: options.bodyRadiusKm,
    instrumentId: options.instrumentId,
    authority: options.authority ?? provider.id,
    generatedBy: options.generatedBy,
    ...(options.missionId !== undefined ? { missionId: options.missionId } : {}),
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    passId,
    ...(options.nowEtSec !== undefined ? { nowEtSec: options.nowEtSec } : {}),
  } satisfies Partial<TrackStripOptions>;

  const strips: Strip[] = [];
  for (let w = 0; w < options.windows.length; w++) {
    const [start, end] = options.windows[w]!;
    const batch = await provider.states({
      targets: [options.target],
      observer: options.observer,
      frame: options.frame,
      correction: options.correction ?? 'NONE',
      epochs: { start, end, step: options.stepSec },
    });
    if (options.bilateralKm) {
      const { gapKm, outerKm } = options.bilateralKm;
      // Looks and sub-swaths ride each side of the pair (a twin-swath fan-beam
      // scatterometer such as ASCAT integrates its fore/mid/aft beams on both).
      const decor = pick(options, DECOR_KEYS);
      strips.push(
        trackStrip(batch, 0, {
          ...common, id: `${prefix}-w${w}-left`, ...decor,
          offsetRangeKm: { nearKm: gapKm, farKm: outerKm, side: 'left' },
        }),
        trackStrip(batch, 0, {
          ...common, id: `${prefix}-w${w}-right`, ...decor,
          offsetRangeKm: { nearKm: gapKm, farKm: outerKm, side: 'right' },
        }),
      );
    } else {
      strips.push(trackStrip(batch, 0, {
        ...common,
        id: `${prefix}-w${w}`,
        ...pick(options, POSTURE_KEYS),
      }));
    }
  }
  return strips;
}
