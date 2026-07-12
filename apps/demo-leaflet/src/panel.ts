/**
 * The layer configuration panel: satellites over instruments, rendered from
 * a plain array of AGE-12-shaped per-layer config records. The DOM is a
 * render of the array; every handler writes a field and reconciles, so the
 * panel is a working prototype of layer-config-as-data (AGE-07, AGE-12).
 * Grouping by satellite is derived from the data, never stored, because a
 * satellite is not a config entity in the AGE-12 schema. Scan detail note:
 * the Early / Standard / Late stops gate the mechanism treatment's LOD only;
 * now-trail paints mechanism sub-structure with the trail unconditionally
 * (paintTrailWindow, the atlas behavior), so there is deliberately no OFF.
 */
import * as L from 'leaflet';
import { TREATMENTS, TREATMENT_LABELS, dashPatternFor } from 'argelander-leaflet';
import type { AcquisitionLayer, Treatment } from 'argelander-leaflet';
import type { DemoInstrument } from './tles.js';

export interface PanelEntry {
  satName: string;
  instrument: DemoInstrument;
  layer: AcquisitionLayer;
}

interface LayerConfig {
  id: string;
  satName: string;
  instrument: DemoInstrument;
  layer: AcquisitionLayer;
  enabled: boolean;
  treatment: Treatment;
}

export interface PanelInit {
  map: L.Map;
  baseMaps: Record<string, L.TileLayer>;
  entries: readonly PanelEntry[];
  headerSelect: HTMLSelectElement;
  defaultTreatment: Treatment;
}

