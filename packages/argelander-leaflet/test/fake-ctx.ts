/**
 * Recording 2D context and fixture plumbing for the headless painter tests.
 * The recorder captures each fill and stroke with the path and style in
 * force, which is enough to assert shapes, counts, hues, and alphas without
 * a DOM. Fixtures come straight from the argelander-core corpus, so the 21
 * families exercise the adapter the moment their samplers land.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Strip, Vec3 } from 'argelander-core';
import type { Canvas2DLike, Projector } from '../src/paint.js';
import type { GeoPoint } from '../src/geo.js';

const require = createRequire(import.meta.url);

export function fixtureStrip(family: string): Strip {
  const path = require.resolve(`argelander-core/fixtures/strips/${family}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Strip;
}

/** Body-fixed vector from geographic coordinates, for synthetic strips. */
export function fromGeo(latDeg: number, lonDeg: number, radiusKm: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return [
    radiusKm * Math.cos(lat) * Math.cos(lon),
    radiusKm * Math.cos(lat) * Math.sin(lon),
    radiusKm * Math.sin(lat),
  ];
}

/**
 * Synthetic east-west-edged strip; each row is latDeg, lonDeg, half-width
 * in degrees of longitude, etSec.
 */
export function syntheticStrip(points: ReadonlyArray<readonly [number, number, number, number]>): Strip {
  return {
    id: 'synthetic',
    body: 'EARTH',
    frame: 'ITRF93',
    instrumentId: 'synthetic',
    segments: points.map(([lat, lon, halfLon, et]) => ({
      etSec: et,
      left: fromGeo(lat, lon - halfLon, 6371),
      right: fromGeo(lat, lon + halfLon, 6371),
      state: 'committed' as const,
    })),
    provenance: { authority: 'test', generatedBy: 'test' },
  };
}

export interface PaintOp {
  op: 'fill' | 'stroke' | 'fillRect';
  path: ReadonlyArray<readonly [number, number]>;
  shape: 'path' | 'arc' | 'ellipse' | 'rect';
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  dash: readonly number[];
  composite: string;
}

export class FakeCtx implements Canvas2DLike {
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  lineWidth = 1;
  globalCompositeOperation: unknown = 'source-over';
  shadowColor: unknown = 'rgba(0,0,0,0)';
  shadowBlur = 0;
  readonly ops: PaintOp[] = [];
  readonly dashCalls: Array<readonly number[]> = [];
  private path: Array<readonly [number, number]> = [];
  private shape: PaintOp['shape'] = 'path';
  private dash: readonly number[] = [];
  private readonly stack: Array<{ composite: unknown; dash: readonly number[] }> = [];

  save(): void {
    this.stack.push({ composite: this.globalCompositeOperation, dash: this.dash });
  }

  restore(): void {
    const top = this.stack.pop();
    if (top) {
      this.globalCompositeOperation = top.composite;
      this.dash = top.dash;
    }
    this.shadowBlur = 0;
  }

  beginPath(): void {
    this.path = [];
    this.shape = 'path';
  }

  moveTo(x: number, y: number): void {
    this.path.push([x, y]);
  }

  lineTo(x: number, y: number): void {
    this.path.push([x, y]);
  }

  closePath(): void {}

  arc(x: number, y: number, r: number, _a0: number, _a1: number): void {
    this.path.push([x, y], [x + r, y]);
    this.shape = 'arc';
  }

  ellipse(x: number, y: number, rx: number, ry: number, _rot: number, _a0: number, _a1: number): void {
    this.path.push([x, y], [x + rx, y + ry]);
    this.shape = 'ellipse';
  }

  setLineDash(pattern: readonly number[]): void {
    this.dash = pattern;
    this.dashCalls.push(pattern);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', [[x, y], [x + w, y + h]], 'rect');
  }

  createLinearGradient(_x0: number, _y0: number, _x1: number, _y1: number): {
    addColorStop(offset: number, color: string): void;
  } {
    const stops: string[] = [];
    const gradient = {
      addColorStop: (offset: number, color: string): void => {
        stops.push(`${offset}:${color}`);
      },
      toString: (): string => `lgrad(${stops.join(';')})`,
    };
    return gradient;
  }

  fill(): void {
    this.record('fill', [...this.path], this.shape);
  }

  stroke(): void {
    this.record('stroke', [...this.path], this.shape);
  }

  private record(op: PaintOp['op'], path: PaintOp['path'], shape: PaintOp['shape']): void {
    this.ops.push({
      op,
      path,
      shape,
      fillStyle: String(this.fillStyle),
      strokeStyle: String(this.strokeStyle),
      lineWidth: this.lineWidth,
      dash: this.dash,
      composite: String(this.globalCompositeOperation),
    });
  }

  fills(): PaintOp[] {
    return this.ops.filter((o) => o.op === 'fill' && o.shape === 'path');
  }

  dots(): PaintOp[] {
    return this.ops.filter((o) => o.op === 'fill' && o.shape === 'arc');
  }

  ellipses(): PaintOp[] {
    return this.ops.filter((o) => o.shape === 'ellipse');
  }

  strokes(): PaintOp[] {
    return this.ops.filter((o) => o.op === 'stroke');
  }
}

/** Equirectangular test projector at a chosen pixel-per-degree scale. */
export function makeProjector(pxPerDeg: number): Projector {
  return (p: GeoPoint) => [(p.lonDeg + 180) * pxPerDeg, (90 - p.latDeg) * pxPerDeg];
}

/** Alpha of an rgba() string, for gradient assertions. */
export function alphaOf(style: string): number {
  const m = /rgba\(\d+,\d+,\d+,([\d.]+)\)/.exec(style);
  if (!m) throw new Error(`not an rgba() style: ${style}`);
  return Number(m[1]);
}

/** True when the rgb triple of the style matches the hex color. */
export function sameHue(style: string, hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return style.startsWith(`rgba(${r},${g},${b},`) || style === hex;
}
