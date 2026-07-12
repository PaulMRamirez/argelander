/**
 * The Leaflet binding (ADR-0003, AGE-10, AGE-12 groundwork): one canvas
 * overlay per layer painting strips through the pure modules, plus the
 * persistent trail canvas with exponential decay for the now-trail
 * treatment. The projector handed to the painters is Leaflet's
 * latLngToContainerPoint, so whatever CRS the host map runs (MMGIS
 * configurations included) applies without this layer knowing. Animation is
 * pausable and speed-scalable (AGE-16); the clock arrives via setNow, the
 * MMGIS time UI binding being a later phase (AGE-13).
 */
import * as L from 'leaflet';
import type { Strip } from 'argelander-core';
import type { GeoStrip } from './geo.js';
import { stripToGeo } from './geo.js';
import type { PaintOptions, Projector, Treatment } from './paint.js';
import { paintNowLine, paintStrip, paintTrailWindow } from './paint.js';
import type { Palette } from './palette.js';
import { applyTrailFade, trailFadeAlpha } from './trail.js';

export interface AcquisitionLayerOptions {
  treatment?: Treatment;
  /** Explicit hue override (AGE-08). */
  palette?: Palette;
  /** Trail decay time constant, seconds of wall clock; default 4. */
  trailTauSec?: number;
  mechanismMinWidthPx?: number;
  /** Start paused (reduced-motion preference, AGE-16). */
  paused?: boolean;
  /** Engine seconds per wall second for the internal fade clock scaling. */
  speedScale?: number;
}

export class AcquisitionLayer extends L.Layer {
  private geoStrips: GeoStrip[];
  private treatment: Treatment;
  private readonly layerOptions: AcquisitionLayerOptions;
  private map: L.Map | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private trailCanvas: HTMLCanvasElement | undefined;
  private nowEtSec: number | undefined;
  private trailPaintedToEtSec = -Infinity;
  private paused: boolean;
  private speedScale: number;
  private rafHandle = 0;
  private lastFrameMs = 0;

  constructor(strips: readonly Strip[], options: AcquisitionLayerOptions = {}) {
    super();
    this.geoStrips = strips.map((s) => stripToGeo(s));
    this.treatment = options.treatment ?? 'flat-fill';
    this.layerOptions = options;
    this.paused = options.paused ?? false;
    this.speedScale = options.speedScale ?? 1;
  }

  override onAdd(map: L.Map): this {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
    this.trailCanvas = document.createElement('canvas');
    map.getPanes()['overlayPane']!.appendChild(this.canvas);
    map.on('moveend zoomend viewreset resize', this.handleViewChange, this);
    this.resetView();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off('moveend zoomend viewreset resize', this.handleViewChange, this);
    this.stopAnimation();
    this.canvas?.remove();
    this.map = undefined;
    this.canvas = undefined;
    this.trailCanvas = undefined;
    return this;
  }

  setStrips(strips: readonly Strip[]): void {
    this.geoStrips = strips.map((s) => stripToGeo(s));
    this.resetView();
  }

  setTreatment(treatment: Treatment): void {
    this.treatment = treatment;
    this.resetView();
  }

  /** Engine clock in Et seconds; drives now-trail and time-gradient. */
  setNow(etSec: number): void {
    this.nowEtSec = etSec;
    if (this.treatment === 'now-trail') this.drawNowFrame(0);
    else this.redrawStatic();
  }

  /** Pause and resume all animation (AGE-16). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stopAnimation();
    else if (this.treatment === 'now-trail') this.startAnimation();
  }

  setSpeedScale(scale: number): void {
    this.speedScale = scale;
  }

  private handleViewChange(): void {
    this.resetView();
  }

  /** Resize, reposition, rebuild the trail history, and repaint. */
  private resetView(): void {
    if (!this.map || !this.canvas || !this.trailCanvas) return;
    const size = this.map.getSize();
    this.canvas.width = size.x;
    this.canvas.height = size.y;
    this.trailCanvas.width = size.x;
    this.trailCanvas.height = size.y;
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
    if (this.treatment === 'now-trail') {
      this.trailPaintedToEtSec = -Infinity;
      this.drawNowFrame(0);
      if (!this.paused) this.startAnimation();
    } else {
      this.stopAnimation();
      this.redrawStatic();
    }
  }

  private projector(): Projector {
    const map = this.map!;
    return (p) => {
      const point = map.latLngToContainerPoint([p.latDeg, p.lonDeg]);
      return [point.x, point.y];
    };
  }

  private paintOptions(): PaintOptions {
    const options: PaintOptions = { treatment: this.treatment };
    if (this.nowEtSec !== undefined) options.nowEtSec = this.nowEtSec;
    if (this.layerOptions.palette) options.palette = this.layerOptions.palette;
    if (this.layerOptions.mechanismMinWidthPx !== undefined) {
      options.mechanismMinWidthPx = this.layerOptions.mechanismMinWidthPx;
    }
    return options;
  }

  private redrawStatic(): void {
    if (!this.map || !this.canvas) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const project = this.projector();
    const options = this.paintOptions();
    for (const geo of this.geoStrips) paintStrip(ctx, geo, project, options);
  }

  /** One now-trail frame: fade, extrude new coverage, composite, now line. */
  private drawNowFrame(dtSec: number): void {
    if (!this.map || !this.canvas || !this.trailCanvas) return;
    const trailCtx = this.trailCanvas.getContext('2d')!;
    const tau = this.layerOptions.trailTauSec ?? 4;
    applyTrailFade(trailCtx, this.trailCanvas.width, this.trailCanvas.height, trailFadeAlpha(dtSec, tau));
    const project = this.projector();
    const options = this.paintOptions();
    const now = this.nowEtSec ?? Infinity;
    if (now > this.trailPaintedToEtSec) {
      for (const geo of this.geoStrips) {
        paintTrailWindow(trailCtx, geo, project, options, this.trailPaintedToEtSec, now);
      }
      this.trailPaintedToEtSec = now;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.trailCanvas, 0, 0);
    for (const geo of this.geoStrips) paintNowLine(ctx, geo, project, options);
  }

  private startAnimation(): void {
    this.stopAnimation();
    this.lastFrameMs = performance.now();
    const frame = (nowMs: number): void => {
      const dtSec = ((nowMs - this.lastFrameMs) / 1000) * this.speedScale;
      this.lastFrameMs = nowMs;
      this.drawNowFrame(dtSec);
      this.rafHandle = requestAnimationFrame(frame);
    };
    this.rafHandle = requestAnimationFrame(frame);
  }

  private stopAnimation(): void {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }
}
