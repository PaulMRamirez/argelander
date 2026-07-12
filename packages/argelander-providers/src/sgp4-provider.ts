/**
 * SGP4/TLE StateProvider (SPEC-PROVIDER section 2, ADR-0008). Serves TEME
 * natively and ITRF93 or IAU_EARTH through the rendering-grade GMST spin.
 * Geometric states only (correction 'NONE'); epochs outside the TLE fence
 * refuse atomically with CoverageRefusalError. Orientation serves the Earth
 * spin quaternion and refuses spacecraft attitude, which TLEs do not carry.
 */
import { CoverageRefusalError, SOFT_MAX_EPOCHS_PER_QUERY, expandEpochs } from 'argelander-core';
import type {
  BodyId, CoverageWindow, Et, FrameId, QuatBatch, StateBatch, StateProvider, StateQuery,
} from 'argelander-core';
import { SPEED_OF_LIGHT_KM_S, rotZQuatInto, temeToEarthFixedInto } from './earth.js';
import { sgp4Init, sgp4PropagateInto } from './sgp4.js';
import type { Sgp4Satrec } from './sgp4.js';
import { gmstRadAtEt } from './time.js';
import { parseTle } from './tle.js';
import type { Tle } from './tle.js';

const EARTH_BODY_IDS: ReadonlySet<string> = new Set(['EARTH', '399']);
const EARTH_FIXED_FRAMES: ReadonlySet<string> = new Set(['ITRF93', 'IAU_EARTH']);
const NATIVE_FRAME = 'TEME';
const DEFAULT_FENCE_SEC = 7 * 86400;

export interface Sgp4TleInput {
  line1: string;
  line2: string;
  name?: string;
}

export interface Sgp4ProviderOptions {
  /** Provider identity for Strip.provenance.authority; default 'sgp4'. */
  id?: string;
  /** Half-width of the coverage fence around each TLE epoch, seconds; default 7 days. */
  fenceSec?: number;
  /** UT1 minus UTC, seconds, applied to the GMST spin; default 0 (rendering grade). */
  deltaUt1Sec?: number;
}

interface Registered {
  readonly tle: Tle;
  readonly satrec: Sgp4Satrec;
}

export class Sgp4Provider implements StateProvider {
  readonly id: string;
  private readonly fenceSec: number;
  private readonly deltaUt1Sec: number;
  private readonly sats = new Map<string, Registered>();

  constructor(tles: readonly Sgp4TleInput[], options: Sgp4ProviderOptions = {}) {
    this.id = options.id ?? 'sgp4';
    this.fenceSec = options.fenceSec ?? DEFAULT_FENCE_SEC;
    this.deltaUt1Sec = options.deltaUt1Sec ?? 0;
    if (tles.length === 0) throw new Error('Sgp4Provider requires at least one TLE');
    for (const input of tles) {
      const tle = parseTle(input.line1, input.line2, input.name);
      const entry: Registered = { tle, satrec: sgp4Init(tle) };
      this.register(tle.satnum, entry);
      const stripped = tle.satnum.replace(/^0+(?=.)/, '');
      if (stripped !== tle.satnum) this.register(stripped, entry);
      if (tle.name && tle.name !== tle.satnum && tle.name !== stripped) this.register(tle.name, entry);
    }
  }

  private register(key: string, entry: Registered): void {
    if (this.sats.has(key)) throw new Error(`duplicate TLE registration for '${key}'`);
    this.sats.set(key, entry);
  }

  private resolve(target: BodyId): Registered {
    const entry = this.sats.get(target);
    if (!entry) {
      throw new Error(`unknown target '${target}'; this ${this.id} provider serves: ${[...this.sats.keys()].join(', ')}`);
    }
    return entry;
  }

  private fenceWindow(entry: Registered): CoverageWindow {
    return { start: entry.tle.epochEt - this.fenceSec, end: entry.tle.epochEt + this.fenceSec };
  }

