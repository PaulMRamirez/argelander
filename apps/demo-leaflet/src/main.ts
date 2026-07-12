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
import { trackStrip } from 'argelander-core';
import { AcquisitionLayer, TREATMENTS } from 'argelander-leaflet';
import type { Treatment } from 'argelander-leaflet';
import { parseTle, remoteStateProvider } from 'argelander-providers';
import type { StatePortLike } from 'argelander-providers';
import { DEMO_SATS, PASS_STEP_SEC, PASS_WINDOW_SEC } from './tles.js';

const EARTH_RADIUS_KM = 6371;

interface SatLayer {
  layer: AcquisitionLayer;
  epochEt: number;
}

const map = L.map('map', { worldCopyJump: true, zoomControl: true }).setView([25, 0], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 12,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const worker = new Worker('./sgp4-worker.js');
const provider = remoteStateProvider(worker as unknown as StatePortLike, 'sgp4');

const treatmentSelect = document.getElementById('treatment') as HTMLSelectElement;
const speedSelect = document.getElementById('speed') as HTMLSelectElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const clockLabel = document.getElementById('clock') as HTMLSpanElement;
const statusLabel = document.getElementById('status') as HTMLSpanElement;

for (const t of TREATMENTS) {
  const option = document.createElement('option');
  option.value = t;
  option.textContent = t;
  if (t === 'mechanism') option.selected = true;
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

async function start(): Promise<void> {
  statusLabel.textContent = 'propagating in the worker...';
  for (const sat of DEMO_SATS) {
    const epochEt = parseTle(sat.line1, sat.line2, sat.name).epochEt;
    const batch = await provider.states({
      targets: [sat.name],
      observer: 'EARTH',
      frame: 'ITRF93',
      correction: 'NONE',
      epochs: { start: epochEt, end: epochEt + PASS_WINDOW_SEC, step: PASS_STEP_SEC },
    });
    const strip = trackStrip(batch, 0, {
      id: `demo-${sat.name}`,
      body: 'EARTH',
      bodyRadiusKm: EARTH_RADIUS_KM,
      instrumentId: sat.name,
      authority: provider.id,
      generatedBy: 'demo-leaflet',
      missionId: 'demo',
      passId: 'pass-0',
      ...(sat.swathHalfWidthKm !== undefined ? { swathHalfWidthKm: sat.swathHalfWidthKm } : {}),
      ...(sat.beadOffsetsKm !== undefined ? { beadOffsetsKm: sat.beadOffsetsKm } : {}),
      ...(sat.scan !== undefined ? { scan: sat.scan } : {}),
    });
    const layer = new AcquisitionLayer([strip], {
      treatment: currentTreatment(),
      paused,
      // Reveal the scan mechanism once footprints are legible, not at the
      // default threshold where they render as sub-pixel dots.
      mechanismMinWidthPx: 16,
    });
    layer.addTo(map);
    satLayers.push({ layer, epochEt });
  }
  statusLabel.textContent = `${DEMO_SATS.map((s) => s.label).join('  |  ')}  |  zoom in over a swath to reveal the scan mechanism`;
  applyNow();

  let lastMs = performance.now();
  const tick = (nowMs: number): void => {
    const dt = (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    if (!paused) {
      tauSec = (tauSec + dt * speed) % PASS_WINDOW_SEC;
      applyNow();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

treatmentSelect.addEventListener('change', () => {
  for (const s of satLayers) s.layer.setTreatment(currentTreatment());
  applyNow();
});
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
