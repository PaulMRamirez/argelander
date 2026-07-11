/**
 * Pre-sampled state playback (SPEC-PROVIDER section 2, ADR-0008): per-body
 * tables of epochs and flat states, served by cubic Hermite interpolation
 * over position and velocity. The table declares its body, observer, frame,
 * and correction; a query that disagrees refuses rather than relabeling, and
 * epochs outside the sampled span refuse with CoverageRefusalError (never
 * extrapolation). Optional quaternion tables serve orientation by slerp.
 */
import { CoverageRefusalError, SOFT_MAX_EPOCHS_PER_QUERY, expandEpochs } from 'argelander-core';
import type {
  BodyId, Correction, CoverageWindow, Et, FrameId, QuatBatch, StateBatch, StateProvider, StateQuery,
} from 'argelander-core';
import { SPEED_OF_LIGHT_KM_S } from './earth.js';

export interface PresampledStateTable {
  readonly body: BodyId;
  readonly observer: BodyId;
  readonly frame: FrameId;
  readonly correction: Correction;
  /** Strictly increasing, at least two samples. */
  readonly epochs: Float64Array;
  /** epochs.length blocks of 6 doubles (x, y, z km then vx, vy, vz km/s). */
  readonly states: Float64Array;
  /** Optional one-way light times, seconds; geometric |r|/c is used when absent. */
  readonly lightTimes?: Float64Array;
}

export interface PresampledQuatTable {
  readonly body: BodyId;
  readonly frame: FrameId;
  readonly bodyFrame: FrameId;
  /** Strictly increasing, at least two samples. */
  readonly epochs: Float64Array;
  /** epochs.length blocks of 4 doubles, SPICE scalar-first (w, x, y, z). */
  readonly quats: Float64Array;
}

export interface PresampledProviderOptions {
  /** Provider identity for Strip.provenance.authority; default 'presampled'. */
  id?: string;
}

function requireIncreasing(epochs: Float64Array, label: string): void {
  if (epochs.length < 2) throw new Error(`${label} needs at least two samples, got ${epochs.length}`);
  for (let i = 1; i < epochs.length; i++) {
    if (!(epochs[i]! > epochs[i - 1]!)) {
      throw new Error(`${label} epochs must be strictly increasing (index ${i})`);
    }
  }
}

/** Largest i with epochs[i] <= et, given epochs[0] <= et <= epochs[n-1]. */
function bracket(epochs: Float64Array, et: Et): number {
  let lo = 0;
  let hi = epochs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (epochs[mid]! <= et) lo = mid;
    else hi = mid;
  }
  return lo;
}

export class PresampledProvider implements StateProvider {
  readonly id: string;
  private readonly tables = new Map<string, PresampledStateTable>();
  private readonly quatTables = new Map<string, PresampledQuatTable>();

  constructor(
    tables: readonly PresampledStateTable[],
    quatTables: readonly PresampledQuatTable[] = [],
    options: PresampledProviderOptions = {},
  ) {
    this.id = options.id ?? 'presampled';
    if (tables.length === 0) throw new Error('PresampledProvider requires at least one state table');
    for (const table of tables) {
      if (this.tables.has(table.body)) throw new Error(`duplicate state table for body '${table.body}'`);
      requireIncreasing(table.epochs, `state table '${table.body}'`);
      if (table.states.length !== table.epochs.length * 6) {
        throw new Error(`state table '${table.body}' has ${table.states.length} doubles for ${table.epochs.length} epochs; expected ${table.epochs.length * 6}`);
      }
      if (table.lightTimes && table.lightTimes.length !== table.epochs.length) {
        throw new Error(`state table '${table.body}' has ${table.lightTimes.length} light times for ${table.epochs.length} epochs`);
      }
      this.tables.set(table.body, table);
    }
    for (const table of quatTables) {
      if (this.quatTables.has(table.body)) throw new Error(`duplicate quaternion table for body '${table.body}'`);
      requireIncreasing(table.epochs, `quaternion table '${table.body}'`);
      if (table.quats.length !== table.epochs.length * 4) {
        throw new Error(`quaternion table '${table.body}' has ${table.quats.length} doubles for ${table.epochs.length} epochs; expected ${table.epochs.length * 4}`);
      }
      this.quatTables.set(table.body, table);
    }
  }

  private resolve(target: BodyId): PresampledStateTable {
    const table = this.tables.get(target);
    if (!table) {
      throw new Error(`unknown target '${target}'; this ${this.id} provider serves: ${[...this.tables.keys()].join(', ')}`);
    }
    return table;
  }

  private static span(epochs: Float64Array): CoverageWindow {
    return { start: epochs[0]!, end: epochs[epochs.length - 1]! };
  }