  async states(q: StateQuery): Promise<StateBatch> {
    const entries = q.targets.map((t) => this.resolve(t));
    if (!EARTH_BODY_IDS.has(q.observer)) {
      throw new Error(`observer '${q.observer}' unsupported: the SGP4 provider serves geocentric states (observer EARTH or 399)`);
    }
    if (q.correction !== 'NONE') {
      throw new Error(`correction '${q.correction}' unsupported: SGP4 states are geometric; request 'NONE'`);
    }
    const earthFixed = EARTH_FIXED_FRAMES.has(q.frame);
    if (!earthFixed && q.frame !== NATIVE_FRAME) {
      throw new Error(`frame '${q.frame}' unsupported: the SGP4 provider serves ${NATIVE_FRAME}, ITRF93, IAU_EARTH`);
    }

    const epochs = expandEpochs(q.epochs);
    const n = epochs.length;

    if (n > SOFT_MAX_EPOCHS_PER_QUERY) {
      const err = new CoverageRefusalError(q.targets[0]!, this.requestedWindow(epochs), [this.fenceWindow(entries[0]!)]);
      err.message += ` (query of ${n} epochs exceeds SOFT_MAX_EPOCHS_PER_QUERY = ${SOFT_MAX_EPOCHS_PER_QUERY}; chunk and stitch per SPEC-STRIP section 7)`;
      throw err;
    }

    if (n > 0) {
      const requested = this.requestedWindow(epochs);
      for (let t = 0; t < entries.length; t++) {
        const window = this.fenceWindow(entries[t]!);
        if (requested.start < window.start || requested.end > window.end) {
          throw new CoverageRefusalError(q.targets[t]!, requested, [window]);
        }
      }
    }

    const gmst = new Float64Array(earthFixed ? n : 0);
    if (earthFixed) {
      for (let i = 0; i < n; i++) gmst[i] = gmstRadAtEt(epochs[i]!, this.deltaUt1Sec);
    }

    const states = new Float64Array(entries.length * n * 6);
    const lightTimes = new Float64Array(entries.length * n);
    for (let t = 0; t < entries.length; t++) {
      const { satrec } = entries[t]!;
      for (let i = 0; i < n; i++) {
        const offset = (t * n + i) * 6;
        sgp4PropagateInto(satrec, (epochs[i]! - satrec.epochEt) / 60, states, offset);
        if (earthFixed) temeToEarthFixedInto(states, offset, gmst[i]!);
        const x = states[offset]!;
        const y = states[offset + 1]!;
        const z = states[offset + 2]!;
        lightTimes[t * n + i] = Math.sqrt(x * x + y * y + z * z) / SPEED_OF_LIGHT_KM_S;
      }
    }

    return {
      targets: [...q.targets],
      observer: q.observer,
      frame: q.frame,
      correction: q.correction,
      epochs,
      states,
      lightTimes,
    };
  }

  private requestedWindow(epochs: Float64Array): CoverageWindow {
    let min = epochs[0]!;
    let max = epochs[0]!;
    for (let i = 1; i < epochs.length; i++) {
      const e = epochs[i]!;
      if (e < min) min = e;
      if (e > max) max = e;
    }
    return { start: min, end: max };
  }

  async orientation(body: BodyId, frame: FrameId, epochs: Et[]): Promise<QuatBatch> {
    if (this.sats.has(body)) {
      throw new Error(`no attitude for '${body}': TLEs carry none; compose mount and scan law above the seam or use a CK-backed provider`);
    }
    if (!EARTH_BODY_IDS.has(body)) {
      throw new Error(`unknown orientation body '${body}': the SGP4 provider serves Earth spin only`);
    }
    if (frame !== NATIVE_FRAME) {
      throw new Error(`orientation frame '${frame}' unsupported: Earth spin is served from ${NATIVE_FRAME}`);
    }
    const epochArray = Float64Array.from(epochs);
    const quats = new Float64Array(epochArray.length * 4);
    for (let i = 0; i < epochArray.length; i++) {
      rotZQuatInto(quats, i * 4, gmstRadAtEt(epochArray[i]!, this.deltaUt1Sec));
    }
    return { body, frame, bodyFrame: 'ITRF93', epochs: epochArray, quats };
  }

  async coverage(body: BodyId): Promise<readonly CoverageWindow[]> {
    return [this.fenceWindow(this.resolve(body))];
  }
}
