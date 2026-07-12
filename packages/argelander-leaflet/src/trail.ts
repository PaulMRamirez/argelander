/**
 * Trail decay (AGE-10): the persistent trail canvas fades by destination-out
 * fills whose per-frame alpha realizes an exponential decay with time
 * constant tauSec, the atlas fadeTrail behavior made continuous. Pure math
 * plus one canvas operation, both headless-testable.
 */
import type { Canvas2DLike } from './paint.js';

/** Destination-out alpha for a frame dtSec long under time constant tauSec. */
export function trailFadeAlpha(dtSec: number, tauSec: number): number {
  if (!(tauSec > 0)) return 1;
  return 1 - Math.exp(-Math.max(0, dtSec) / tauSec);
}

/** Fade the whole trail canvas one frame; composite mode is restored. */
export function applyTrailFade(ctx: Canvas2DLike, widthPx: number, heightPx: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0,0,0,${Math.min(1, alpha)})`;
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.restore();
}
