/**
 * demo-leaflet: live footprints over open tiles (PHASE-1). Earth states come
 * from the worker-hosted SGP4 provider through the port seam; the Moon and
 * Mars come from PresampledProvider tables, the planetary posture, and the
 * engine cannot tell the difference (AGE-05). trackStrip turns states into
 * strips and one AcquisitionLayer per instrument paints them. Each platform
 * runs its own Et clock from its epoch, driven by a shared pass fraction.
 * Worlds own their map: switching tears the Leaflet map down and rebuilds
 * it with the right CRS, because a Leaflet map cannot change CRS in place.
 * Respects prefers-reduced-motion by starting paused (AGE-16).
 */
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { trackStrip, withStateRule } from 'argelander-core';
import type { StateProvider, Strip } from 'argelander-core';
import { AcquisitionLayer } from 'argelander-leaflet';
import type { Treatment } from 'argelander-leaflet';
import { PresampledProvider, parseTle, remoteStateProvider } from 'argelander-providers';
import { createPanel } from './panel.js';
import type { WorldHost } from './panel.js';
import { sampleOrbit } from './orbits.js';
import type { DemoInstrument } from './tles.js';
import { DEMO_SATS, PASS_STEP_SEC, PASS_WINDOW_SEC } from './tles.js';
import { WORLDS, worldByKey } from './worlds.js';
import type { WorldSpec } from './worlds.js';

const EARTH_RADIUS_KM = 6371;

interface SatLayer {
  world: string;
  layer: AcquisitionLayer;
  epochEt: number;
  satName: string;
  instrument: DemoInstrument;
  /** Geometry with the state rule not yet applied; states re-emit per tick. */
  baseStrips: readonly Strip[];
}

function createMap(world: WorldSpec): L.Map {
  const map = world.epsg4326
    ? L.map('map', { crs: L.CRS.EPSG4326, zoomControl: true, attributionControl: false, minZoom: 1 })
    : L.map('map', { worldCopyJump: true, zoomControl: true, attributionControl: false });
  return map.setView([world.center[0], world.center[1]], world.zoom);
}

const satLayers: SatLayer[] = [];
let map = createMap(worldByKey('earth'));

// No attribution control on any map: the tile credit is a license
// obligation and renders in the config panel footer per basemap.
const host: WorldHost = {
  get map() {
    return map;
  },
  setWorld(key: string): void {
    for (const s of satLayers) {
      if (map.hasLayer(s.layer)) map.removeLayer(s.layer);
    }
    map.remove();
    map = createMap(worldByKey(key));
  },
};

// The opening basemap; the panel owns every later basemap change.
worldByKey('earth').bases[0]!.layer.addTo(map);
map.getContainer().classList.add('dark-tiles');

const legend = document.getElementById('legend')!;
const legendToggle = document.getElementById('legend-toggle')!;
legendToggle.addEventListener('click', () => {
  const min = legend.classList.toggle('min');
  legendToggle.textContent = min ? 'key' : 'hide';
});

const worker = new Worker(`./sgp4-worker.js?v=${__BUILD_ID__}`);
const earthProvider = remoteStateProvider(worker, 'sgp4');

const speedSelect = document.getElementById('speed') as HTMLSelectElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const clockLabel = document.getElementById('clock') as HTMLSpanElement;
const statusLabel = document.getElementById('status') as HTMLSpanElement;

// The header carries playback only; every treatment control (per-layer
// chips and the bulk macro) lives in the config panel.
const DEFAULT_TREATMENT: Treatment = 'now-trail';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let paused = reduceMotion;
let speed = 60;
let tauSec = reduceMotion ? PASS_WINDOW_SEC : 0;

