/**
 * Provider seam helpers (SPEC-PROVIDER sections 1 and 4): epoch expansion,
 * decoder views over flat batches, and the structured coverage refusal.
 * Pure and dependency-free (AGE-01).
 */
import type {
  BodyId, CoverageWindow, EpochRange, Et, Quat, QuatBatch,
  StateBatch, StateSample,
} from './types.js';

/**
 * Soft ceiling on epochs per StateQuery (SPEC-PROVIDER section 4): 3 MiB of
 * state doubles per target, one comfortable worker transfer (AGE-05). Sizing
 * guidance, not a wire-format limit; batches remain valid at any size.
 */
export const SOFT_MAX_EPOCHS_PER_QUERY = 65536;

/**
 * Expand the epoch union to a concrete list. Ranges are inclusive of `end`
 * within half a floating-point-guarded step.
 */
export function expandEpochs(epochs: Et[] | EpochRange): Float64Array {
  if (Array.isArray(epochs)) return Float64Array.from(epochs);
  const { start, end, step } = epochs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(step > 0) || end < start) {
    throw new RangeError(`invalid epoch range {start: ${start}, end: ${end}, step: ${step}}`);
  }
  const n = Math.floor((end - start) / step + 1e-9) + 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = start + i * step;
  return out;
}

/**
 * Decoder view over a flat StateBatch (SPEC-PROVIDER section 1); the wire
 * shape stays the Float64Array, this materializes one object-shaped sample.
 */
export function decodeState(batch: StateBatch, targetIndex: number, epochIndex: number): StateSample {
  const n = batch.epochs.length;
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= batch.targets.length) {
    throw new RangeError(`targetIndex ${targetIndex} outside 0..${batch.targets.length - 1}`);
  }
  if (!Number.isInteger(epochIndex) || epochIndex < 0 || epochIndex >= n) {
    throw new RangeError(`epochIndex ${epochIndex} outside 0..${n - 1}`);
  }
  const o = (targetIndex * n + epochIndex) * 6;
  const s = batch.states;
  return {
    etSec: batch.epochs[epochIndex]!,
    positionKm: [s[o]!, s[o + 1]!, s[o + 2]!],
    velocityKmS: [s[o + 3]!, s[o + 4]!, s[o + 5]!],
  };
}

/** Scalar-first (w, x, y, z) quaternion at one epoch of a QuatBatch. */
export function decodeQuat(batch: QuatBatch, epochIndex: number): Quat {
  const n = batch.epochs.length;
  if (!Number.isInteger(epochIndex) || epochIndex < 0 || epochIndex >= n) {
    throw new RangeError(`epochIndex ${epochIndex} outside 0..${n - 1}`);
  }
  const o = epochIndex * 4;
  const q = batch.quats;
  return [q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!];
}

/**
 * Structured refusal for epochs outside coverage (SPEC-PROVIDER section 4).
 * Providers reject with this instead of NaN fills or clamping; a query is
 * atomic and never partially answered. `covered` is empty when the provider
 * advertises no windows.
 */
export class CoverageRefusalError extends Error {
  readonly body: BodyId;
  readonly requested: CoverageWindow;
  readonly covered: readonly CoverageWindow[];

  constructor(body: BodyId, requested: CoverageWindow, covered: readonly CoverageWindow[]) {
    const windows = covered.length
      ? covered.map((w) => `[${w.start}, ${w.end}]`).join(', ')
      : '(none advertised)';
    super(`state for ${body} requested over [${requested.start}, ${requested.end}] outside coverage ${windows}`);
    this.name = 'CoverageRefusalError';
    this.body = body;
    this.requested = requested;
    this.covered = covered;
  }
}
