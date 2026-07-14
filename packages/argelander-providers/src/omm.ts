/**
 * OMM parsing (AGE-04, PHASE-5). CCSDS Orbit Mean-elements Messages in KVN and
 * XML, and the flat Celestrak and Space-Track GP JSON, all carry the same SGP4
 * mean elements a TLE does, so this returns the Tle shape parseTle produces and
 * feeds the SGP4 path unchanged. It is a format, not a new wire shape or a
 * schema change (ADR-0014 rule 7), so no ADR is required. Only the fields SGP4
 * consumes are read; the element set number, revolution at epoch, and mean
 * motion rates are metadata the model ignores. Parsed by hand, no dependency.
 *
 * Scope is honest and narrow, like the CZML and GeoJSON parsers. The reference
 * frame must be TEME, the time system UTC, and the mean-element theory an SGP4
 * family, because those are what the propagator assumes; a document that names
 * anything else is refused rather than silently misused, and the flat GP JSON
 * that omits those metadata is taken as the SGP4 elements it is by definition.
 * Deep-space element sets parse here and are refused where a TLE's are, at
 * Sgp4Provider construction, so the two element formats fail identically.
 */
import { utcUnixToEt, yearDayToUtcUnix } from './time.js';
import type { Tle } from './tle.js';

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
// Only the theories the near-earth propagator serves; SDP4 names the same
// element set and is refused downstream as deep-space, while SGP4-XP and the
// original SGP are refused here so they are never silently propagated as SGP4.
const SGP4_THEORIES: ReadonlySet<string> = new Set(['SGP4', 'SDP4']);

type OmmValue = string | number;
type OmmRecord = Record<string, OmmValue>;

function readString(rec: OmmRecord, key: string): string | undefined {
  const v = rec[key];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function readNumber(rec: OmmRecord, key: string): number {
  const raw = readString(rec, key);
  if (raw === undefined) throw new Error(`OMM missing required field ${key}`);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`OMM field ${key} is not a finite number: ${raw}`);
  return n;
}

