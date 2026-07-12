/**
 * demo-leaflet: live SGP4 footprints over open tiles (PHASE-1). States come
 * from the worker-hosted provider through the port seam, trackStrip turns
 * them into strips, and one AcquisitionLayer per satellite paints them; the
 * main thread only paints (AGE-05). Each satellite runs its own Et clock
 * from its element epoch, driven by a shared pass fraction. Respects
 * prefers-reduced-motion by starting paused on one rendered pass (AGE-16).
 */
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import { trackStrip, withStateRule } from 'argelander-core';
import type { Strip } from 'argelander-core';
import { AcquisitionLayer, TREATMENTS, TREATMENT_LABELS } from 'argelander-leaflet';
import type { Treatment } from 'argelander-leaflet';
import { parseTle, remoteStateProvider } from 'argelander-providers';
import type { StatePortLike } from 'argelander-providers';
import { createPanel } from './panel.js';
import type { DemoInstrument } from './tles.js';
import { DEMO_SATS, PASS_STEP_SEC, PASS_WINDOW_SEC } from './tles.js';

const EARTH_RADIUS_KM = 6371;

interface SatLayer {
  layer: AcquisitionLayer;
  epochEt: number;
  satName: string;
  instrument: DemoInstrument;
  /** Geometry with the state rule not yet applied; states re-emit per tick. */
  baseStrips: readonly Strip[];
}

// No attribution control on the map: the tile credit is a license
// obligation, so it moves into the config panel footer instead of
// overlaying map pixels (createPanel renders it per basemap).
const map = L.map('map', { worldCopyJump: true, zoomControl: true, attributionControl: false })
  .setView([25, 0], 2);

const baseMaps: Record<string, L.TileLayer> = {
  'Dark': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12 }),
  'Streets': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12 }),
  'Terrain': L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 12 }),
};
baseMaps['Dark']!.addTo(map);
// The dark ground is a CSS filter over the tile pane; it belongs to the
// Dark basemap only. The config panel owns basemap switching.
map.getContainer().classList.add('dark-tiles');

const legend = document.getElementById('legend')!;
const legendToggle = document.getElementById('legend-toggle')!;
legendToggle.addEventListener('click', () => {
  const min = legend.classList.toggle('min');
  legendToggle.textContent = min ? 'key' : 'hide';
});

const worker = new Worker(`./sgp4-worker.js?v=${__BUILD_ID__}`);
const provider = remoteStateProvider(worker as unknown as StatePortLike, 'sgp4');

const treatmentSelect = document.getElementById('treatment') as HTMLSelectElement;
const speedSelect = document.getElementById('speed') as HTMLSelectElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const clockLabel = document.getElementById('clock') as HTMLSpanElement;
const statusLabel = document.getElementById('status') as HTMLSpanElement;

for (const t of TREATMENTS) {
  const option = document.createElement('option');
  option.value = t;
  option.textContent = TREATMENT_LABELS[t];
  if (t === 'now-trail') option.selected = true;
  treatmentSelect.appendChild(option);
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let paused = reduceMotion;
let speed = 60;
let tauSec = reduceMotion ? PASS_WINDOW_SEC : 0;
const satLayers: SatLayer[] = [];

function currentTreatment(): Treatment {
  return treatmentSelect.value as Treatment;
}

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

async function start(): Promise<void> {
  statusLabel.textContent = 'propagating in the worker...';
  const failures: string[] = [];
  for (const sat of DEMO_SATS) {
    const epochEt = parseTle(sat.line1, sat.line2, sat.name).epochEt;
    // One platform, several instruments: every instrument samples the same
    // provider states, and each gets its own toggleable layer.
    for (const instrument of sat.instruments) {
      try {
        // One strip per tasked window, sharing the passId; gaps between
        // windows are real and never ribboned over (SPEC-STRIP section 2).
        const windows = instrument.taskWindowsSec ?? [[0, PASS_WINDOW_SEC] as const];
        const baseStrips: Strip[] = [];
        for (let w = 0; w < windows.length; w++) {
          const [fromSec, toSec] = windows[w]!;
          const batch = await provider.states({
            targets: [sat.name],
            observer: 'EARTH',
            frame: 'ITRF93',
            correction: 'NONE',
            epochs: { start: epochEt + fromSec, end: epochEt + toSec, step: PASS_STEP_SEC },
          });
          const common = {
            body: 'EARTH',
            bodyRadiusKm: EARTH_RADIUS_KM,
            instrumentId: `${sat.name}/${instrument.id}`,
            authority: provider.id,
            generatedBy: 'demo-leaflet',
            missionId: 'demo',
            passId: 'pass-0',
          } as const;
          if (instrument.bilateralKm) {
            // Two swaths sharing the passId, the bilateral decomposition.
            const { gapKm, outerKm } = instrument.bilateralKm;
            baseStrips.push(
              trackStrip(batch, 0, {
                ...common, id: `demo-${sat.name}-${instrument.id}-w${w}-left`,
                offsetRangeKm: { nearKm: gapKm, farKm: outerKm, side: 'left' },
              }),
              trackStrip(batch, 0, {
                ...common, id: `demo-${sat.name}-${instrument.id}-w${w}-right`,
                offsetRangeKm: { nearKm: gapKm, farKm: outerKm, side: 'right' },
              }),
            );
          } else {
            baseStrips.push(trackStrip(batch, 0, {
              ...common,
              id: `demo-${sat.name}-${instrument.id}-w${w}`,
              ...(instrument.swathHalfWidthKm !== undefined ? { swathHalfWidthKm: instrument.swathHalfWidthKm } : {}),
              ...(instrument.beadOffsetsKm !== undefined ? { beadOffsetsKm: instrument.beadOffsetsKm } : {}),
              ...(instrument.scan !== undefined ? { scan: instrument.scan } : {}),
              ...(instrument.offsetRangeKm !== undefined ? { offsetRangeKm: instrument.offsetRangeKm } : {}),
            }));
          }
        }
        const layer = new AcquisitionLayer(
          baseStrips.map((strip) => withStateRule(strip, epochEt + tauSec)),
          {
            treatment: currentTreatment(),
            paused,
            // Reveal the scan mechanism once footprints are legible, not at
            // the default threshold where they render as sub-pixel dots.
            mechanismMinWidthPx: 16,
          },
        );
        // Off-at-start instruments stay listed in the panel; their states
        // keep updating so enabling one lands on the current clock.
        if (instrument.startOn !== false) layer.addTo(map);
        satLayers.push({ layer, epochEt, satName: sat.name, instrument, baseStrips });
      } catch (err) {
        // One instrument failing must not take the constellation down.
        failures.push(`${sat.name}/${instrument.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  createPanel({
    map,
    baseMaps,
    entries: satLayers.map((s) => ({ satName: s.satName, instrument: s.instrument, layer: s.layer })),
    headerSelect: treatmentSelect,
    defaultTreatment: 'now-trail',
  });
  const names = satLayers.length
    ? `${DEMO_SATS.length} satellites, ${satLayers.length} instruments`
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
      // Clock first, then states: updateStates repaints the static
      // treatments, and its now marker must not lag the state front by a
      // segment (the SWOT field report).
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
