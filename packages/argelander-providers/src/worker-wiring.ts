/**
 * SGP4 worker wiring (ADR-0009, AGE-05): the host's worker file collapses
 * to one import of the shipped entry, and the main thread connects with a
 * ready handshake so no query can race the setup. TLEs travel to the
 * worker in an init message, the worker builds Sgp4Provider and serves it
 * over the same port protocol as any provider. The connect promise settles
 * exactly once and never hangs: a construction failure rejects with the
 * marshaled error (a DeepSpaceUnsupportedError arrives as itself), a worker
 * that fails to load rejects on the Worker 'error' event, a second connect
 * to an already-served port rejects loudly, and an optional timeout backs
 * up ports that have no error events at all.
 */
import type { StateProvider } from 'argelander-core';
import { marshalError, remoteStateProvider, reviveError, serveStateProvider } from './port.js';
import type { StatePortLike, WireError } from './port.js';
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
 * A Worker also fires 'error' events on load or evaluation failure, which
 * carry no wiring message. The connect side registers for them so a 404 or
 * a syntax error rejects the promise instead of hanging; ports without
 * error events (an in-memory MessagePort) simply never fire it.
 */
type ErrorListeningPort = StatePortLike & {
  addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
};

/**
 * Worker side: listen for the init message, build the provider, serve it,
 * acknowledge. The shipped entry module calls this on globalThis; calling
 * it directly is the testing seam. One provider per port: a later init
 * refuses loudly rather than being ignored, so a second connect rejects
 * instead of hanging. Errors marshal by type (marshalError), so a
 * DeepSpaceUnsupportedError survives the port as itself, not a bare Error.
 */
export function registerSgp4Worker(port: StatePortLike): void {
  let served = false;
  port.addEventListener('message', (event) => {
    const data = event.data as Partial<InitMessage> | null;
    if (!data || data.tag !== WIRING_TAG || data.op !== 'init') return;
    if (served) {
      port.postMessage({ tag: WIRING_TAG, op: 'error', error: marshalError(new Error('already initialized: one provider per port')) });
      return;
    }
    try {
      const provider = new Sgp4Provider(data.tles ?? [], data.options);
      // Serve only after construction succeeds, so a failed init leaves the
      // port free for a corrected retry.
      served = true;
      serveStateProvider(port, provider);
      port.postMessage({ tag: WIRING_TAG, op: 'ready' });
    } catch (err) {
      port.postMessage({ tag: WIRING_TAG, op: 'error', error: marshalError(err) });
    }
  });
}

export interface ConnectSgp4Options extends Sgp4ProviderOptions {
  /** Provider identity on the main thread; default 'sgp4'. */
  id?: string;
  /**
   * Reject if the worker has not acknowledged within this many milliseconds,
   * the backstop for a worker that never runs (a 404, a CSP block) on a port
   * without error events. Off by default.
   */
  timeoutMs?: number;
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
  const { id, timeoutMs, ...providerOptions } = options;
  return new Promise((resolve, reject) => {
    // One settlement only: a stale 'ready' (a retry after a failed init) or
    // a worker 'error' event after we already resolved must not fire again.
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    port.addEventListener('message', (event) => {
      const data = event.data as { tag?: unknown; op?: unknown; error?: WireError } | null;
      if (!data || data.tag !== WIRING_TAG) return;
      if (data.op === 'ready') settle(() => resolve(remoteStateProvider(port, id ?? 'sgp4')));
      else if (data.op === 'error') {
        settle(() => reject(data.error ? reviveError(data.error) : new Error('sgp4 worker failed to initialize')));
      }
    });
    // A Worker's 'error' event (load or eval failure) carries no wiring
    // message; reject on it so a broken worker file fails fast.
    (port as ErrorListeningPort).addEventListener?.('error', (event) => {
      settle(() => reject(new Error(event.message ?? 'sgp4 worker failed to load')));
    });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => settle(() => reject(new Error(`sgp4 worker did not acknowledge within ${timeoutMs} ms`))), timeoutMs);
    }
    port.postMessage({ tag: WIRING_TAG, op: 'init', tles, options: providerOptions });
  });
}
