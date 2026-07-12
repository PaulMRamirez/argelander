/**
 * The ADR-0009 growth set: parseTles, the worker wiring handshake, CZML
 * playback, and the HTTP wire, each tested through in-memory loopbacks
 * against real providers.
 */
import { describe, expect, it } from 'vitest';
import { CoverageRefusalError } from 'argelander-core';
import type { StateQuery } from 'argelander-core';
import { czmlProvider, parseCzmlStates } from '../src/czml.js';
import { httpStateProvider, serveStateRequest } from '../src/http.js';
import { PresampledProvider } from '../src/presampled.js';
import type { PresampledStateTable } from '../src/presampled.js';
import type { StatePortLike } from '../src/port.js';
import { parseTle, parseTles } from '../src/tle.js';
import { etToUtcUnix } from '../src/time.js';
import { connectSgp4Worker, registerSgp4Worker } from '../src/worker-wiring.js';

const ISS_LINE1 = '1 25544U 98067A   26192.31485778  .00005525  00000+0  10843-3 0  9998';
const ISS_LINE2 = '2 25544  51.6302 180.6822 0006688 282.4935  77.5305 15.48978902575497';

describe('parseTles: the Celestrak-shaped splitter', () => {
  it('reads 3-line sets, 0-prefixed names, bare pairs, and skips noise', () => {
    const text = [
      '# fetched 2026-07-12', '',
      'ISS (ZARYA)', ISS_LINE1, ISS_LINE2,
      '0 NAMED WITH ZERO', ISS_LINE1, ISS_LINE2,
      ISS_LINE1, ISS_LINE2,
      'trailing garbage',
    ].join('\n');
    const sets = parseTles(text);
    expect(sets).toHaveLength(3);
    expect(sets[0]!.name).toBe('ISS (ZARYA)');
    expect(sets[1]!.name).toBe('NAMED WITH ZERO');
    expect(sets[2]!.name).toBe('SAT 25544');
    expect(sets.every((s) => s.line1 === ISS_LINE1 && s.line2 === ISS_LINE2)).toBe(true);
  });

  it('returns sets parseTle accepts verbatim', () => {
    const [set] = parseTles(`ISS\n${ISS_LINE1}\n${ISS_LINE2}`);
    expect(() => parseTle(set!.line1, set!.line2, set!.name)).not.toThrow();
  });
});

/** In-memory port pair: postMessage on one side dispatches on the other. */
function portPair(): [StatePortLike, StatePortLike] {
  const listeners: [Array<(e: { data: unknown }) => void>, Array<(e: { data: unknown }) => void>] = [[], []];
  const make = (mine: 0 | 1): StatePortLike => ({
    postMessage(message: unknown) {
      queueMicrotask(() => {
        for (const l of listeners[mine === 0 ? 1 : 0]) l({ data: message });
      });
    },
    addEventListener(_type: 'message', listener: (e: { data: unknown }) => void) {
      listeners[mine].push(listener);
    },
  });
  return [make(0), make(1)];
}

describe('worker wiring: the one-import worker and the ready handshake', () => {
  it('connects, then serves states end to end over the same port', async () => {
    const [main, worker] = portPair();
    registerSgp4Worker(worker);
    const provider = await connectSgp4Worker(main, [{ line1: ISS_LINE1, line2: ISS_LINE2, name: 'ISS' }]);
    expect(provider.id).toBe('sgp4');
    const epochEt = parseTle(ISS_LINE1, ISS_LINE2, 'ISS').epochEt;
    const batch = await provider.states({
      targets: ['ISS'], observer: 'EARTH', frame: 'ITRF93', correction: 'NONE',
      epochs: { start: epochEt, end: epochEt + 60, step: 30 },
    });
    expect(batch.epochs).toHaveLength(3);
    expect(Math.hypot(batch.states[0]!, batch.states[1]!, batch.states[2]!)).toBeGreaterThan(6000);
  });

  it('rejects the connect promise when construction fails in the worker', async () => {
    // A deep-space period: mean motion 2 revs/day.
    const deepLine2 = '2 25544  51.6302 180.6822 0006688 282.4935  77.5305  2.00000000575496';
    const [main, worker] = portPair();
    registerSgp4Worker(worker);
    await expect(connectSgp4Worker(main, [{ line1: ISS_LINE1, line2: deepLine2, name: 'DEEP' }]))
      .rejects.toThrow(/deep/i);
  });
});

function circleCzml(id: string, epochIso: string): unknown[] {
  const samples: number[] = [];
  const aM = 7000 * 1000;
  const omega = (2 * Math.PI) / 5900;
  for (let i = 0; i <= 8; i++) {
    const t = i * 30;
    samples.push(t, aM * Math.cos(omega * t), aM * Math.sin(omega * t), 0);
  }
  return [
    { id: 'document', version: '1.0' },
    { id, position: { epoch: epochIso, referenceFrame: 'FIXED', cartesian: samples } },
  ];
}