const SCAN_STOPS = { Early: 6, Standard: 16, Late: 40 } as const;
type ScanStop = keyof typeof SCAN_STOPS;
const BADGES: Record<Treatment, string> = {
  'outline': 'OL', 'flat-fill': 'FF', 'now-trail': 'NT',
  'mechanism': 'MX', 'quality-gradient': 'QG', 'time-gradient': 'TG',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPanel(init: PanelInit): void {
  const root = document.getElementById('panel')!;
  const pill = document.getElementById('panel-pill') as HTMLButtonElement;
  const stage = document.getElementById('stage')!;
  L.DomEvent.disableClickPropagation(root);
  L.DomEvent.disableScrollPropagation(root);
  L.DomEvent.disableClickPropagation(pill);

  const configs: LayerConfig[] = init.entries.map((e) => ({
    id: `${e.satName}/${e.instrument.id}`,
    satName: e.satName,
    instrument: e.instrument,
    layer: e.layer,
    enabled: e.instrument.startOn !== false,
    treatment: init.defaultTreatment,
  }));

  const openSats = new Set<string>();
  let expandedId: string | null = null;
  let scanDetail: ScanStop = 'Standard';
  let baseName = 'Dark';
  let open = !window.matchMedia('(max-width: 640px)').matches;

  // The header select becomes a stateless bulk macro over per-layer
  // treatment; 'mixed' appears only when layers diverge.
  const mixedOption = el('option', undefined, 'MIXED');
  mixedOption.value = '__mixed';
  mixedOption.hidden = true;
  init.headerSelect.appendChild(mixedOption);
  init.headerSelect.addEventListener('change', () => {
    const value = init.headerSelect.value as Treatment | '__mixed';
    if (value === '__mixed') return;
    for (const c of configs) {
      c.treatment = value;
      c.layer.setTreatment(value);
    }
    render();
  });

  function reconcile(): void {
    for (const c of configs) {
      const on = init.map.hasLayer(c.layer);
      if (c.enabled && !on) c.layer.addTo(init.map);
      else if (!c.enabled && on) init.map.removeLayer(c.layer);
    }
  }

  function setBase(name: string): void {
    if (name === baseName) return;
    init.map.removeLayer(init.baseMaps[baseName]!);
    init.baseMaps[name]!.addTo(init.map);
    init.map.getContainer().classList.toggle('dark-tiles', name === 'Dark');
    baseName = name;
  }

  function setScanDetail(stop: ScanStop): void {
    scanDetail = stop;
    for (const c of configs) c.layer.setMechanismMinWidthPx(SCAN_STOPS[stop]);
  }

  function only(ids: readonly string[]): void {
    for (const c of configs) c.enabled = ids.includes(c.id);
    reconcile();
    render();
  }

  function reset(): void {
    for (const c of configs) {
      c.enabled = c.instrument.startOn !== false;
      c.treatment = init.defaultTreatment;
      c.layer.setTreatment(init.defaultTreatment);
    }
    setScanDetail('Standard');
    setBase('Dark');
    expandedId = null;
    reconcile();
    render();
  }

  function setOpen(v: boolean): void {
    open = v;
    root.classList.toggle('open', open);
    pill.hidden = open;
    stage.classList.toggle('sheet-open', open);
    render();
  }

  function swatch(id: string): HTMLCanvasElement {
    const canvas = el('canvas');
    canvas.width = 30;
    canvas.height = 10;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#94B0CD';
    ctx.lineWidth = 2;
    ctx.setLineDash([...dashPatternFor(id)]);
    ctx.beginPath();
    ctx.moveTo(1, 5);
    ctx.lineTo(29, 5);
    ctx.stroke();
    return canvas;
  }

  function headerValue(): string {
    const first = configs[0]?.treatment;
    return configs.every((c) => c.treatment === first) ? (first ?? init.defaultTreatment) : '__mixed';
  }

  function onCount(): number {
    return configs.filter((c) => c.enabled).length;
  }

  function checkbox(checked: boolean, indeterminate: boolean, onChange: (v: boolean) => void): HTMLInputElement {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.indeterminate = indeterminate;
    box.addEventListener('click', (ev) => ev.stopPropagation());
    box.addEventListener('change', () => onChange(box.checked));
    return box;
  }

  function onlyButton(ids: readonly string[]): HTMLButtonElement {
    const btn = el('button', 'only-btn', 'only');
    btn.title = 'show only this';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      only(ids);
    });
    return btn;
  }

  function treatmentBadge(c: LayerConfig): HTMLElement | null {
    return init.headerSelect.value !== c.treatment ? el('span', 't-badge', BADGES[c.treatment]) : null;
  }

  function detailRow(c: LayerConfig): HTMLElement {
    const row = el('div', 'detail-row');
    row.append('treatment');
    const select = el('select');
    for (const t of TREATMENTS) {
      const option = el('option', undefined, TREATMENT_LABELS[t]);
      option.value = t;
      if (t === c.treatment) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('click', (ev) => ev.stopPropagation());
    select.addEventListener('change', () => {
      c.treatment = select.value as Treatment;
      c.layer.setTreatment(c.treatment);
      render();
    });
    row.appendChild(select);
    return row;
  }

  function instrumentRow(c: LayerConfig, flatSatName?: string): HTMLElement {
    const row = el('div', `p-row ${flatSatName ? 'sat' : 'instr'}${c.enabled ? '' : ' off'}`);
    row.appendChild(checkbox(c.enabled, false, (v) => {
      c.enabled = v;
      reconcile();
      render();
    }));
    row.appendChild(swatch(c.id));
    const label = el('span', 'lbl');
    if (flatSatName) {
      label.append(flatSatName);
      label.appendChild(el('span', 'sub', c.instrument.label));
    } else {
      label.append(c.instrument.label);
    }
    row.appendChild(label);
    const badge = treatmentBadge(c);
    if (badge) row.appendChild(badge);
    row.appendChild(onlyButton([c.id]));
    row.addEventListener('click', () => {
      expandedId = expandedId === c.id ? null : c.id;
      render();
    });
    const frag = el('div');
    frag.appendChild(row);
    if (expandedId === c.id) frag.appendChild(detailRow(c));
    return frag;
  }

  function satGroup(satName: string, members: readonly LayerConfig[]): HTMLElement {
    const wrap = el('div');
    const row = el('div', 'p-row sat');
    const onMembers = members.filter((c) => c.enabled).length;
    row.appendChild(checkbox(onMembers === members.length, onMembers > 0 && onMembers < members.length, (v) => {
      for (const c of members) c.enabled = v;
      reconcile();
      render();
    }));
    const isOpen = openSats.has(satName);
    row.appendChild(el('span', 'chev', isOpen ? '▾' : '▸'));
    row.appendChild(el('span', 'lbl', satName));
    row.appendChild(el('span', 'n', `${onMembers}/${members.length}`));
    row.appendChild(onlyButton(members.map((c) => c.id)));
    row.addEventListener('click', () => {
      if (openSats.has(satName)) openSats.delete(satName);
      else openSats.add(satName);
      render();
    });
    wrap.appendChild(row);
    if (isOpen) for (const c of members) wrap.appendChild(instrumentRow(c));
    return wrap;
  }

  /**
   * The tile credit lives here, not on the map: the attribution overlay was
   * costing map pixels, and ODbL asks for reasonable calculation of credit,
   * not a permanent on-map box. Rendered per basemap so Terrain also
   * credits OpenTopoMap.
   */
  function tileCredit(): HTMLElement {
    const credit = el('div', 'credit');
    credit.append('map data © ');
    const osm = el('a', undefined, 'OpenStreetMap');
    osm.href = 'https://www.openstreetmap.org/copyright';
    osm.target = '_blank';
    osm.rel = 'noopener';
    credit.appendChild(osm);
    credit.append(' contributors');
    if (baseName === 'Terrain') {
      credit.append(' · tiles ');
      const otm = el('a', undefined, 'OpenTopoMap');
      otm.href = 'https://opentopomap.org';
      otm.target = '_blank';
      otm.rel = 'noopener';
      credit.appendChild(otm);
      credit.append(' (CC-BY-SA)');
    }
    return credit;
  }

  function segControl(caption: string, values: readonly string[], current: string, onPick: (v: string) => void): HTMLElement {
    const line = el('div', 'foot-line');
    line.appendChild(el('span', 'cap', caption));
    const seg = el('div', 'seg');
    for (const v of values) {
      const btn = el('button', v === current ? 'on' : '', v);
      btn.addEventListener('click', () => {
        onPick(v);
        render();
      });
      seg.appendChild(btn);
    }
    line.appendChild(seg);
    return line;
  }

  function render(): void {
    init.headerSelect.value = headerValue();
    pill.textContent = `satellites · ${onCount()} on`;

    root.textContent = '';
    const head = el('div', 'panel-head');
    head.appendChild(el('span', 'count', `SATELLITES · ${onCount()}/${configs.length} on`));
    const resetBtn = el('button', undefined, 'reset');
    resetBtn.addEventListener('click', reset);
    head.appendChild(resetBtn);
    const closeBtn = el('button', undefined, '✕');
    closeBtn.addEventListener('click', () => setOpen(false));
    head.appendChild(closeBtn);
    root.appendChild(head);

    const tree = el('div', 'panel-tree');
    const bySat = new Map<string, LayerConfig[]>();
    for (const c of configs) {
      const list = bySat.get(c.satName) ?? [];
      list.push(c);
      bySat.set(c.satName, list);
    }
    for (const [satName, members] of bySat) {
      if (members.length === 1) tree.appendChild(instrumentRow(members[0]!, satName));
      else tree.appendChild(satGroup(satName, members));
    }
    root.appendChild(tree);

    const foot = el('div', 'panel-foot');
    foot.appendChild(segControl('basemap', Object.keys(init.baseMaps), baseName, setBase));
    foot.appendChild(segControl('scan detail', Object.keys(SCAN_STOPS), scanDetail, (v) => setScanDetail(v as ScanStop)));
    foot.appendChild(tileCredit());
    root.appendChild(foot);
  }

  pill.addEventListener('click', () => setOpen(true));
  setOpen(open);
}
