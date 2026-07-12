/**
 * SGP4 near-earth propagator, the Vallado formulation with WGS-72 constants,
 * living below the SPEC-PROVIDER seam (ADR-0008). Output states are TEME
 * kilometers and kilometers per second, written straight into the flat batch
 * layout. Deep-space elements (period of 225 minutes or longer) refuse at
 * initialization; SDP4 is a recorded deferral. Verified against the published
 * "Revisiting Spacetrack Report #3" corpus in test/sgp4.test.ts.
 */
import type { Tle } from './tle.js';

export const WGS72_MU_KM3_S2 = 398600.8;
export const WGS72_RADIUS_KM = 6378.135;
const J2 = 0.001082616;
const J3 = -0.00000253881;
const J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
/** Vallado xke: 60 / sqrt(Re^3 / mu), the mean motion unit bridge. */
const XKE = 60.0 / Math.sqrt((WGS72_RADIUS_KM * WGS72_RADIUS_KM * WGS72_RADIUS_KM) / WGS72_MU_KM3_S2);
const X2O3 = 2.0 / 3.0;
const TWO_PI = 2.0 * Math.PI;
const VKMPERSEC = (WGS72_RADIUS_KM * XKE) / 60.0;

export class DeepSpaceUnsupportedError extends Error {
  readonly satnum: string;
  readonly periodMin: number;

  constructor(satnum: string, periodMin: number) {
    super(`TLE ${satnum} has a ${periodMin.toFixed(1)} min period; deep-space elements (225 min or longer, SDP4) are not supported (ADR-0008)`);
    this.name = 'DeepSpaceUnsupportedError';
    this.satnum = satnum;
    this.periodMin = periodMin;
  }
}

/** Vallado error codes kept: 1 eccentricity out of range, 2 mean motion, 4 semi-latus rectum, 6 decay. */
export class Sgp4PropagationError extends Error {
  readonly code: 1 | 2 | 4 | 6;
  readonly satnum: string;
  readonly tsinceMin: number;

  constructor(code: 1 | 2 | 4 | 6, satnum: string, tsinceMin: number, detail: string) {
    super(`SGP4 error ${code} for ${satnum} at ${tsinceMin.toFixed(3)} min from epoch: ${detail}`);
    this.name = 'Sgp4PropagationError';
    this.code = code;
    this.satnum = satnum;
    this.tsinceMin = tsinceMin;
  }
}

/** Initialized near-earth element set; all fields are propagation constants. */
export interface Sgp4Satrec {
  readonly satnum: string;
  readonly epochEt: number;
  readonly isimp: boolean;
  readonly bstar: number;
  readonly ecco: number;
  readonly inclo: number;
  readonly nodeo: number;
  readonly argpo: number;
  readonly mo: number;
  readonly noUnkozai: number;
  readonly sinio: number;
  readonly cosio: number;
  readonly con41: number;
  readonly x1mth2: number;
  readonly x7thm1: number;
  readonly mdot: number;
  readonly argpdot: number;
  readonly nodedot: number;
  readonly nodecf: number;
  readonly cc1: number;
  readonly cc4: number;
  readonly cc5: number;
  readonly omgcof: number;
  readonly xmcof: number;
  readonly eta: number;
  readonly delmo: number;
  readonly sinmao: number;
  readonly aycof: number;
  readonly xlcof: number;
  readonly t2cof: number;
  readonly d2: number;
  readonly d3: number;
  readonly d4: number;
  readonly t3cof: number;
  readonly t4cof: number;
  readonly t5cof: number;
}

