/**
 * Rendering-grade TEME to earth-fixed rotation (ADR-0008): the IAU 1982 GMST
 * spin about Z only. Equation of the equinoxes, polar motion, and UT1-UTC are
 * neglected; the bound is a few hundred meters at the surface, far inside
 * rendering-grade footprint widths. Analysis-grade frames stay delegated.
 */

/** Earth rotation rate, rad/s (Vallado, zero length-of-day correction). */
export const EARTH_ROTATION_RAD_S = 7.29211514670698e-5;

export const SPEED_OF_LIGHT_KM_S = 299792.458;

/**
 * Rotate one 6-double state block in place from TEME to the earth-fixed
 * frame at the given GMST: position by ROT3(gmst), velocity likewise minus
 * the omega cross r transport term.
 */
export function temeToEarthFixedInto(states: Float64Array, offset: number, gmst: number): void {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const x = states[offset]!;
  const y = states[offset + 1]!;
  const vx = states[offset + 3]!;
  const vy = states[offset + 4]!;
  const rx = c * x + s * y;
  const ry = -s * x + c * y;
  states[offset] = rx;
  states[offset + 1] = ry;
  states[offset + 3] = c * vx + s * vy + EARTH_ROTATION_RAD_S * ry;
  states[offset + 4] = -s * vx + c * vy - EARTH_ROTATION_RAD_S * rx;
}

/**
 * Write the SPICE scalar-first quaternion of ROT3(theta) at out[offset]:
 * the rotation taking vectors expressed in the inertial-side frame into the
 * frame spun by theta about Z. For theta = GMST this is TEME into the
 * rendering-grade earth-fixed frame.
 */
export function rotZQuatInto(quats: Float64Array, offset: number, theta: number): void {
  quats[offset] = Math.cos(theta / 2);
  quats[offset + 1] = 0;
  quats[offset + 2] = 0;
  quats[offset + 3] = Math.sin(theta / 2);
}
