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
import { passStrips, withStateRule } from 'argelander-core';
import type { StateProvider, Strip } from 'argelander-core';
import { AcquisitionClock, AcquisitionLayer } from 'argelander-leaflet';
import type { Treatment } from 'argelander-leaflet';
import { PresampledProvider, connectSgp4Worker, geoJsonStateProvider, parseTle } from 'argelander-providers';
import { createPanel } from './panel.js';
import type { WorldHost } from './panel.js';
import { sampleOrbit } from './orbits.js';
import { AIRBORNE_PLATFORMS, sampleFlightLine } from './flightlines.js';
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

const speedSelect = document.getElementById('speed') as HTMLSelectElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const clockLabel = document.getElementById('clock') as HTMLSpanElement;
const statusLabel = document.getElementById('status') as HTMLSpanElement;

// The header carries playback only; every treatment control (per-layer
// chips and the bulk macro) lives in the config panel.
const DEFAULT_TREATMENT: Treatment = 'now-trail';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let isPaused = reduceMotion;
let clock: AcquisitionClock | undefined;

function labelTick(tauSec: number): void {
  const minutes = Math.floor(tauSec / 60);
  const seconds = Math.floor(tauSec % 60);
  clockLabel.textContent = `pass + ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Windows for passStrips: the instrument's tasked spans, absolute Et. */
function windowsFor(instrument: DemoInstrument, epochEt: number): Array<readonly [number, number]> {
  const relative = instrument.taskWindowsSec ?? [[0, PASS_WINDOW_SEC] as const];
  return relative.map(([fromSec, toSec]) => [epochEt + fromSec, epochEt + toSec] as const);
}

function postureOf(instrument: DemoInstrument): Record<string, unknown> {
  return {
    ...(instrument.swathHalfWidthKm !== undefined ? { swathHalfWidthKm: instrument.swathHalfWidthKm } : {}),
    ...(instrument.beadOffsetsKm !== undefined ? { beadOffsetsKm: instrument.beadOffsetsKm } : {}),
    ...(instrument.scan !== undefined ? { scan: instrument.scan } : {}),
    ...(instrument.stepScan !== undefined ? { stepScan: instrument.stepScan } : {}),
    ...(instrument.conical !== undefined ? { conical: instrument.conical } : {}),
    ...(instrument.subSwaths !== undefined ? { subSwaths: instrument.subSwaths } : {}),
    ...(instrument.looks !== undefined ? { looks: instrument.looks } : {}),
    ...(instrument.offsetRangeKm !== undefined ? { offsetRangeKm: instrument.offsetRangeKm } : {}),
    ...(instrument.bilateralKm !== undefined ? { bilateralKm: instrument.bilateralKm } : {}),
  };
}

async function instrumentStrips(
  provider: StateProvider,
  target: string,
  satName: string,
  instrument: DemoInstrument,
  epochEt: number,
  geometry: { observer: string; frame: string; bodyRadiusKm: number },
): Promise<Strip[]> {
  return passStrips(provider, {
    target,
    observer: geometry.observer,
    frame: geometry.frame,
    bodyRadiusKm: geometry.bodyRadiusKm,
    instrumentId: `${satName}/${instrument.id}`,
    generatedBy: 'demo-leaflet',
    missionId: 'demo',
    idPrefix: `demo-${satName}-${instrument.id}`,
    windows: windowsFor(instrument, epochEt),
    stepSec: PASS_STEP_SEC,
    ...postureOf(instrument),
  });
}

function registerLayer(world: string, satName: string, instrument: DemoInstrument, epochEt: number, baseStrips: readonly Strip[]): void {
  const layer = new AcquisitionLayer(
    baseStrips.map((strip) => withStateRule(strip, epochEt)),
    {
      treatment: DEFAULT_TREATMENT,
      paused: isPaused,
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
  // Earth's whole path is isolated: if the worker fails to connect (a bad
  // TLE, a missing worker file), the planetary worlds, which never touch
  // the worker, still come up. One failing world must not lose the others.
  try {
    // The worker file is one import of the shipped entry; the TLEs travel in
    // the init message and connect resolves after the ready handshake.
    const earthProvider = await connectSgp4Worker(
      worker,
      DEMO_SATS.map((s) => ({ line1: s.line1, line2: s.line2, name: s.name })),
    );
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
  } catch (err) {
    failures.push(`earth: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The planetary worlds: demonstration orbits sampled into tables and
  // served through the pre-sampled seam, epoch zero by convention. One bad
  // world spec must not take the healthy worlds down, so table sampling
  // and provider construction sit inside the same isolation as queries.
  for (const world of WORLDS) {
    if (world.sats.length === 0) continue;
    let provider: PresampledProvider;
    try {
      provider = new PresampledProvider(
        world.sats.map((s) => sampleOrbit(s.orbit, 0, PASS_WINDOW_SEC, PASS_STEP_SEC)),
        { id: `demo-presampled-${world.key}` },
      );
    } catch (err) {
      failures.push(`${world.key}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
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

  // Airborne platforms on Earth: a flight line sampled into a body-fixed state
  // table and served through the same pre-sampled seam as the planetary orbits,
  // so a non-satellite platform renders footprint strips through the identical
  // trackStrip pipeline (PHASE-4). Isolated like the other providers: one bad
  // line must not lose the constellation.
  for (const platform of AIRBORNE_PLATFORMS) {
    const id = `demo-airborne-${platform.name}`;
    const sampler = (): PresampledProvider =>
      new PresampledProvider([sampleFlightLine(platform.line, 0, PASS_WINDOW_SEC, PASS_STEP_SEC)], { id });
    let provider: PresampledProvider;
    try {
      // Prefer the Enhanced GeoJSON track through the state provider (proving
      // the inbound-state path); fall back to the in-code sampler if the
      // GeoJSON is absent or fails to parse, so one bad track never grounds it.
      if (platform.trackGeoJson) {
        try {
          provider = geoJsonStateProvider(platform.trackGeoJson, {
            observer: platform.line.body, frame: platform.line.frame, bodyRadiusKm: platform.line.bodyRadiusKm,
          }, { id });
        } catch (err) {
          failures.push(`${platform.name} geojson track, using sampler: ${err instanceof Error ? err.message : String(err)}`);
          provider = sampler();
        }
      } else {
        provider = sampler();
      }
    } catch (err) {
      failures.push(`${platform.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const instrument of platform.instruments) {
      try {
        const baseStrips = await instrumentStrips(provider, platform.line.target, platform.name, instrument, 0, {
          observer: platform.line.body, frame: platform.line.frame, bodyRadiusKm: platform.line.bodyRadiusKm,
        });
        registerLayer('earth', platform.name, instrument, 0, baseStrips);
      } catch (err) {
        failures.push(`${platform.name}/${instrument.id}: ${err instanceof Error ? err.message : String(err)}`);
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
    ? `${new Set(satLayers.map((s) => s.satName)).size} platforms, ${satLayers.length} instruments, ${new Set(satLayers.map((s) => s.world)).size} worlds`
    : 'no instruments loaded';
  const failed = failures.length ? `  |  failed: ${failures.join('; ')}` : '';
  // The color meaning lives in the legend; the status keeps the volatile
  // counts and the one durable hint a newcomer needs to find the detail.
  statusLabel.textContent = `${names}  |  a simulated acquisition plan the clock plays forward: zoom in and switch a layer to MECHANISM TEXTURE to see the scan${failed}`;

  // The promoted loop: setNow per frame, boundary-gated updateStates
  // through withStateRule, clock before states (AGE-13, AGE-16).
  clock = new AcquisitionClock(
    satLayers.map((s) => ({ layer: s.layer, epochEt: s.epochEt, baseStrips: s.baseStrips })),
    { windowSec: PASS_WINDOW_SEC, stepSec: PASS_STEP_SEC, speed: Number(speedSelect.value), paused: isPaused, onTick: labelTick },
  );
  // Reduced motion opens on a nearly complete pass instead of an empty one.
  if (reduceMotion) clock.seek(PASS_WINDOW_SEC - PASS_STEP_SEC / 2);
}

speedSelect.addEventListener('change', () => {
  clock?.setSpeed(Number(speedSelect.value));
});
pauseButton.addEventListener('click', () => {
  isPaused = !isPaused;
  pauseButton.textContent = isPaused ? 'play' : 'pause';
  clock?.setPaused(isPaused);
});
if (isPaused) pauseButton.textContent = 'play';

start().catch((err: unknown) => {
  statusLabel.textContent = `failed: ${err instanceof Error ? err.message : String(err)}`;
});
