/**
 * Port marshalling for the seam (AGE-05, ADR-0008): serveStateProvider runs
 * inside a worker and answers queries for a local provider; remoteStateProvider
 * is the main-thread proxy. Batches cross the boundary as transferable
 * Float64Arrays and CoverageRefusalError round-trips structurally, so the
 * engine cannot tell a worker-hosted provider from an in-thread one.
 */
import { CoverageRefusalError } from 'argelander-core';
import type {
  BodyId, CoverageWindow, Et, FrameId, QuatBatch, StateBatch, StateProvider, StateQuery,
} from 'argelander-core';

const TAG = 'argelander-state-provider';

/** Structural subset of Worker, DedicatedWorkerGlobalScope, and MessagePort. */
export interface StatePortLike {
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

interface WireError {
  readonly name: string;
  readonly message: string;
  readonly body?: BodyId;
  readonly requested?: CoverageWindow;
  readonly covered?: readonly CoverageWindow[];
}

type PortRequestBody =
  | { op: 'states'; query: StateQuery }
  | { op: 'orientation'; body: BodyId; frame: FrameId; epochs: Et[] }
  | { op: 'coverage'; body: BodyId };

type PortRequest = { tag: typeof TAG; seq: number } & PortRequestBody;

type PortResponse =
  | { tag: typeof TAG; seq: number; ok: true; value: unknown }
  | { tag: typeof TAG; seq: number; ok: false; error: WireError };

function isTagged(data: unknown): data is { tag: typeof TAG; seq: number } {
  return typeof data === 'object' && data !== null
    && (data as { tag?: unknown }).tag === TAG
    && typeof (data as { seq?: unknown }).seq === 'number';
}

function marshalError(err: unknown): WireError {
  if (err instanceof CoverageRefusalError) {
    return { name: err.name, message: err.message, body: err.body, requested: err.requested, covered: [...err.covered] };
  }
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'Error', message: String(err) };
}

function reviveError(wire: WireError): Error {
  if (wire.name === 'CoverageRefusalError' && wire.body !== undefined && wire.requested && wire.covered) {
    const err = new CoverageRefusalError(wire.body, wire.requested, wire.covered);
    err.message = wire.message;
    return err;
  }
  const err = new Error(wire.message);
  err.name = wire.name;
  return err;
}

export interface ServeStateProviderOptions {
  /**
   * Transfer batch buffers instead of cloning; default true. Disable for a
   * provider that retains its returned arrays past the call.
   */
  transfer?: boolean;
}

export function serveStateProvider(port: StatePortLike, provider: StateProvider, options: ServeStateProviderOptions = {}): void {
  const transfer = options.transfer !== false;

  const respond = (seq: number, value: unknown, buffers?: readonly ArrayBuffer[]): void => {
    const response: PortResponse = { tag: TAG, seq, ok: true, value };
    port.postMessage(response, transfer ? buffers : undefined);
  };

  const handle = async (request: PortRequest): Promise<void> => {
    try {
      if (request.op === 'states') {
        const batch = await provider.states(request.query);
        respond(request.seq, batch, [batch.epochs.buffer, batch.states.buffer, batch.lightTimes.buffer] as ArrayBuffer[]);
      } else if (request.op === 'orientation') {
        const batch = await provider.orientation(request.body, request.frame, request.epochs);
        respond(request.seq, batch, [batch.epochs.buffer, batch.quats.buffer] as ArrayBuffer[]);
      } else {
        if (!provider.coverage) {
          throw new Error(`provider '${provider.id}' does not advertise coverage`);
        }
        respond(request.seq, await provider.coverage(request.body));
      }
    } catch (err) {
      const response: PortResponse = { tag: TAG, seq: request.seq, ok: false, error: marshalError(err) };
      port.postMessage(response);
    }
  };

  port.addEventListener('message', (event) => {
    if (!isTagged(event.data)) return;
    void handle(event.data as PortRequest);
  });
}

export interface RemoteStateProviderOptions {
  /** Expose coverage() on the proxy; default true. Set false when the served provider omits it. */
  coverage?: boolean;
}

export function remoteStateProvider(port: StatePortLike, id: string, options: RemoteStateProviderOptions = {}): StateProvider {
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let nextSeq = 1;

  port.addEventListener('message', (event) => {
    if (!isTagged(event.data)) return;
    const response = event.data as PortResponse;
    const entry = pending.get(response.seq);
    if (!entry) return;
    pending.delete(response.seq);
    if (response.ok) entry.resolve(response.value);
    else entry.reject(reviveError(response.error));
  });

  const call = <T>(request: PortRequestBody): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const seq = nextSeq++;
      pending.set(seq, { resolve: resolve as (value: unknown) => void, reject });
      port.postMessage({ tag: TAG, seq, ...request });
    });

  const base: StateProvider = {
    id,
    states: (q: StateQuery) => call<StateBatch>({ op: 'states', query: q }),
    orientation: (body: BodyId, frame: FrameId, epochs: Et[]) =>
      call<QuatBatch>({ op: 'orientation', body, frame, epochs }),
  };
  if (options.coverage === false) return base;
  return {
    ...base,
    coverage: (body: BodyId) => call<readonly CoverageWindow[]>({ op: 'coverage', body }),
  };
}
