import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { CoverageRefusalError } from 'argelander-core';
import type { StateProvider } from 'argelander-core';
import { remoteStateProvider, serveStateProvider } from '../src/port.js';
import type { StatePortLike } from '../src/port.js';
import { Sgp4Provider } from '../src/sgp4-provider.js';
import { parseTle } from '../src/tle.js';

const TLE = {
  line1: '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
  line2: '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
};
const EPOCH = parseTle(TLE.line1, TLE.line2).epochEt;

/** Node MessagePort satisfies StatePortLike structurally at runtime. */
function pair(): { served: StatePortLike; remote: StatePortLike; close: () => void } {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.start();
  return {
    served: channel.port1 as unknown as StatePortLike,
    remote: channel.port2 as unknown as StatePortLike,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

function connect(provider: StateProvider): { proxy: StateProvider; close: () => void } {
  const { served, remote, close } = pair();
  serveStateProvider(served, provider);
  return { proxy: remoteStateProvider(remote, provider.id), close };
}

describe('worker port marshalling (AGE-05)', () => {
  it('round-trips a state batch with transferable arrays', async () => {
    const local = new Sgp4Provider([TLE]);
    const { proxy, close } = connect(new Sgp4Provider([TLE]));
    try {
      const query = {
        targets: ['00005'],
        observer: 'EARTH',
        frame: 'ITRF93',
        correction: 'NONE' as const,
        epochs: { start: EPOCH, end: EPOCH + 600, step: 60 },
      };
      const viaPort = await proxy.states(query);
      const direct = await local.states(query);
      expect(viaPort.frame).toBe('ITRF93');
      expect(viaPort.epochs).toBeInstanceOf(Float64Array);
      expect([...viaPort.epochs]).toEqual([...direct.epochs]);
      expect([...viaPort.states]).toEqual([...direct.states]);
      expect([...viaPort.lightTimes]).toEqual([...direct.lightTimes]);
    } finally {
      close();
    }
  });

  it('round-trips orientation and coverage', async () => {
    const { proxy, close } = connect(new Sgp4Provider([TLE]));
    try {
      const spin = await proxy.orientation('EARTH', 'TEME', [EPOCH]);
      expect(spin.bodyFrame).toBe('ITRF93');
      expect(spin.quats.length).toBe(4);
      const windows = await proxy.coverage!('00005');
      expect(windows).toEqual([{ start: EPOCH - 7 * 86400, end: EPOCH + 7 * 86400 }]);
    } finally {
      close();
    }
  });

  it('revives the structured refusal across the boundary', async () => {
    const { proxy, close } = connect(new Sgp4Provider([TLE]));
    try {
      const err = await proxy.states({
        targets: ['00005'],
        observer: 'EARTH',
        frame: 'TEME',
        correction: 'NONE',
        epochs: [EPOCH + 30 * 86400],
      }).then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(CoverageRefusalError);
      const refusal = err as CoverageRefusalError;
      expect(refusal.body).toBe('00005');
      expect(refusal.covered).toEqual([{ start: EPOCH - 7 * 86400, end: EPOCH + 7 * 86400 }]);
      expect(refusal.message).toContain('outside coverage');
    } finally {
      close();
    }
  });

  it('marshals plain errors by name and message', async () => {
    const { proxy, close } = connect(new Sgp4Provider([TLE]));
    try {
      const err = await proxy.states({
        targets: ['00005'], observer: 'EARTH', frame: 'TEME', correction: 'LT', epochs: [EPOCH],
      }).then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/geometric/);
      expect(err).not.toBeInstanceOf(CoverageRefusalError);
    } finally {
      close();
    }
  });

  it('ignores unrelated traffic on a shared port', async () => {
    const { served, remote, close } = pair();
    serveStateProvider(served, new Sgp4Provider([TLE]));
    const proxy = remoteStateProvider(remote, 'sgp4');
    try {
      remote.postMessage('unrelated');
      remote.postMessage({ tag: 'someone-else', seq: 1 });
      const batch = await proxy.states({
        targets: ['00005'], observer: 'EARTH', frame: 'TEME', correction: 'NONE', epochs: [EPOCH],
      });
      expect(batch.states.length).toBe(6);
    } finally {
      close();
    }
  });

  it('omits coverage on the proxy when asked', () => {
    const { remote, close } = pair();
    try {
      const proxy = remoteStateProvider(remote, 'no-coverage', { coverage: false });
      expect(proxy.coverage).toBeUndefined();
    } finally {
      close();
    }
  });
});
