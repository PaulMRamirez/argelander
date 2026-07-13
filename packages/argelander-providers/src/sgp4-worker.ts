/**
 * The shipped SGP4 worker entry (ADR-0009): a host's worker file is one
 * import of this module. It self-registers on the worker global and waits
 * for the init message connectSgp4Worker posts from the main thread.
 */
import { registerSgp4Worker } from './worker-wiring.js';
import type { StatePortLike } from './port.js';

registerSgp4Worker(globalThis as unknown as StatePortLike);
