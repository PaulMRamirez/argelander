/**
 * AcquisitionClock: the promoted demo loop (ADR-0009). A manual scheduler
 * drives frames deterministically; a recording layer verifies the two-clock
 * contract: setNow every frame, updateStates only on segment boundaries,
 * clock before states, wrap and scrub behavior.
 */
import { describe, expect, it } from 'vitest';
import type { Strip } from 'argelander-core';
import { AcquisitionClock } from '../src/clock.js';
import type { ClockDrivenLayer } from '../src/clock.js';
import { syntheticStrip } from './fake-ctx.js';

interface Recorded {
  calls: Array<{ kind: 'now'; etSec: number } | { kind: 'states'; acquiring: number } | { kind: 'paused'; paused: boolean }>;
}

function recordingLayer(): ClockDrivenLayer & Recorded {
  const calls: Recorded['calls'] = [];
  return {
    calls,
    setNow(etSec) {
      calls.push({ kind: 'now', etSec });
    },
    updateStates(strips: readonly Strip[]) {
      const acquiring = strips[0]!.segments.findIndex((s) => s.state === 'acquiring');
      calls.push({ kind: 'states', acquiring });
    },
    setPaused(paused) {
      calls.push({ kind: 'paused', paused });
    },
  };
}

/**
 * A requestAnimationFrame-faithful fake: handles are unique, cancel removes
 * only the matching one (a scheduler that cleared every pending frame would
 * mask a stale-handle cancel), and pending frames stay queued until stepped.
 */
function manualScheduler(): { pending: () => number; step: (nowMs: number) => void; schedule: (cb: (nowMs: number) => void) => number; cancel: (h: number) => void } {
  const frames = new Map<number, (nowMs: number) => void>();
  let nextHandle = 1;
  return {
    pending: () => frames.size,
    step(nowMs) {
      const [handle, cb] = frames.entries().next().value ?? [];
      if (handle !== undefined) {
        frames.delete(handle);
        cb!(nowMs);
      }
    },
    schedule(cb) {
      const handle = nextHandle++;
      frames.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      frames.delete(handle);
    },
  };
}

/** Segments carry absolute Et: the layer clock reads epochEt plus tau. */
function baseStrip(epochEt = 0): Strip {
  return syntheticStrip([
    [0, 0, 1, epochEt], [1, 0, 1, epochEt + 10], [2, 0, 1, epochEt + 20], [3, 0, 1, epochEt + 30],
  ]);
}