describe('CZML playback (the ADR-0008 deferral landed)', () => {
  it('parses packets into tables and serves interpolated states in km', async () => {
    const provider = czmlProvider(JSON.stringify(circleCzml('SAT-1', '2026-07-12T00:00:00Z')));
    expect(provider.id).toBe('czml');
    const [table] = parseCzmlStates(circleCzml('SAT-1', '2026-07-12T00:00:00Z'));
    const start = table!.epochs[0]!;
    const batch = await provider.states({
      targets: ['SAT-1'], observer: 'EARTH', frame: 'ITRF93', correction: 'NONE',
      epochs: { start, end: start + 240, step: 30 },
    });
    // Sample nodes reproduce exactly; radii are kilometers, not meters.
    expect(batch.states[0]!).toBeCloseTo(7000, 6);
    const vx = batch.states[3]!;
    const vy = batch.states[4]!;
    expect(Math.hypot(vx, vy)).toBeCloseTo(7000 * (2 * Math.PI / 5900), 2);
    // The epoch anchors to Et: 2026-07-12 UTC is about 837 Ms past J2000.
    expect(etToUtcUnix(start)).toBeCloseTo(Date.parse('2026-07-12T00:00:00Z') / 1000, 3);
  });

  it('refuses inertial frames, cartographic packets, constants, and string times', () => {
    const base = circleCzml('SAT-1', '2026-07-12T00:00:00Z') as Array<{ id: string; position?: Record<string, unknown> }>;
    const inertial = structuredClone(base);
    inertial[1]!.position!['referenceFrame'] = 'INERTIAL';
    expect(() => parseCzmlStates(inertial)).toThrow(/frames-math non-goal/);
    const cartographic = structuredClone(base);
    cartographic[1]!.position = { epoch: 'x', cartographicDegrees: [0, 0, 0, 0] };
    expect(() => parseCzmlStates(cartographic)).toThrow(/cartographicDegrees/);
    const constant = structuredClone(base);
    constant[1]!.position = { cartesian: [1, 2, 3] };
    expect(() => parseCzmlStates(constant)).toThrow(/constant position/);
    const stringTimes = structuredClone(base);
    stringTimes[1]!.position = { epoch: '2026-07-12T00:00:00Z', cartesian: ['2026-07-12T00:00:00Z', 1, 2, 3, '2026-07-12T00:00:30Z', 4, 5, 6] };
    expect(() => parseCzmlStates(stringTimes)).toThrow(/offset seconds/);
  });
});

function circularTable(): PresampledStateTable {
  const n = 11;
  const epochs = new Float64Array(n);
  const states = new Float64Array(n * 6);
  const a = 7000;
  const omega = (2 * Math.PI) / 5900;
  for (let i = 0; i < n; i++) {
    const t = i * 60;
    epochs[i] = t;
    states.set([
      a * Math.cos(omega * t), a * Math.sin(omega * t), 0,
      -a * omega * Math.sin(omega * t), a * omega * Math.cos(omega * t), 0,
    ], i * 6);
  }
  return { body: 'SAT-H', observer: 'EARTH', frame: 'ITRF93', correction: 'NONE', epochs, states };
}

/** Loopback fetch: the client body goes straight into serveStateRequest. */
function loopbackFetch(provider: PresampledProvider): typeof fetch {
  return (async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body)) as unknown;
    const wire = await serveStateRequest(provider, request);
    return {
      ok: true,
      status: 200,
      json: async () => wire,
    };
  }) as unknown as typeof fetch;
}

describe('HTTP wire: the states-from-a-service posture', () => {
  it('round-trips states and coverage through JSON, Float64Arrays rebuilt', async () => {
    const local = new PresampledProvider([circularTable()], { id: 'service' });
    const remote = httpStateProvider('https://example.test/states', 'service', { fetchImpl: loopbackFetch(local) });
    const query: StateQuery = {
      targets: ['SAT-H'], observer: 'EARTH', frame: 'ITRF93', correction: 'NONE',
      epochs: { start: 0, end: 300, step: 60 },
    };
    const [direct, wired] = await Promise.all([local.states(query), remote.states(query)]);
    expect(wired.epochs).toBeInstanceOf(Float64Array);
    expect([...wired.epochs]).toEqual([...direct.epochs]);
    expect([...wired.states]).toEqual([...direct.states]);
    const coverage = await remote.coverage!('SAT-H');
    expect(coverage[0]).toEqual({ start: 0, end: 600 });
  });

  it('revives CoverageRefusalError structurally, fields intact', async () => {
    const local = new PresampledProvider([circularTable()], { id: 'service' });
    const remote = httpStateProvider('https://example.test/states', 'service', { fetchImpl: loopbackFetch(local) });
    const outside = remote.states({
      targets: ['SAT-H'], observer: 'EARTH', frame: 'ITRF93', correction: 'NONE',
      epochs: { start: 9000, end: 9300, step: 60 },
    });
    await expect(outside).rejects.toBeInstanceOf(CoverageRefusalError);
    await outside.catch((err: CoverageRefusalError) => {
      expect(err.body).toBe('SAT-H');
      expect(err.covered[0]).toEqual({ start: 0, end: 600 });
    });
  });
});
