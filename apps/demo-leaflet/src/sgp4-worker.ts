/**
 * The propagation side of the seam (AGE-05): SGP4 runs in this worker and
 * the main thread only paints. serveStateProvider answers the queries the
 * remote proxy posts; batches cross back as transferable Float64Arrays.
 */
import { Sgp4Provider, serveStateProvider } from 'argelander-providers';
import type { StatePortLike } from 'argelander-providers';
import { DEMO_SATS } from './tles.js';

serveStateProvider(
  globalThis as unknown as StatePortLike,
  new Sgp4Provider(DEMO_SATS.map((s) => ({ line1: s.line1, line2: s.line2, name: s.name }))),
);
