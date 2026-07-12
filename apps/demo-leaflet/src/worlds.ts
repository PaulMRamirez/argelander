/**
 * The demo worlds: Earth on OSM web-mercator tiles, the Moon and Mars on
 * NASA Trek equirectangular tiles (plate carree, L.CRS.EPSG4326, matching
 * the Trek WMTS default028mm matrix: 2x1 tiles at zoom 0). Off-Earth
 * constellations ride demonstration orbits through PresampledProvider,
 * proving the planetary seam end to end; swath figures are demonstration
 * values, not instrument truth. Tile credits are license and courtesy
 * obligations and render in the panel footer per basemap.
 */
import * as L from 'leaflet';
import type { DemoInstrument } from './tles.js';
import { LRO_ORBIT, MRO_ORBIT } from './orbits.js';
import type { DemoOrbit } from './orbits.js';

export interface CreditPart {
  text: string;
  href?: string;
}

export interface WorldBase {
  name: string;
  layer: L.TileLayer;
  credit: readonly CreditPart[];
  /** Container class while this base shows (tone matching, tile filters). */
  mapClass?: string;
}

export interface WorldSat {
  name: string;
  orbit: DemoOrbit;
  instruments: readonly DemoInstrument[];
}

export interface WorldSpec {
  key: string;
  label: string;
  /** Plate carree worlds run L.CRS.EPSG4326; Earth runs the Leaflet default. */
  epsg4326: boolean;
  center: readonly [number, number];
  zoom: number;
  bases: readonly WorldBase[];
  defaultBase: string;
  /** Presampled-orbit satellites; Earth's TLE constellation lives in tles.ts. */
  sats: readonly WorldSat[];
}

/** Every container class any base may set; switching clears them all. */
export const MAP_CLASSES = ['dark-tiles', 'moon-tiles', 'mars-tiles'] as const;

const OSM_CREDIT: readonly CreditPart[] = [
  { text: 'map data © ' },
  { text: 'OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
  { text: ' contributors' },
];

function trek(body: string, mosaic: string): L.TileLayer {
  return L.tileLayer(
    `https://trek.nasa.gov/tiles/${body}/EQ/${mosaic}/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
    { maxNativeZoom: 7, maxZoom: 9, tileSize: 256 },
  );
}

function trekCredit(bodyPath: string, mosaic: string): readonly CreditPart[] {
  return [
    { text: 'tiles ' },
    { text: `NASA ${bodyPath} Trek`, href: `https://trek.nasa.gov/${bodyPath.toLowerCase()}/` },
    { text: ` (${mosaic})` },
  ];
}

export const WORLDS: readonly WorldSpec[] = [
  {
    key: 'earth',
    label: 'Earth',
    epsg4326: false,
    center: [25, 0],
    zoom: 2,
    defaultBase: 'Dark',
    bases: [
      {
        name: 'Dark',
        layer: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12 }),
        credit: OSM_CREDIT,
        mapClass: 'dark-tiles',
      },
      {
        name: 'Streets',
        layer: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12 }),
        credit: OSM_CREDIT,
      },
      {
        name: 'Terrain',
        layer: L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 12 }),
        credit: [...OSM_CREDIT, { text: ' · tiles ' }, { text: 'OpenTopoMap', href: 'https://opentopomap.org' }, { text: ' (CC-BY-SA)' }],
      },
    ],
    sats: [],
  },
  {
    key: 'moon',
    label: 'Moon',
    epsg4326: true,
    center: [0, 0],
    zoom: 2,
    defaultBase: 'WAC mosaic',
    bases: [
      {
        name: 'WAC mosaic',
        layer: trek('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02'),
        credit: trekCredit('Moon', 'LRO WAC mosaic'),
        mapClass: 'moon-tiles',
      },
    ],
    sats: [
      {
        name: 'LRO',
        orbit: LRO_ORBIT,
        instruments: [
          {
            id: 'lroc-wac',
            label: 'LROC WAC: 60 km pushbroom',
            swathHalfWidthKm: 30,
          },
          {
            id: 'lola',
            label: 'LOLA: five-beam altimeter beads',
            beadOffsetsKm: [-1.2, -0.6, 0, 0.6, 1.2],
            startOn: false,
          },
        ],
      },
    ],
  },
  {
    key: 'mars',
    label: 'Mars',
    epsg4326: true,
    center: [0, 0],
    zoom: 2,
    defaultBase: 'Viking',
    bases: [
      {
        name: 'Viking',
        layer: trek('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m'),
        credit: trekCredit('Mars', 'Viking MDIM 2.1'),
        mapClass: 'mars-tiles',
      },
      {
        name: 'MOLA',
        layer: trek('Mars', 'Mars_MGS_MOLA_ClrShade_merge_global_463m'),
        credit: trekCredit('Mars', 'MGS MOLA shade'),
        mapClass: 'mars-tiles',
      },
    ],
    sats: [
      {
        name: 'MRO',
        orbit: MRO_ORBIT,
        instruments: [
          {
            id: 'ctx',
            label: 'CTX: 30 km pushbroom',
            swathHalfWidthKm: 15,
          },
          {
            id: 'hirise',
            label: 'HiRISE: tasked 6 km scenes',
            swathHalfWidthKm: 3,
            taskWindowsSec: [[600, 780], [2100, 2280], [3900, 4080]],
          },
        ],
      },
    ],
  },
];

export function worldByKey(key: string): WorldSpec {
  const world = WORLDS.find((w) => w.key === key);
  if (!world) throw new Error(`unknown world '${key}'`);
  return world;
}
