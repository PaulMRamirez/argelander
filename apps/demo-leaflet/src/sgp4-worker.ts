/**
 * The propagation side of the seam (AGE-05): the shipped entry does the
 * rest. TLEs arrive from the main thread through connectSgp4Worker's init
 * message; SGP4 runs here and the main thread only paints.
 */
import 'argelander-providers/sgp4-worker';
