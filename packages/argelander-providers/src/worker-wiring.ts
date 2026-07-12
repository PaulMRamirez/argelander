/**
 * SGP4 worker wiring (ADR-0009, AGE-05): the host's worker file collapses
 * to one import of the shipped entry, and the main thread connects with a
 * ready handshake so no query can race the setup. TLEs travel to the
 * worker in an init message, the worker builds Sgp4Provider and serves it
 * over the same port protocol as any provider; construction failures (a
 * deep-space element set) reject the connect promise with the worker's
 * message instead of hanging a query forever.
 */
import type { StateProvider } from 'argelander-core';
import { remoteStateProvider, serveStateProvider } from './port.js';
import type { StatePortLike } from './port.js';
import { Sgp4Provider } from './sgp4-provider.js';
import type { Sgp4ProviderOptions, Sgp4TleInput } from './sgp4-provider.js';

const WIRING_TAG = 'argelander-sgp4-wiring';

interface InitMessage {
  tag: typeof WIRING_TAG;
  op: 'init';
  tles: readonly Sgp4TleInput[];
  options?: Sgp4ProviderOptions;
}

/**
 * Worker side: listen for the init message, build the provider, serve it,
 * acknowledge. The shipped entry module calls this on globalThis; calling
 * it directly is the testing seam. Later inits are ignored: one provider
 * per port.
 */
export function registerSgp4Worker(port: StatePortLike): void {
  let served = false;
  port.addEventListener('message', (event) => {
    const data = event.data as Partial<InitMessage> | null;
    if (!data || data.tag !== WIRING_TAG || data.op !== 'init' || served) return;
    try {
      serveStateProvider(port, new Sgp4Provider(data.tles ?? [], data.options));
      served = true;
      port.postMessage({ tag: WIRING_TAG, op: 'ready' });
    } catch (err) {
      port.postMessage({ tag: WIRING_TAG, op: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
}

export interface ConnectSgp4Options extends Sgp4ProviderOptions {
  /** Provider identity on the main thread; default 'sgp4'. */
  id?: string;
}

/**
 * Main-thread side: post the element sets and resolve to the remote
 * provider only after the worker acknowledges. The worker must run the
 * shipped entry (import 'argelander-providers/sgp4-worker') or call
 * registerSgp4Worker itself.
 */
export function connectSgp4Worker(
  port: StatePortLike,
  tles: readonly Sgp4TleInput[],
  options: ConnectSgp4Options = {},
): Promise<StateProvider> {
  const { id, ...providerOptions } = options;
  return new Promise((resolve, reject) => {
    port.addEventListener('message', (event) => {
      const data = event.data as { tag?: unknown; op?: unknown; message?: string } | null;
      if (!data || data.tag !== WIRING_TAG) return;
      if (data.op === 'ready') resolve(remoteStateProvider(port, id ?? 'sgp4'));
      else if (data.op === 'error') reject(new Error(data.message ?? 'sgp4 worker failed to initialize'));
    });
    port.postMessage({ tag: WIRING_TAG, op: 'init', tles, options: providerOptions });
  });
}