export function sgp4Init(tle: Tle): Sgp4Satrec {
  const { ecc: ecco, inclRad: inclo, raanRad: nodeo, argpRad: argpo, meanAnomalyRad: mo, bstar } = tle;
  const noKozai = tle.meanMotionRadPerMin;

  const eccsq = ecco * ecco;
  const omeosq = 1.0 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(inclo);
  const sinio = Math.sin(inclo);
  const cosio2 = cosio * cosio;

  const ak = (XKE / noKozai) ** X2O3;
  const d1 = (0.75 * J2 * (3.0 * cosio2 - 1.0)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1.0 - del * del - del * (1.0 / 3.0 + (134.0 * del * del) / 81.0));
  del = d1 / (adel * adel);
  const noUnkozai = noKozai / (1.0 + del);

  const periodMin = TWO_PI / noUnkozai;
  if (periodMin >= 225.0) throw new DeepSpaceUnsupportedError(tle.satnum, periodMin);

  const ao = (XKE / noUnkozai) ** X2O3;
  const po = ao * omeosq;
  const con42 = 1.0 - 5.0 * cosio2;
  const con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1.0 - ecco);

  const isimp = rp < 220.0 / WGS72_RADIUS_KM + 1.0;

  let sfour = 78.0 / WGS72_RADIUS_KM + 1.0;
  let qzms24 = ((120.0 - 78.0) / WGS72_RADIUS_KM) ** 4;
  const perige = (rp - 1.0) * WGS72_RADIUS_KM;
  if (perige < 156.0) {
    sfour = perige - 78.0;
    if (perige < 98.0) sfour = 20.0;
    qzms24 = ((120.0 - sfour) / WGS72_RADIUS_KM) ** 4;
    sfour = sfour / WGS72_RADIUS_KM + 1.0;
  }

  const pinvsq = 1.0 / posq;
  const tsi = 1.0 / (ao - sfour);
  const eta = ao * ecco * tsi;
  const etasq = eta * eta;
  const eeta = ecco * eta;
  const psisq = Math.abs(1.0 - etasq);
  const coef = qzms24 * tsi ** 4;
  const coef1 = coef / psisq ** 3.5;
  const cc2 = coef1 * noUnkozai * (ao * (1.0 + 1.5 * etasq + eeta * (4.0 + etasq))
    + ((0.375 * J2 * tsi) / psisq) * con41 * (8.0 + 3.0 * etasq * (8.0 + etasq)));
  const cc1 = bstar * cc2;
  let cc3 = 0.0;
  if (ecco > 1.0e-4) cc3 = (-2.0 * coef * tsi * J3OJ2 * noUnkozai * sinio) / ecco;
  const x1mth2 = 1.0 - cosio2;
  const cc4 = 2.0 * noUnkozai * coef1 * ao * omeosq
    * (eta * (2.0 + 0.5 * etasq) + ecco * (0.5 + 2.0 * etasq)
      - ((J2 * tsi) / (ao * psisq))
        * (-3.0 * con41 * (1.0 - 2.0 * eeta + etasq * (1.5 - 0.5 * eeta))
          + 0.75 * x1mth2 * (2.0 * etasq - eeta * (1.0 + etasq)) * Math.cos(2.0 * argpo)));
  const cc5 = 2.0 * coef1 * ao * omeosq * (1.0 + 2.75 * (etasq + eeta) + eeta * etasq);

  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * noUnkozai;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * noUnkozai;
  const mdot = noUnkozai + 0.5 * temp1 * rteosq * con41
    + 0.0625 * temp2 * rteosq * (13.0 - 78.0 * cosio2 + 137.0 * cosio4);
  const argpdot = -0.5 * temp1 * con42
    + 0.0625 * temp2 * (7.0 - 114.0 * cosio2 + 395.0 * cosio4)
    + temp3 * (3.0 - 36.0 * cosio2 + 49.0 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot = xhdot1 + (0.5 * temp2 * (4.0 - 19.0 * cosio2)
    + 2.0 * temp3 * (3.0 - 7.0 * cosio2)) * cosio;

  const omgcof = bstar * cc3 * Math.cos(argpo);
  let xmcof = 0.0;
  if (ecco > 1.0e-4) xmcof = (-X2O3 * coef * bstar) / eeta;
  const nodecf = 3.5 * omeosq * xhdot1 * cc1;
  const t2cof = 1.5 * cc1;

  const denom = Math.abs(cosio + 1.0) > 1.5e-12 ? 1.0 + cosio : 1.5e-12;
  const xlcof = (-0.25 * J3OJ2 * sinio * (3.0 + 5.0 * cosio)) / denom;
  const aycof = -0.5 * J3OJ2 * sinio;
  const delmo = (1.0 + eta * Math.cos(mo)) ** 3;
  const sinmao = Math.sin(mo);
  const x7thm1 = 7.0 * cosio2 - 1.0;

  let d2 = 0.0, d3 = 0.0, d4 = 0.0, t3cof = 0.0, t4cof = 0.0, t5cof = 0.0;
  if (!isimp) {
    const cc1sq = cc1 * cc1;
    d2 = 4.0 * ao * tsi * cc1sq;
    const temp = (d2 * tsi * cc1) / 3.0;
    d3 = (17.0 * ao + sfour) * temp;
    d4 = 0.5 * temp * ao * tsi * (221.0 * ao + 31.0 * sfour) * cc1;
    t3cof = d2 + 2.0 * cc1sq;
    t4cof = 0.25 * (3.0 * d3 + cc1 * (12.0 * d2 + 10.0 * cc1sq));
    t5cof = 0.2 * (3.0 * d4 + 12.0 * cc1 * d3 + 6.0 * d2 * d2 + 15.0 * cc1sq * (2.0 * d2 + cc1sq));
  }

  return {
    satnum: tle.satnum, epochEt: tle.epochEt, isimp, bstar, ecco, inclo, nodeo, argpo, mo,
    noUnkozai, sinio, cosio, con41, x1mth2, x7thm1, mdot, argpdot, nodedot, nodecf,
    cc1, cc4, cc5, omgcof, xmcof, eta, delmo, sinmao, aycof, xlcof, t2cof,
    d2, d3, d4, t3cof, t4cof, t5cof,
  };
}