describe('AcquisitionClock (ADR-0009, AGE-13, AGE-16)', () => {
  it('applies an opening frame even when constructed paused', () => {
    const layer = recordingLayer();
    const scheduler = manualScheduler();
    new AcquisitionClock([{ layer, epochEt: 100, baseStrips: [baseStrip(100)] }], {
      windowSec: 40, stepSec: 10, paused: true, schedule: scheduler.schedule, cancel: scheduler.cancel,
    });
    expect(layer.calls[0]).toEqual({ kind: 'now', etSec: 100 });
    expect(layer.calls[1]).toEqual({ kind: 'states', acquiring: 0 });
    expect(scheduler.pending()).toBe(0);
  });

  it('sets the clock every frame but re-states only on segment boundaries, clock first', () => {
    const layer = recordingLayer();
    const scheduler = manualScheduler();
    new AcquisitionClock([{ layer, epochEt: 0, baseStrips: [baseStrip()] }], {
      windowSec: 40, stepSec: 10, speed: 1, schedule: scheduler.schedule, cancel: scheduler.cancel,
    });
    layer.calls.length = 0;
    scheduler.step(0);
    scheduler.step(4000);
    scheduler.step(8000);
    scheduler.step(12000);
    const kinds = layer.calls.map((c) => c.kind);
    // Four frames of setNow; only the 8 s and 12 s frames cross tau 0 to 4,
    // 8, 12: boundaries at 10 fire once (tau 12), and the first frame after
    // construction re-fires nothing (same tick 0).
    expect(kinds.filter((k) => k === 'now')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'states')).toHaveLength(1);
    // Clock precedes states within the boundary frame.
    const stateIndex = kinds.indexOf('states');
    expect(kinds[stateIndex - 1]).toBe('now');
    const statesCall = layer.calls[stateIndex] as { kind: 'states'; acquiring: number };
    expect(statesCall.acquiring).toBe(1);
  });

  it('wraps tau at the window and re-states the loop restart', () => {
    const layer = recordingLayer();
    const scheduler = manualScheduler();
    const clock = new AcquisitionClock([{ layer, epochEt: 0, baseStrips: [baseStrip()] }], {
      windowSec: 40, stepSec: 10, speed: 1, schedule: scheduler.schedule, cancel: scheduler.cancel,
    });
    scheduler.step(0);
    scheduler.step(39000);
    layer.calls.length = 0;
    scheduler.step(42000);
    expect(clock.tauSec).toBeCloseTo(2, 9);
    const states = layer.calls.filter((c) => c.kind === 'states') as Array<{ kind: 'states'; acquiring: number }>;
    expect(states).toHaveLength(1);
    expect(states[0]!.acquiring).toBe(0);
  });

  it('seek scrubs, applies immediately, and always re-states', () => {
    const layer = recordingLayer();
    const scheduler = manualScheduler();
    const clock = new AcquisitionClock([{ layer, epochEt: 50, baseStrips: [baseStrip(50)] }], {
      windowSec: 40, stepSec: 10, paused: true, schedule: scheduler.schedule, cancel: scheduler.cancel,
    });
    layer.calls.length = 0;
    clock.seek(25);
    expect(clock.tauSec).toBe(25);
    expect(layer.calls[0]).toEqual({ kind: 'now', etSec: 75 });
    expect(layer.calls[1]).toEqual({ kind: 'states', acquiring: 2 });
    layer.calls.length = 0;
    clock.seek(25);
    // Same tau scrubbed again still re-applies: a scrub is a command.
    expect(layer.calls.filter((c) => c.kind === 'states')).toHaveLength(1);
  });

  it('pause forwards to layers and stops the loop; resume restarts cleanly', () => {
    const layer = recordingLayer();
    const scheduler = manualScheduler();
    const clock = new AcquisitionClock([{ layer, epochEt: 0, baseStrips: [baseStrip()] }], {
      windowSec: 40, stepSec: 10, speed: 1, schedule: scheduler.schedule, cancel: scheduler.cancel,
    });
    scheduler.step(0);
    scheduler.step(5000);
    clock.setPaused(true);
    expect(layer.calls.at(-1)).toEqual({ kind: 'paused', paused: true });
    expect(scheduler.pending()).toBe(0);
    clock.setPaused(false);
    const tauAtResume = clock.tauSec;
    // The first resumed frame carries no wall-clock gap: dt is zero, so a
    // long pause never teleports the clock.
    scheduler.step(90000);
    expect(clock.tauSec).toBeCloseTo(tauAtResume, 9);
  });

  it('dispose() from inside onTick terminates the loop, no zombie frame', () => {
    const layer = recordingLayer();
    const scheduler = manualScheduler();
    let ticks = 0;
    let clock!: AcquisitionClock;
    clock = new AcquisitionClock([{ layer, epochEt: 0, baseStrips: [baseStrip()] }], {
      windowSec: 40, stepSec: 10, speed: 1, schedule: scheduler.schedule, cancel: scheduler.cancel,
      onTick: () => {
        ticks++;
        if (ticks === 2) clock.dispose();
      },
    });
    // Drain every frame the scheduler still holds; a resurrected loop would
    // keep re-arming and never empty.
    for (let i = 0; i < 10 && scheduler.pending() > 0; i++) scheduler.step(i * 1000);
    expect(scheduler.pending()).toBe(0);
    expect(ticks).toBe(2);
    // A disposed clock stays down: resume is a no-op.
    clock.setPaused(false);
    expect(scheduler.pending()).toBe(0);
  });

  it('setPaused(true) from inside onTick stops cleanly and does not advance past the pause', () => {
    const layer = recordingLayer();
    const scheduler = manualScheduler();
    let clock!: AcquisitionClock;
    let pauseAtTick = -1;
    clock = new AcquisitionClock([{ layer, epochEt: 0, baseStrips: [baseStrip()] }], {
      windowSec: 40, stepSec: 10, speed: 1, schedule: scheduler.schedule, cancel: scheduler.cancel,
      onTick: (tau) => {
        if (tau >= 5 && pauseAtTick < 0) {
          pauseAtTick = tau;
          clock.setPaused(true);
        }
      },
    });
    for (let i = 0; i < 10 && scheduler.pending() > 0; i++) scheduler.step(i * 1000);
    expect(scheduler.pending()).toBe(0);
    // The clock froze at the pause point; no zombie frame advanced it.
    expect(clock.tauSec).toBeCloseTo(pauseAtTick, 9);
  });
});
