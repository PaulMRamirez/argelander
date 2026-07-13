/**
 * The HTTP flavor of the provider wire (ADR-0009): the "states from a
 * service" posture. serveStateRequest is a pure request-in, response-out
 * function a host mounts on any server; httpStateProvider is the fetch
 * client. The wire speaks the same three ops as the message port, batches
 * cross as JSON number arrays rebuilt into Float64Arrays client-side, and
 * CoverageRefusalError round-trips structurally exactly as it does over
 * the port. This is the ADR-0008 convergence shape: a live service binding
 * is one more provider against the identical seam, one more transport.
 */
import type { BodyId, CoverageWindow, Et, FrameId, QuatBatch, StateBatch, StateProvider, StateQuery } from 'argelander-core';
import { marshalError, reviveError } from './port.js';
import type { WireError } from './port.js';

export type StateWireRequest =
  | { op: 'states'; query: StateQuery }
  | { op: 'orientation'; body: BodyId; frame: FrameId; epochs: readonly Et[] }
  | { op: 'coverage'; body: BodyId };

export type StateWireResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: WireError };

interface EncodedStateBatch {
  targets: readonly BodyId[];
  observer: BodyId;
  frame: FrameId;
  correction: StateBatch['correction'];
  epochs: readonly number[];
  states: readonly number[];
  lightTimes: readonly number[];
}

interface EncodedQuatBatch {
  body: BodyId;
  frame: FrameId;
  bodyFrame: FrameId;
  epochs: readonly number[];
  quats: readonly number[];
}

function encodeStateBatch(batch: StateBatch): EncodedStateBatch {
  return {
    targets: batch.targets,
    observer: batch.observer,
    frame: batch.frame,
    correction: batch.correction,
    epochs: [...batch.epochs],
    states: [...batch.states],
    lightTimes: [...batch.lightTimes],
  };
}

function decodeStateBatch(encoded: EncodedStateBatch): StateBatch {
  return {
    targets: encoded.targets,
    observer: encoded.observer,
    frame: encoded.frame,
    correction: encoded.correction,
    epochs: Float64Array.from(encoded.epochs),
    states: Float64Array.from(encoded.states),
    lightTimes: Float64Array.from(encoded.lightTimes),
  };
}

function encodeQuatBatch(batch: QuatBatch): EncodedQuatBatch {
  return {
    body: batch.body,
    frame: batch.frame,
    bodyFrame: batch.bodyFrame,
    epochs: [...batch.epochs],
    quats: [...batch.quats],
  };
}

function decodeQuatBatch(encoded: EncodedQuatBatch): QuatBatch {
  return {
    body: encoded.body,
    frame: encoded.frame,
    bodyFrame: encoded.bodyFrame,
    epochs: Float64Array.from(encoded.epochs),
    quats: Float64Array.from(encoded.quats),
  };
}

/**
 * Server side: answer one wire request against a local provider. Pure and
 * transport-agnostic; the host owns routing, method, and status codes and
 * simply returns this JSON-safe response body. Refusals come back as
 * ok: false with the marshaled error, never as a transport failure.
 */
export async function serveStateRequest(provider: StateProvider, request: unknown): Promise<StateWireResponse> {
  try {
    const r = request as Partial<StateWireRequest> | null;
    if (r?.op === 'states' && r.query) {
      return { ok: true, value: encodeStateBatch(await provider.states(r.query)) };
    }
    if (r?.op === 'orientation' && r.body && r.frame && r.epochs) {
      return { ok: true, value: encodeQuatBatch(await provider.orientation(r.body, r.frame, [...r.epochs])) };
    }
    if (r?.op === 'coverage' && r.body) {
      if (!provider.coverage) throw new Error(`provider '${provider.id}' does not advertise coverage`);
      return { ok: true, value: await provider.coverage(r.body) };
    }
    throw new Error('malformed state wire request');
  } catch (err) {
    return { ok: false, error: marshalError(err) };
  }
}

export interface HttpStateProviderOptions {
  /** Expose coverage() on the proxy; default true. */
  coverage?: boolean;
  /** Injectable fetch for tests and non-browser hosts; default globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** AbortSignal passed to every fetch, for host-owned cancellation. */
  signal?: AbortSignal;
}

/** Is this a marshaled wire failure body, whatever HTTP status carried it? */
function isWireFailure(value: unknown): value is { ok: false; error: WireError } {
  return typeof value === 'object' && value !== null
    && (value as { ok?: unknown }).ok === false
    && typeof (value as { error?: unknown }).error === 'object';
}

/** Client side: a StateProvider that POSTs wire requests to one endpoint. */
export function httpStateProvider(url: string, id: string, options: HttpStateProviderOptions = {}): StateProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const call = async <T>(request: StateWireRequest, decode: (value: unknown) => T): Promise<T> => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    // A refusal is a wire body, not a transport failure, so a host that maps
    // ok: false to a non-2xx status still round-trips CoverageRefusalError:
    // read the body first and revive a wire failure whatever the status.
    const body = await response.json().catch(() => undefined) as unknown;
    if (isWireFailure(body)) throw reviveError(body.error);
    if (!response.ok) throw new Error(`state service '${id}' answered ${response.status}`);
    const wire = body as StateWireResponse;
    if (!wire.ok) throw reviveError(wire.error);
    return decode(wire.value);
  };

  const base: StateProvider = {
    id,
    states: (query: StateQuery) => call({ op: 'states', query }, (v) => decodeStateBatch(v as EncodedStateBatch)),
    orientation: (body: BodyId, frame: FrameId, epochs: Et[]) =>
      call({ op: 'orientation', body, frame, epochs }, (v) => decodeQuatBatch(v as EncodedQuatBatch)),
  };
  if (options.coverage === false) return base;
  return {
    ...base,
    coverage: (body: BodyId) => call({ op: 'coverage', body }, (v) => v as readonly CoverageWindow[]),
  };
}