function epochToUnixSec(iso: string): number {
  const t = iso.trim();
  // CCSDS permits an ordinal epoch, YYYY-DDDThh:mm:ss[.f], which Date.parse
  // cannot read; convert it through the same day-of-year helper parseTle uses.
  const ordinal = /^(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)Z?$/.exec(t);
  if (ordinal) {
    const secondsOfDay = Number(ordinal[3]) * 3600 + Number(ordinal[4]) * 60 + Number(ordinal[5]);
    return yearDayToUtcUnix(Number(ordinal[1]), Number(ordinal[2]) + secondsOfDay / 86400);
  }
  // The calendar form goes through Date.parse; OMM epochs are UTC, so append Z
  // when no offset is present, exactly as the CZML parser does, so a zone-less
  // epoch is not shifted by the reader's local offset.
  const zoned = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}Z`;
  const ms = Date.parse(zoned);
  if (Number.isNaN(ms)) throw new Error(`OMM EPOCH unparseable: ${iso}`);
  return ms / 1000;
}

function recordToTle(rec: OmmRecord): Tle {
  const frame = readString(rec, 'REF_FRAME');
  if (frame !== undefined && frame.toUpperCase() !== 'TEME') {
    throw new Error(`OMM REF_FRAME '${frame}' unsupported: SGP4 elements are TEME`);
  }
  const timeSystem = readString(rec, 'TIME_SYSTEM');
  if (timeSystem !== undefined && timeSystem.toUpperCase() !== 'UTC') {
    throw new Error(`OMM TIME_SYSTEM '${timeSystem}' unsupported: SGP4 element epochs are UTC`);
  }
  const theory = readString(rec, 'MEAN_ELEMENT_THEORY');
  if (theory !== undefined && !SGP4_THEORIES.has(theory.toUpperCase())) {
    throw new Error(`OMM MEAN_ELEMENT_THEORY '${theory}' unsupported: this parser feeds the SGP4 path`);
  }

  const epochIso = readString(rec, 'EPOCH');
  if (epochIso === undefined) throw new Error('OMM missing required field EPOCH');
  const epochUtcUnixSec = epochToUnixSec(epochIso);
  const epochYear = new Date(epochUtcUnixSec * 1000).getUTCFullYear();
  const epochDayOfYear = (epochUtcUnixSec - Date.UTC(epochYear, 0, 1) / 1000) / 86400 + 1;

  const ecc = readNumber(rec, 'ECCENTRICITY');
  const meanMotionRevDay = readNumber(rec, 'MEAN_MOTION');
  if (!(ecc >= 0 && ecc < 1)) throw new Error(`OMM eccentricity ${ecc} outside [0, 1)`);
  if (!(meanMotionRevDay > 0)) throw new Error(`OMM mean motion ${meanMotionRevDay} must be positive`);

  const objectName = readString(rec, 'OBJECT_NAME');
  const satnum = readString(rec, 'NORAD_CAT_ID') ?? objectName ?? readString(rec, 'OBJECT_ID');
  if (satnum === undefined) {
    throw new Error('OMM missing an identifier (NORAD_CAT_ID, OBJECT_NAME, or OBJECT_ID)');
  }

  // BSTAR is optional in the abstract, but present on every SGP4-theory element
  // set; default 0 when absent so a drag-free element set still builds.
  const bstar = readString(rec, 'BSTAR') === undefined ? 0 : readNumber(rec, 'BSTAR');

  const tle: Tle = {
    satnum,
    epochYear,
    epochDayOfYear,
    epochUtcUnixSec,
    epochEt: utcUnixToEt(epochUtcUnixSec),
    bstar,
    inclRad: readNumber(rec, 'INCLINATION') * DEG2RAD,
    raanRad: readNumber(rec, 'RA_OF_ASC_NODE') * DEG2RAD,
    ecc,
    argpRad: readNumber(rec, 'ARG_OF_PERICENTER') * DEG2RAD,
    meanAnomalyRad: readNumber(rec, 'MEAN_ANOMALY') * DEG2RAD,
    meanMotionRadPerMin: (meanMotionRevDay * TWO_PI) / 1440,
  };
  return objectName ? { ...tle, name: objectName } : tle;
}

/**
 * KVN: KEY = VALUE lines, trailing units in brackets and section markers
 * dropped. A KVN document is one or more complete OMM messages concatenated,
 * each opening with CCSDS_OMM_VERS (the Celestrak bulk KVN download), so this
 * splits on that boundary and builds one record per message, the way parseXml
 * builds one per segment. A missing EPOCH is caught per record in recordToTle.
 */
function parseKvn(text: string): OmmRecord[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const starts = lines.reduce<number[]>((acc, line, i) => {
    if (/^CCSDS_OMM_VERS\b/.test(line)) acc.push(i);
    return acc;
  }, []);
  const blocks = starts.length === 0
    ? [lines]
    : starts.map((start, k) => lines.slice(start, starts[k + 1] ?? lines.length));
  return blocks.map(kvnBlockToRecord);
}

function kvnBlockToRecord(lines: readonly string[]): OmmRecord {
  const rec: OmmRecord = {};
  for (const line of lines) {
    if (!line || line.startsWith('COMMENT')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const bracket = value.indexOf('[');
    if (bracket >= 0) value = value.slice(0, bracket).trim();
    rec[key] = value;
  }
  return rec;
}

const OMM_TAGS: readonly string[] = [
  'OBJECT_NAME', 'OBJECT_ID', 'NORAD_CAT_ID', 'REF_FRAME', 'TIME_SYSTEM', 'MEAN_ELEMENT_THEORY',
  'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER',
  'MEAN_ANOMALY', 'BSTAR',
];

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_m, e: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]!);
}

function xmlTag(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? decodeEntities(m[1]!).trim() : undefined;
}

/** XML: one record per <segment>; a multi-object document has several segments. */
function parseXml(text: string): OmmRecord[] {
  const segments = text.match(/<segment\b[\s\S]*?<\/segment>/g)
    ?? (/<omm\b/.test(text) ? [text] : []);
  if (segments.length === 0) throw new Error('OMM XML carries no <segment>');
  return segments.map((seg) => {
    const rec: OmmRecord = {};
    for (const tag of OMM_TAGS) {
      const v = xmlTag(seg, tag);
      if (v !== undefined) rec[tag] = v;
    }
    return rec;
  });
}

function parseJson(input: string | object): OmmRecord[] {
  const doc = typeof input === 'string' ? JSON.parse(input) : input;
  const arr = Array.isArray(doc) ? doc : [doc];
  if (arr.length === 0) throw new Error('OMM JSON array is empty');
  return arr.map((r) => {
    if (!r || typeof r !== 'object') throw new Error('OMM JSON record is not an object');
    return r as OmmRecord;
  });
}

function toRecords(input: string | object): OmmRecord[] {
  if (typeof input !== 'string') return parseJson(input);
  const t = input.trim();
  if (!t) throw new Error('OMM document is empty');
  if (t[0] === '[' || t[0] === '{') return parseJson(t);
  if (t[0] === '<') return parseXml(t);
  return parseKvn(t);
}

/** Parse an OMM document (KVN, XML, or GP JSON) into element sets, one Tle each. */
export function parseOmms(input: string | object): Tle[] {
  return toRecords(input).map(recordToTle);
}

/** Parse a single-object OMM document; use parseOmms for a multi-object set. */
export function parseOmm(input: string | object): Tle {
  const tles = parseOmms(input);
  if (tles.length !== 1) {
    throw new Error(`parseOmm expected a single element set, found ${tles.length}; use parseOmms for a multi-object document`);
  }
  return tles[0]!;
}