  async states(q: StateQuery): Promise<StateBatch> {
    const tables = q.targets.map((t) => this.resolve(t));
    for (const table of tables) {
      if (table.frame !== q.frame) {
        throw new Error(`frame '${q.frame}' unsupported for '${table.body}': the table is sampled in '${table.frame}'`);
      }
      if (table.observer !== q.observer) {
        throw new Error(`observer '${q.observer}' unsupported for '${table.body}': the table is sampled from '${table.observer}'`);
      }
      if (table.correction !== q.correction) {
        throw new Error(`correction '${q.correction}' unsupported for '${table.body}': the table is sampled with '${table.correction}'`);
      }
    }

    const epochs = expandEpochs(q.epochs);
    const n = epochs.length;

    if (n > SOFT_MAX_EPOCHS_PER_QUERY) {
      const err = new CoverageRefusalError(
        q.targets[0]!,
        { start: epochs[0]!, end: epochs[n - 1]! },
        [PresampledProvider.span(tables[0]!.epochs)],
      );
      err.message += ` (query of ${n} epochs exceeds SOFT_MAX_EPOCHS_PER_QUERY = ${SOFT_MAX_EPOCHS_PER_QUERY}; chunk and stitch per SPEC-STRIP section 7)`;
      throw err;
    }

    if (n > 0) {
      let min = epochs[0]!;
      let max = epochs[0]!;
      for (let i = 1; i < n; i++) {
        const e = epochs[i]!;
        if (e < min) min = e;
        if (e > max) max = e;
      }
      for (let t = 0; t < tables.length; t++) {
        const window = PresampledProvider.span(tables[t]!.epochs);
        if (min < window.start || max > window.end) {
          throw new CoverageRefusalError(q.targets[t]!, { start: min, end: max }, [window]);
        }
      }
    }

    const states = new Float64Array(tables.length * n * 6);
    const lightTimes = new Float64Array(tables.length * n);
    for (let t = 0; t < tables.length; t++) {
      const table = tables[t]!;
      for (let i = 0; i < n; i++) {
        const offset = (t * n + i) * 6;
        const lt = this.sampleInto(table, epochs[i]!, states, offset);
        lightTimes[t * n + i] = lt;
      }
    }

    return {
      targets: [...q.targets],
      observer: q.observer,
      frame: q.frame,
      correction: q.correction,
      epochs,
      states,
      lightTimes,
    };
  }

  /** Hermite-interpolate one state block; returns the light time for the sample. */
  private sampleInto(table: PresampledStateTable, et: Et, out: Float64Array, offset: number): number {
    const epochs = table.epochs;
    const k = bracket(epochs, et);
    const t0 = epochs[k]!;

    if (et === t0 || et === epochs[k + 1]!) {
      const j = et === t0 ? k : k + 1;
      for (let ax = 0; ax < 6; ax++) out[offset + ax] = table.states[j * 6 + ax]!;
      if (table.lightTimes) return table.lightTimes[j]!;
      return geometricLightTime(out, offset);
    }

    const t1 = epochs[k + 1]!;
    const h = t1 - t0;
    const sN = (et - t0) / h;
    const s2 = sN * sN;
    const s3 = s2 * sN;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + sN;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const d00 = (6 * s2 - 6 * sN) / h;
    const d10 = 3 * s2 - 4 * sN + 1;
    const d01 = (-6 * s2 + 6 * sN) / h;
    const d11 = 3 * s2 - 2 * sN;
    const a = k * 6;
    const b = (k + 1) * 6;
    const st = table.states;
    for (let ax = 0; ax < 3; ax++) {
      const p0 = st[a + ax]!;
      const v0 = st[a + 3 + ax]!;
      const p1 = st[b + ax]!;
      const v1 = st[b + 3 + ax]!;
      out[offset + ax] = h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
      out[offset + 3 + ax] = d00 * p0 + d10 * v0 + d01 * p1 + d11 * v1;
    }
    if (table.lightTimes) {
      return table.lightTimes[k]! * (1 - sN) + table.lightTimes[k + 1]! * sN;
    }
    return geometricLightTime(out, offset);
  }

  async orientation(body: BodyId, frame: FrameId, epochs: Et[]): Promise<QuatBatch> {
    const table = this.quatTables.get(body);
    if (!table) {
      throw new Error(`no quaternion table for '${body}'; this ${this.id} provider serves orientation for: ${[...this.quatTables.keys()].join(', ') || '(none)'}`);
    }
    if (table.frame !== frame) {
      throw new Error(`orientation frame '${frame}' unsupported for '${body}': the table is sampled from '${table.frame}'`);
    }
    const epochArray = Float64Array.from(epochs);
    if (epochArray.length > 0) {
      let min = epochArray[0]!;
      let max = epochArray[0]!;
      for (let i = 1; i < epochArray.length; i++) {
        const e = epochArray[i]!;
        if (e < min) min = e;
        if (e > max) max = e;
      }
      const window = PresampledProvider.span(table.epochs);
      if (min < window.start || max > window.end) {
        throw new CoverageRefusalError(body, { start: min, end: max }, [window]);
      }
    }
    const quats = new Float64Array(epochArray.length * 4);
    for (let i = 0; i < epochArray.length; i++) {
      slerpInto(table, epochArray[i]!, quats, i * 4);
    }
    return { body, frame, bodyFrame: table.bodyFrame, epochs: epochArray, quats };
  }

