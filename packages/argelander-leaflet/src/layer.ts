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
import { nowMarkerIndex, paintGuide, paintNowLine, paintStrip, paintTrailWindow } from './paint.js';
import type { Palette } from './palette.js';
import { applyTrailFade, trailFadeAlpha } from './trail.js';

export interface AcquisitionLayerOptions {
  treatment?: Treatment;
  /** Explicit hue override (AGE-08). */
  palette?: Palette;
  /** Trail decay time constant, seconds of wall clock; default 15. */
  trailTauSec?: number;
  mechanismMinWidthPx?: number;
  /** Start paused (reduced-motion preference, AGE-16). */
  paused?: boolean;
  /** Engine seconds per wall second for the internal fade clock scaling. */
  speedScale?: number;
  /** Constant fill alpha for the fill treatments; default 0.35. */
  fillAlpha?: number;
  /** Envelope stroke width, pixels; default 1.5. */
  lineWidthPx?: number;
}

export class AcquisitionLayer extends L.Layer {
  private geoStrips: GeoStrip[];
  private treatment: Treatment;
  private readonly layerOptions: AcquisitionLayerOptions;
  private map: L.Map | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private trailCanvas: HTMLCanvasElement | undefined;
  private nowEtSec: number | undefined;
  private lastNowKey = '';
  private trailPaintedToEtSec = -Infinity;
  private paused: boolean;
  private speedScale: number;
  private rafHandle = 0;
  private lastFrameMs = 0;

