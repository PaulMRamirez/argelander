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

function manualScheduler(): { frames: Array<(nowMs: number) => void>; step: (nowMs: number) => void; schedule: (cb: (nowMs: number) => void) => number; cancel: (h: number) => void } {
  const frames: Array<(nowMs: number) => void> = [];
  return {
    frames,
    step(nowMs) {
      const cb = frames.shift();
      cb?.(nowMs);
    },
    schedule(cb) {
      frames.push(cb);
      return frames.length;
    },
    cancel() {
      frames.length = 0;
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
    expect(scheduler.frames).toHaveLength(0);
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
    expect(scheduler.frames).toHaveLength(0);
    clock.setPaused(false);
    const tauAtResume = clock.tauSec;
    // The first resumed frame carries no wall-clock gap: dt is zero, so a
    // long pause never teleports the clock.
    scheduler.step(90000);
    expect(clock.tauSec).toBeCloseTo(tauAtResume, 9);
  });
});