  async coverage(body: BodyId): Promise<readonly CoverageWindow[]> {
    return [PresampledProvider.span(this.resolve(body).epochs)];
  }
}

function geometricLightTime(states: Float64Array, offset: number): number {
  const x = states[offset]!;
  const y = states[offset + 1]!;
  const z = states[offset + 2]!;
  return Math.sqrt(x * x + y * y + z * z) / SPEED_OF_LIGHT_KM_S;
}

function slerpInto(table: PresampledQuatTable, et: Et, out: Float64Array, offset: number): void {
  const epochs = table.epochs;
  const k = bracket(epochs, et);
  const q = table.quats;
  const a = k * 4;
  const b = (k + 1) * 4;
  if (et === epochs[k]! || et === epochs[k + 1]!) {
    const j = et === epochs[k]! ? a : b;
    for (let c = 0; c < 4; c++) out[offset + c] = q[j + c]!;
    return;
  }
  const s = (et - epochs[k]!) / (epochs[k + 1]! - epochs[k]!);
  let dot = q[a]! * q[b]! + q[a + 1]! * q[b + 1]! + q[a + 2]! * q[b + 2]! + q[a + 3]! * q[b + 3]!;
  let sign = 1;
  if (dot < 0) {
    sign = -1;
    dot = -dot;
  }
  let w0: number;
  let w1: number;
  if (dot > 0.9995) {
    w0 = 1 - s;
    w1 = sign * s;
  } else {
    const theta = Math.acos(Math.min(1, dot));
    const st = Math.sin(theta);
    w0 = Math.sin((1 - s) * theta) / st;
    w1 = (sign * Math.sin(s * theta)) / st;
  }
  let nw = 0;
  for (let c = 0; c < 4; c++) {
    const v = w0 * q[a + c]! + w1 * q[b + c]!;
    out[offset + c] = v;
    nw += v * v;
  }
  const inv = 1 / Math.sqrt(nw);
  for (let c = 0; c < 4; c++) out[offset + c] = out[offset + c]! * inv;
}

export interface PresampledCsvMeta {
  body: BodyId;
  observer: BodyId;
  frame: FrameId;
  correction: Correction;
}

/**
 * Ingest the CSV column format 'et,x,y,z,vx,vy,vz' with an optional trailing
 * 'lt' column: km, km/s, seconds. Blank lines and '#' comments are skipped;
 * anything malformed refuses with the line number named.
 */
export function parsePresampledCsv(text: string, meta: PresampledCsvMeta): PresampledStateTable {
  const lines = text.split('\n');
  let header: readonly string[] | undefined;
  const rows: number[][] = [];
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln]!.trim();
    if (line === '' || line.startsWith('#')) continue;
    const cells = line.split(',').map((c) => c.trim());
    if (!header) {
      const joined = cells.join(',').toLowerCase();
      if (joined !== 'et,x,y,z,vx,vy,vz' && joined !== 'et,x,y,z,vx,vy,vz,lt') {
        throw new Error(`line ${ln + 1}: expected header 'et,x,y,z,vx,vy,vz[,lt]', got '${line}'`);
      }
      header = cells;
      continue;
    }
    if (cells.length !== header.length) {
      throw new Error(`line ${ln + 1}: expected ${header.length} columns, got ${cells.length}`);
    }
    const row = cells.map((c) => Number(c));
    if (row.some((v) => !Number.isFinite(v))) {
      throw new Error(`line ${ln + 1}: non-numeric value in '${line}'`);
    }
    rows.push(row);
  }
  if (!header) throw new Error('empty pre-sampled CSV: no header line found');
  const hasLt = header.length === 8;
  const epochs = new Float64Array(rows.length);
  const states = new Float64Array(rows.length * 6);
  const lightTimes = hasLt ? new Float64Array(rows.length) : undefined;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    epochs[i] = row[0]!;
    for (let ax = 0; ax < 6; ax++) states[i * 6 + ax] = row[1 + ax]!;
    if (lightTimes) lightTimes[i] = row[7]!;
  }
  const table: PresampledStateTable = { ...meta, epochs, states };
  return lightTimes ? { ...table, lightTimes } : table;
}