/**
 * Propagate to tsince minutes from the element epoch, writing six doubles
 * (TEME x, y, z km then vx, vy, vz km/s) at out[offset].
 */
export function sgp4PropagateInto(s: Sgp4Satrec, tsinceMin: number, out: Float64Array, offset: number): void {
  const t = tsinceMin;

  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = t * t;
  let nodem = nodedf + s.nodecf * t2;
  let tempa = 1.0 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;

  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delmtemp = 1.0 + s.eta * Math.cos(xmdf);
    const delm = s.xmcof * (delmtemp * delmtemp * delmtemp - s.delmo);
    const tempd = delomg + delm;
    mm = xmdf + tempd;
    argpm = argpdf - tempd;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }

  let nm = s.noUnkozai;
  let em = s.ecco;
  if (nm <= 0.0) {
    throw new Sgp4PropagationError(2, s.satnum, t, `mean motion ${nm} is not positive`);
  }
  const am = ((XKE / nm) ** X2O3) * tempa * tempa;
  nm = XKE / am ** 1.5;
  em = em - tempe;
  if (em >= 1.0 || em < -0.001) {
    throw new Sgp4PropagationError(1, s.satnum, t, `perturbed eccentricity ${em.toFixed(6)} outside range`);
  }
  if (em < 1.0e-6) em = 1.0e-6;
  mm = mm + s.noUnkozai * templ;
  let xlm = mm + argpm + nodem;

  nodem = nodem % TWO_PI;
  argpm = argpm % TWO_PI;
  xlm = xlm % TWO_PI;
  mm = (xlm - argpm - nodem) % TWO_PI;

  const sinip = s.sinio;
  const cosip = s.cosio;

  const ep = em;
  const xincp = s.inclo;
  const argpp = argpm;
  const nodep = nodem;
  const mp = mm;

  const axnl = ep * Math.cos(argpp);
  const templp = 1.0 / (am * (1.0 - ep * ep));
  const aynl = ep * Math.sin(argpp) + templp * s.aycof;
  const xl = mp + argpp + nodep + templp * s.xlcof * axnl;

  const u = (xl - nodep) % TWO_PI;
  let eo1 = u;
  let tem5 = 9999.9;
  let ktr = 1;
  let sineo1 = 0.0;
  let coseo1 = 0.0;
  while (Math.abs(tem5) >= 1.0e-12 && ktr <= 10) {
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    tem5 = 1.0 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0.0 ? 0.95 : -0.95;
    eo1 = eo1 + tem5;
    ktr = ktr + 1;
  }

  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1.0 - el2);
  if (pl < 0.0) {
    throw new Sgp4PropagationError(4, s.satnum, t, `semi-latus rectum ${pl.toFixed(6)} is negative`);
  }

  const rl = am * (1.0 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1.0 - el2);
  const tempb = esine / (1.0 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * tempb);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * tempb);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1.0 - 2.0 * sinu * sinu;

  const temp = 1.0 / pl;
  const temp1 = 0.5 * J2 * temp;
  const temp2 = temp1 * temp;

  const mrt = rl * (1.0 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  if (mrt < 1.0) {
    throw new Sgp4PropagationError(6, s.satnum, t, 'satellite has decayed');
  }
  su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodep + 1.5 * temp2 * cosip * sin2u;
  const xinc = xincp + 1.5 * temp2 * cosip * sinip * cos2u;
  const mvt = rdotl - (nm * temp1 * s.x1mth2 * sin2u) / XKE;
  const rvdot = rvdotl + (nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41)) / XKE;

  const sinsu = Math.sin(su);
  const cossu = Math.cos(su);
  const snod = Math.sin(xnode);
  const cnod = Math.cos(xnode);
  const sini = Math.sin(xinc);
  const cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;

  const rKm = mrt * WGS72_RADIUS_KM;
  out[offset] = rKm * ux;
  out[offset + 1] = rKm * uy;
  out[offset + 2] = rKm * uz;
  out[offset + 3] = (mvt * ux + rvdot * vx) * VKMPERSEC;
  out[offset + 4] = (mvt * uy + rvdot * vy) * VKMPERSEC;
  out[offset + 5] = (mvt * uz + rvdot * vz) * VKMPERSEC;
}
