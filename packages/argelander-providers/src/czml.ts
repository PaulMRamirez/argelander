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
import { statesFromPositions } from './trajectory.js';

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
  // ECMAScript reads a zone-less date-time as LOCAL time; CZML (Cesium's
  // JulianDate.fromIso8601) reads a missing offset as UTC. Append 'Z' so a
  // zone-less epoch does not shift the whole track by the viewer's offset.
  const zoned = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso.trim()) ? iso.trim() : `${iso.trim()}Z`;
  const unixMs = Date.parse(zoned);
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

  return {
    body: id,
    observer: meta.observer,
    frame: meta.frame,
    correction: meta.correction,
    epochs: t,
    states: statesFromPositions(t, p),
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
    // A packet with no position, or an explicit null position (a CZML gap
    // clear), carries no track: skip it rather than dereferencing null.
    if (packet?.id === 'document' || packet?.position == null) continue;
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
