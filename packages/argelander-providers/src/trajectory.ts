/**
 * Trajectory helpers shared by the pre-sampled-table providers (CZML,
 * GeoJSON): assemble a flat state array from position samples, deriving
 * velocity by weighted central differences on the non-uniform time grid,
 * one-sided at the ends. Rendering grade and exactly consistent with the
 * positions the table carries, so the same trajectory yields the same
 * velocity whichever format it arrived in.
 */

/**
 * Flat states (n blocks of x, y, z km then vx, vy, vz km/s) from n epochs and
 * n position triples. Velocity at an interior sample blends the backward and
 * forward slopes by the opposite intervals (the weighting that makes a
 * non-uniform central difference exact for a linear track); the ends take the
 * one-sided slope.
 */
export function statesFromPositions(epochs: Float64Array, positionsKm: Float64Array): Float64Array {
  const n = epochs.length;
  const states = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    states[i * 6 + 0] = positionsKm[i * 3 + 0]!;
    states[i * 6 + 1] = positionsKm[i * 3 + 1]!;
    states[i * 6 + 2] = positionsKm[i * 3 + 2]!;
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    for (let axis = 0; axis < 3; axis++) {
      let v: number;
      if (lo === i || hi === i) {
        v = (positionsKm[hi * 3 + axis]! - positionsKm[lo * 3 + axis]!) / (epochs[hi]! - epochs[lo]!);
      } else {
        const dtLo = epochs[i]! - epochs[lo]!;
        const dtHi = epochs[hi]! - epochs[i]!;
        const slopeLo = (positionsKm[i * 3 + axis]! - positionsKm[lo * 3 + axis]!) / dtLo;
        const slopeHi = (positionsKm[hi * 3 + axis]! - positionsKm[i * 3 + axis]!) / dtHi;
        v = (slopeLo * dtHi + slopeHi * dtLo) / (dtLo + dtHi);
      }
      states[i * 6 + 3 + axis] = v;
    }
  }
  return states;
}