  constructor(strips: readonly Strip[], options: AcquisitionLayerOptions = {}) {
    super();
    this.geoStrips = strips.map((s) => stripToGeo(s));
    this.treatment = options.treatment ?? 'flat-fill';
    // Copied so runtime setters never mutate the caller's object.
    this.layerOptions = { ...options };
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
    // 'move' and 'zoom' fire through drags and zoom animation, so the layer
    // repaints live instead of snapping into place at moveend.
    map.on('move zoom moveend zoomend viewreset resize', this.handleViewChange, this);
    this.resetView();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off('move zoom moveend zoomend viewreset resize', this.handleViewChange, this);
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

  /**
   * Replace strips whose geometry is unchanged, the evolving-state-rule case
   * (core withStateRule on an engine clock): no view reset, the trail keeps
   * its history, and static treatments repaint with the new states.
   */
  updateStates(strips: readonly Strip[]): void {
    this.geoStrips = strips.map((s) => stripToGeo(s));
    if (!this.map) return;
    if (this.treatment !== 'now-trail') this.redrawStatic();
  }

  setTreatment(treatment: Treatment): void {
    this.treatment = treatment;
    this.resetView();
  }

  /** Engine clock in Et seconds; drives the trail and the now marker. */
  setNow(etSec: number): void {
    this.nowEtSec = etSec;
    if (!this.map) return;
    if (this.treatment === 'now-trail') {
      this.drawNowFrame(0);
      return;
    }
    // Every static treatment carries exactly one clock-dependent element,
    // the now marker, which quantizes to segment boundaries; repaint only
    // when it would visibly move (AGE-16). Driving setNow alone therefore
    // keeps the marker honest without a per-frame full repaint.
    const key = this.geoStrips.map((g) => nowMarkerIndex(g, etSec)).join(',');
    if (key !== this.lastNowKey) this.redrawStatic();
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

  /** Runtime LOD threshold: when the mechanism grade reveals (AGE-09). */
  setMechanismMinWidthPx(px: number): void {
    this.layerOptions.mechanismMinWidthPx = px;
    this.resetView();
  }

  /** Swap the state hues at runtime, the explicit AGE-08 override. */
  setPalette(palette: Palette): void {
    this.layerOptions.palette = palette;
    this.resetView();
  }

  /** Trail decay time constant, seconds of wall clock; takes effect next frame. */
  setTrailTau(sec: number): void {
    this.layerOptions.trailTauSec = sec;
  }

  private handleViewChange(): void {
    this.resetView();
  }

  /** Resize, reposition, rebuild the trail history, and repaint. */
  private resetView(): void {
    if (!this.map || !this.canvas || !this.trailCanvas) return;
    const size = this.map.getSize();
    if (this.canvas.width !== size.x || this.canvas.height !== size.y) {
      this.canvas.width = size.x;
      this.canvas.height = size.y;
      this.trailCanvas.width = size.x;
      this.trailCanvas.height = size.y;
    }
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
    if (this.treatment === 'now-trail') {
      // The trail pixels live in container space, so any view change
      // invalidates them: clear before rebuilding or successive projections
      // smear stale copies across the canvas.
      const trailCtx = this.trailCanvas.getContext('2d')!;
      trailCtx.clearRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
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

  /**
   * World-copy longitude offsets the current view can see. Leaflet keeps
   * canonical longitudes in [-180, 180]; a view straddling the antimeridian
   * (or wider than the world) needs point features re-painted a world away.
   */
  private worldCopies(): readonly number[] {
    if (!this.map) return [0];
    const bounds = this.map.getBounds();
    const copies = [0];
    if (bounds.getEast() > 180) copies.push(360);
    if (bounds.getWest() < -180) copies.push(-360);
    return copies;
  }

  private paintOptions(): PaintOptions {
    const options: PaintOptions = { treatment: this.treatment, worldCopies: this.worldCopies() };
    if (this.nowEtSec !== undefined) options.nowEtSec = this.nowEtSec;
    if (this.layerOptions.palette) options.palette = this.layerOptions.palette;
    if (this.layerOptions.mechanismMinWidthPx !== undefined) {
      options.mechanismMinWidthPx = this.layerOptions.mechanismMinWidthPx;
    }
    if (this.layerOptions.fillAlpha !== undefined) options.fillAlpha = this.layerOptions.fillAlpha;
    if (this.layerOptions.lineWidthPx !== undefined) options.lineWidthPx = this.layerOptions.lineWidthPx;
    return options;
  }

  private redrawStatic(): void {
    if (!this.map || !this.canvas) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const project = this.projector();
    const options = this.paintOptions();
    for (const geo of this.geoStrips) paintStrip(ctx, geo, project, options);
    // Every atlas treatment carries the bright now overlay, not just the
    // trail. The key records what this repaint showed, so setNow can skip
    // repaints that would not move the marker, whoever triggered this one.
    if (this.nowEtSec !== undefined) {
      const now = this.nowEtSec;
      this.lastNowKey = this.geoStrips.map((g) => nowMarkerIndex(g, now)).join(',');
      for (const geo of this.geoStrips) paintNowLine(ctx, geo, project, options);
    }
  }

  /** One now-trail frame: fade, extrude new coverage, composite, now line. */
  private drawNowFrame(dtSec: number): void {
    if (!this.map || !this.canvas || !this.trailCanvas) return;
    const trailCtx = this.trailCanvas.getContext('2d')!;
    // No clock yet means no coverage swept yet, not all of it.
    const now = this.nowEtSec ?? -Infinity;
    if (now < this.trailPaintedToEtSec) {
      // The clock ran backward (a scrub or a looping pass): rebuild the trail.
      trailCtx.clearRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
      this.trailPaintedToEtSec = -Infinity;
    }
    const tau = this.layerOptions.trailTauSec ?? 15;
    applyTrailFade(trailCtx, this.trailCanvas.width, this.trailCanvas.height, trailFadeAlpha(dtSec, tau));
    const project = this.projector();
    const options = this.paintOptions();
    if (now > this.trailPaintedToEtSec) {
      for (const geo of this.geoStrips) {
        paintTrailWindow(trailCtx, geo, project, options, this.trailPaintedToEtSec, now);
      }
      this.trailPaintedToEtSec = now;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const geo of this.geoStrips) paintGuide(ctx, geo, project, options);
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
