/**
 * CZML playback (ADR-0009), the provider ADR-0008 deferred here: position
 * packets become pre-sampled state tables and PresampledProvider does the
 * serving. Scope is honest and narrow. Supported: packets whose position
 * carries an ISO epoch plus time-tagged cartesian samples (offset seconds,
 * meters), referenceFrame FIXED, the CZML default. Refused with named
 * errors: INERTIAL frames (rotating them body-fixed is frames math, the
 * non-goal), cartographicDegrees, ISO-string sample times, and constant
 * positions (a single point cannot make a track). Velocities are derived
 * from the samples by weighted central differences, rendering grade and
 * exactly consistent with the positions the table carries.
 */
import type { BodyId, Correction, FrameId } from 'argelander-core';
import { PresampledProvider } from './presampled.js';
import type { PresampledProviderOptions, PresampledStateTable } from './presampled.js';
import { utcUnixToEt } from './time.js';

export interface CzmlTableMeta {
  /** The central body the states are relative to; default EARTH. */
  observer?: BodyId;
  /** The label for CZML's FIXED frame in your host; default ITRF93. */
  frame?: FrameId;
  correction?: Correction;
}

interface CzmlPosition {
  epoch?: unknown;
  cartesian?: unknown;
  cartographicDegrees?: unknown;
  referenceFrame?: unknown;
}

interface CzmlPacket {
  id?: unknown;
  position?: CzmlPosition;
}

function isoToEt(iso: string, where: string): number {
  const unixMs = Date.parse(iso);
  if (Number.isNaN(unixMs)) throw new Error(`${where}: unparseable epoch '${iso}'`);
  return utcUnixToEt(unixMs / 1000);
}

function packetTable(packet: CzmlPacket, meta: Required<CzmlTableMeta>): PresampledStateTable {
  const id = packet.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('CZML position packet needs a string id');
  const position = packet.position!;
  if (position.cartographicDegrees !== undefined) {
    throw new Error(`packet '${id}': cartographicDegrees is unsupported; provide cartesian samples`);
  }
  const frame = position.referenceFrame ?? 'FIXED';
  if (frame !== 'FIXED') {
    throw new Error(`packet '${id}': referenceFrame '${String(frame)}' is unsupported; only FIXED (rotating inertial states is the frames-math non-goal)`);
  }
  const cartesian = position.cartesian;
  if (!Array.isArray(cartesian)) throw new Error(`packet '${id}': position.cartesian must be an array`);
  if (cartesian.length === 3) throw new Error(`packet '${id}': a constant position cannot make a track`);
  if (cartesian.length % 4 !== 0 || cartesian.length < 8) {
    throw new Error(`packet '${id}': cartesian must be time-tagged quadruples (t, x, y, z), at least two`);
  }
  if (typeof position.epoch !== 'string') throw new Error(`packet '${id}': time-tagged cartesian needs an ISO epoch`);
  const epochEt = isoToEt(position.epoch, `packet '${id}'`);

  const n = cartesian.length / 4;
  const t = new Float64Array(n);
  const p = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const offset = cartesian[i * 4];
    if (typeof offset !== 'number') {
      throw new Error(`packet '${id}': sample times must be offset seconds, not ISO strings`);
    }
    t[i] = epochEt + offset;
    // CZML positions are meters; the seam speaks kilometers.
    p[i * 3 + 0] = (cartesian[i * 4 + 1] as number) / 1000;
    p[i * 3 + 1] = (cartesian[i * 4 + 2] as number) / 1000;
    p[i * 3 + 2] = (cartesian[i * 4 + 3] as number) / 1000;
  }

  const states = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    states[i * 6 + 0] = p[i * 3 + 0]!;
    states[i * 6 + 1] = p[i * 3 + 1]!;
    states[i * 6 + 2] = p[i * 3 + 2]!;
    // Weighted central differences on the non-uniform grid; one-sided ends.
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    for (let axis = 0; axis < 3; axis++) {
      let v: number;
      if (lo === i || hi === i) {
        v = (p[hi * 3 + axis]! - p[lo * 3 + axis]!) / (t[hi]! - t[lo]!);
      } else {
        const dtLo = t[i]! - t[lo]!;
        const dtHi = t[hi]! - t[i]!;
        const slopeLo = (p[i * 3 + axis]! - p[lo * 3 + axis]!) / dtLo;
        const slopeHi = (p[hi * 3 + axis]! - p[i * 3 + axis]!) / dtHi;
        v = (slopeLo * dtHi + slopeHi * dtLo) / (dtLo + dtHi);
      }
      states[i * 6 + 3 + axis] = v;
    }
  }

  return {
    body: id,
    observer: meta.observer,
    frame: meta.frame,
    correction: meta.correction,
    epochs: t,
    states,
  };
}

/** Parse a CZML document (text or the parsed array) into state tables. */
export function parseCzmlStates(czml: string | readonly unknown[], meta: CzmlTableMeta = {}): PresampledStateTable[] {
  const resolved: Required<CzmlTableMeta> = {
    observer: meta.observer ?? 'EARTH',
    frame: meta.frame ?? 'ITRF93',
    correction: meta.correction ?? 'NONE',
  };
  const document = typeof czml === 'string' ? (JSON.parse(czml) as unknown) : czml;
  if (!Array.isArray(document)) throw new Error('CZML must be an array of packets');
  const tables: PresampledStateTable[] = [];
  for (const raw of document) {
    const packet = raw as CzmlPacket;
    if (packet?.id === 'document' || packet?.position === undefined) continue;
    tables.push(packetTable(packet, resolved));
  }
  if (tables.length === 0) throw new Error('CZML carries no position packets');
  return tables;
}

/** The CZML playback provider: parsed packets served by PresampledProvider. */
export function czmlProvider(
  czml: string | readonly unknown[],
  meta: CzmlTableMeta = {},
  options: PresampledProviderOptions = {},
): PresampledProvider {
  return new PresampledProvider(parseCzmlStates(czml, meta), { id: options.id ?? 'czml' });
}
