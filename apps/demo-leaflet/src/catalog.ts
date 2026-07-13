/**
 * The demo's airborne instruments, drawn straight from the source-cited
 * instrument catalog (AGE-18) rather than the hand-tuned demonstration figures
 * the satellites still carry. Each imported JSON is one InstrumentModel; this
 * maps its family and cited parameters onto the trackStrip posture the demo
 * flies, so an AVIRIS-3 swath or a UAVSAR range drawn on the map is the catalog
 * value, not a number typed here.
 *
 * Import path: argelander-core ships its catalog directory (its package.json
 * files list), and with no exports map the bare subpath resolves to the JSON,
 * so the demo reads the exact data the conformance tests do, never a copy.
 */
import type { InstrumentModel } from 'argelander-core';
import type { DemoInstrument } from './tles.js';

import aviris3 from 'argelander-core/catalog/aviris-3.json';
import hytes from 'argelander-core/catalog/hytes.json';
import prism from 'argelander-core/catalog/prism.json';
import master from 'argelander-core/catalog/master.json';
import lvis from 'argelander-core/catalog/lvis.json';
import uavsarL from 'argelander-core/catalog/uavsar-lband.json';
import uavsarP from 'argelander-core/catalog/uavsar-pband.json';

function params(model: InstrumentModel): Record<string, unknown> {
  return model.params as Record<string, unknown>;
}

function num(model: InstrumentModel, key: string): number {
  const v = params(model)[key];
  if (typeof v !== 'number') throw new Error(`catalog model ${model.instrumentId} missing numeric ${key}`);
  return v;
}

/** The look side, guarded like num(): a bad or missing value is surfaced, not defaulted. */
function side(model: InstrumentModel): 'left' | 'right' {
  const s = params(model).side;
  if (s !== 'left' && s !== 'right') {
    throw new Error(`catalog model ${model.instrumentId} has an invalid look side ${String(s)}`);
  }
  return s;
}

/** A concise geometry summary for the layer label, from the family and params. */
function geometryLabel(model: InstrumentModel): string {
  switch (model.kind) {
    case 'pushbroom':
      return `${(2 * num(model, 'swathHalfWidthKm')).toFixed(0)} km pushbroom`;
    case 'whiskbroom':
      return `${(2 * num(model, 'swathHalfWidthKm')).toFixed(0)} km whiskbroom`;
    case 'stripmap-sar':
      return `${num(model, 'nearRangeKm').toFixed(0)}-${num(model, 'farRangeKm').toFixed(0)} km ${side(model)}-looking SAR`;
    default:
      return model.kind;
  }
}

/** Map a catalog InstrumentModel onto the demo's trackStrip posture. */
export function catalogInstrument(model: InstrumentModel, opts: { startOn?: boolean; short?: string } = {}): DemoInstrument {
  // Lead the label with a short identity, then the geometry, separated by a
  // colon like every other demo instrument label. The panel row ellipsizes, and
  // the swath or range is the part worth keeping visible, so it goes first.
  const base = {
    id: model.instrumentId,
    label: `${opts.short ?? model.name}: ${geometryLabel(model)}`,
    startOn: opts.startOn ?? false,
  };
  switch (model.kind) {
    case 'pushbroom':
    case 'whiskbroom':
      // The cited swath is the legible, honest geometry. A whiskbroom's real
      // footprint (single meters to tens of meters) is finer than a map pixel,
      // and its real scan rate (a few Hz to tens of Hz) is too dense to sweep at
      // pass cadence, so the demo draws the swath ribbon; the full scan mechanism
      // stays in the catalog data.
      return { ...base, swathHalfWidthKm: num(model, 'swathHalfWidthKm') };
    case 'stripmap-sar':
      return {
        ...base,
        offsetRangeKm: {
          nearKm: num(model, 'nearRangeKm'),
          farKm: num(model, 'farRangeKm'),
          side: side(model),
        },
      };
    default:
      throw new Error(`catalog demo does not map the ${model.kind} family`);
  }
}

const asModel = (m: unknown): InstrumentModel => m as unknown as InstrumentModel;

// The ER-2 spectrometer and scanner suite, all cited at a nominal 20 km
// altitude, and the UAVSAR radars cited at a nominal 13.8 km G-III altitude.
// The short labels stay under the platform group that already names UAVSAR.
export const CATALOG_AVIRIS3 = catalogInstrument(asModel(aviris3), { short: 'AVIRIS-3', startOn: true });
export const CATALOG_HYTES = catalogInstrument(asModel(hytes), { short: 'HyTES' });
export const CATALOG_PRISM = catalogInstrument(asModel(prism), { short: 'PRISM' });
export const CATALOG_MASTER = catalogInstrument(asModel(master), { short: 'MASTER' });
export const CATALOG_LVIS = catalogInstrument(asModel(lvis), { short: 'LVIS' });
export const CATALOG_UAVSAR_L = catalogInstrument(asModel(uavsarL), { short: 'L-band', startOn: true });
export const CATALOG_UAVSAR_P = catalogInstrument(asModel(uavsarP), { short: 'P-band' });