function applyNow(): void {
  for (const s of satLayers) s.layer.setNow(s.epochEt + tauSec);
  const minutes = Math.floor(tauSec / 60);
  const seconds = Math.floor(tauSec % 60);
  clockLabel.textContent = `pass + ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Execute the plan: re-emit segment states for the current clock (AGE-13). */
function applyStates(): void {
  for (const s of satLayers) {
    s.layer.updateStates(s.baseStrips.map((strip) => withStateRule(strip, s.epochEt + tauSec)));
  }
}

/**
 * One instrument's strips for one pass: a states query per tasked window so
 * the gaps between windows are real (SPEC-STRIP section 2), the bilateral
 * pair decomposed into two strips sharing the passId.
 */
async function instrumentStrips(
  provider: StateProvider,
  target: string,
  satName: string,
  instrument: DemoInstrument,
  epochEt: number,
  geometry: { observer: string; frame: string; bodyRadiusKm: number },
): Promise<Strip[]> {
  const windows = instrument.taskWindowsSec ?? [[0, PASS_WINDOW_SEC] as const];
  const strips: Strip[] = [];
  for (let w = 0; w < windows.length; w++) {
    const [fromSec, toSec] = windows[w]!;
    const batch = await provider.states({
      targets: [target],
      observer: geometry.observer,
      frame: geometry.frame,
      correction: 'NONE',
      epochs: { start: epochEt + fromSec, end: epochEt + toSec, step: PASS_STEP_SEC },
    });
    const common = {
      body: geometry.observer,
      bodyRadiusKm: geometry.bodyRadiusKm,
      instrumentId: `${satName}/${instrument.id}`,
      authority: provider.id,
      generatedBy: 'demo-leaflet',
      missionId: 'demo',
      passId: 'pass-0',
    } as const;
    if (instrument.bilateralKm) {
      const { gapKm, outerKm } = instrument.bilateralKm;
      strips.push(
        trackStrip(batch, 0, {
          ...common, id: `demo-${satName}-${instrument.id}-w${w}-left`,
          offsetRangeKm: { nearKm: gapKm, farKm: outerKm, side: 'left' },
        }),
        trackStrip(batch, 0, {
          ...common, id: `demo-${satName}-${instrument.id}-w${w}-right`,
          offsetRangeKm: { nearKm: gapKm, farKm: outerKm, side: 'right' },
        }),
      );
    } else {
      strips.push(trackStrip(batch, 0, {
        ...common,
        id: `demo-${satName}-${instrument.id}-w${w}`,
        ...(instrument.swathHalfWidthKm !== undefined ? { swathHalfWidthKm: instrument.swathHalfWidthKm } : {}),
        ...(instrument.beadOffsetsKm !== undefined ? { beadOffsetsKm: instrument.beadOffsetsKm } : {}),
        ...(instrument.scan !== undefined ? { scan: instrument.scan } : {}),
        ...(instrument.offsetRangeKm !== undefined ? { offsetRangeKm: instrument.offsetRangeKm } : {}),
      }));
    }
  }
  return strips;
}

function registerLayer(world: string, satName: string, instrument: DemoInstrument, epochEt: number, baseStrips: readonly Strip[]): void {
  const layer = new AcquisitionLayer(
    baseStrips.map((strip) => withStateRule(strip, epochEt + tauSec)),
    {
      treatment: DEFAULT_TREATMENT,
      paused,
      // Reveal the scan mechanism once footprints are legible, not at
      // the default threshold where they render as sub-pixel dots.
      mechanismMinWidthPx: 16,
    },
  );
  // Only Earth layers land on the opening map; the panel reconciles the
  // active world's layers from then on. Off-at-start instruments stay
  // listed with their states updating, so enabling lands on the clock.
  if (world === 'earth' && instrument.startOn !== false) layer.addTo(map);
  satLayers.push({ world, layer, epochEt, satName, instrument, baseStrips });
}

async function start(): Promise<void> {
  statusLabel.textContent = 'propagating in the worker...';
  const failures: string[] = [];
  for (const sat of DEMO_SATS) {
    const epochEt = parseTle(sat.line1, sat.line2, sat.name).epochEt;
    // One platform, several instruments: every instrument samples the same
    // provider states, and each gets its own toggleable layer.
    for (const instrument of sat.instruments) {
      try {
        const baseStrips = await instrumentStrips(earthProvider, sat.name, sat.name, instrument, epochEt, {
          observer: 'EARTH', frame: 'ITRF93', bodyRadiusKm: EARTH_RADIUS_KM,
        });
        registerLayer('earth', sat.name, instrument, epochEt, baseStrips);
      } catch (err) {
        // One instrument failing must not take the constellation down.
        failures.push(`${sat.name}/${instrument.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // The planetary worlds: demonstration orbits sampled into tables and
  // served through the pre-sampled seam, epoch zero by convention.
  for (const world of WORLDS) {
    if (world.sats.length === 0) continue;
    const provider = new PresampledProvider(
      world.sats.map((s) => sampleOrbit(s.orbit, 0, PASS_WINDOW_SEC, PASS_STEP_SEC)),
      [],
      { id: `demo-presampled-${world.key}` },
    );
    for (const sat of world.sats) {
      for (const instrument of sat.instruments) {
        try {
          const baseStrips = await instrumentStrips(provider, sat.orbit.target, sat.name, instrument, 0, {
            observer: sat.orbit.body, frame: sat.orbit.frame, bodyRadiusKm: sat.orbit.bodyRadiusKm,
          });
          registerLayer(world.key, sat.name, instrument, 0, baseStrips);
        } catch (err) {
          failures.push(`${sat.name}/${instrument.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  createPanel({
    host,
    worlds: WORLDS,
    currentWorld: 'earth',
    entries: satLayers.map((s) => ({ world: s.world, satName: s.satName, instrument: s.instrument, layer: s.layer })),
    defaultTreatment: DEFAULT_TREATMENT,
  });
  const names = satLayers.length
    ? `${new Set(satLayers.map((s) => s.satName)).size} satellites, ${satLayers.length} instruments, 3 worlds`
    : 'no instruments loaded';
  const failed = failures.length ? `  |  failed: ${failures.join('; ')}` : '';
  statusLabel.textContent = `${names}  |  simulated plan: the clock executes it (amber ahead, teal behind)  |  zoom in for the scan mechanism${failed}`;
  applyNow();

  let lastMs = performance.now();
  let lastStateTick = -1;
  const tick = (nowMs: number): void => {
    const dt = (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    if (!paused) {
      tauSec = (tauSec + dt * speed) % PASS_WINDOW_SEC;
      applyNow();
      const stateTick = Math.floor(tauSec / PASS_STEP_SEC);
      if (stateTick !== lastStateTick) {
        lastStateTick = stateTick;
        applyStates();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

speedSelect.addEventListener('change', () => {
  speed = Number(speedSelect.value);
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? 'play' : 'pause';
  for (const s of satLayers) s.layer.setPaused(paused);
});
if (paused) pauseButton.textContent = 'play';

start().catch((err: unknown) => {
  statusLabel.textContent = `failed: ${err instanceof Error ? err.message : String(err)}`;
});
