/**
 * The pass clock (ADR-0009, AGE-13, AGE-16): the animation loop the live
 * demo proved and two field bugs shaped, promoted so hosts stop hand
 * rolling it. Owns one frame loop for any number of layers: a shared pass
 * fraction, per-layer Et clocks from each layer's epoch, setNow every
 * frame, and updateStates re-emitted through withStateRule only when the
 * clock crosses a segment boundary; clock before states, always, so the
 * now marker never lags the state front. The frame scheduler is injectable
 * so the class tests headlessly.
 */
import { withStateRule } from 'argelander-core';
import type { Strip } from 'argelander-core';

/** What the clock drives: the AcquisitionLayer surface it needs, no more. */
export interface ClockDrivenLayer {
  setNow(etSec: number): void;
  updateStates(strips: readonly Strip[]): void;
  setPaused(paused: boolean): void;
}

export interface ClockEntry {
  layer: ClockDrivenLayer;
  /** The layer's pass anchor: its clock reads epochEt plus the shared tau. */
  epochEt: number;
  /** Geometry with the state rule not yet applied; re-stated per boundary. */
  baseStrips: readonly Strip[];
}

export interface AcquisitionClockOptions {
  /** Pass length, engine seconds; tau wraps modulo this. */
  windowSec: number;
  /** Segment cadence, engine seconds; states re-emit on these boundaries. */
  stepSec: number;
  /** Engine seconds per wall second; default 60. */
  speed?: number;
  /** Start paused (reduced-motion preference, AGE-16). */
  paused?: boolean;
  /** Called after each applied frame with the current tau. */
  onTick?: (tauSec: number) => void;
  /** Frame scheduler; defaults to requestAnimationFrame. */
  schedule?: (cb: (nowMs: number) => void) => number;
  cancel?: (handle: number) => void;
}

export class AcquisitionClock {
  private readonly entries: readonly ClockEntry[];
  private readonly windowSec: number;
  private readonly stepSec: number;
  private readonly onTick: ((tauSec: number) => void) | undefined;
  private readonly schedule: (cb: (nowMs: number) => void) => number;
  private readonly cancel: (handle: number) => void;
  private speed: number;
  private paused: boolean;
  private tau = 0;
  private lastStateTick = -1;
  private handle = 0;
  private lastFrameMs: number | undefined;

  constructor(entries: readonly ClockEntry[], options: AcquisitionClockOptions) {
    this.entries = entries;
    this.windowSec = options.windowSec;
    this.stepSec = options.stepSec;
    this.speed = options.speed ?? 60;
    this.paused = options.paused ?? false;
    this.onTick = options.onTick;
    this.schedule = options.schedule ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = options.cancel ?? ((h) => cancelAnimationFrame(h));
    // The opening frame paints even when starting paused: a paused clock
    // shows the pass at tau zero, not a blank map.
    this.apply();
    if (!this.paused) this.start();
  }

  get tauSec(): number {
    return this.tau;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const e of this.entries) e.layer.setPaused(paused);
    if (paused) this.stop();
    else this.start();
  }

  /** Engine seconds per wall second, effective from the next frame. */
  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Scrub to a pass offset and apply immediately (AGE-13). */
  seek(tauSec: number): void {
    this.tau = ((tauSec % this.windowSec) + this.windowSec) % this.windowSec;
    this.lastStateTick = -1;
    this.apply();
  }

  dispose(): void {
    this.stop();
  }

  /** Clock first, then states, and states only on their boundaries. */
  private apply(): void {
    for (const e of this.entries) e.layer.setNow(e.epochEt + this.tau);
    const stateTick = Math.floor(this.tau / this.stepSec);
    if (stateTick !== this.lastStateTick) {
      this.lastStateTick = stateTick;
      for (const e of this.entries) {
        e.layer.updateStates(e.baseStrips.map((s) => withStateRule(s, e.epochEt + this.tau)));
      }
    }
    this.onTick?.(this.tau);
  }

  private start(): void {
    this.stop();
    this.lastFrameMs = undefined;
    const frame = (nowMs: number): void => {
      const dtSec = this.lastFrameMs === undefined ? 0 : (nowMs - this.lastFrameMs) / 1000;
      this.lastFrameMs = nowMs;
      this.tau = (this.tau + dtSec * this.speed) % this.windowSec;
      this.apply();
      this.handle = this.schedule(frame);
    };
    this.handle = this.schedule(frame);
  }

  private stop(): void {
    if (this.handle) this.cancel(this.handle);
    this.handle = 0;
  }
}
