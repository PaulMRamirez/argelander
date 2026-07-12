/**
 * The layer configuration panel: worlds over satellites over instruments,
 * rendered from a plain array of AGE-12-shaped per-layer config records.
 * The DOM is a render of the array; every handler writes a field and
 * reconciles, so the panel is a working prototype of layer-config-as-data
 * (AGE-07, AGE-12). Grouping by satellite is derived from the data, never
 * stored, because a satellite is not a config entity in the AGE-12 schema.
 * The world control swaps the whole map (a Leaflet map cannot change CRS in
 * place), then reconciles that world's layers onto the fresh map. Scan
 * detail note: the Early / Standard / Late stops gate the mechanism
 * treatment's LOD only; now-trail paints mechanism sub-structure with the
 * trail unconditionally (paintTrailWindow, the atlas behavior), so there is
 * deliberately no OFF.
 */
import * as L from 'leaflet';
import { TREATMENTS, TREATMENT_LABELS, dashPatternFor } from 'argelander-leaflet';
import type { AcquisitionLayer, Treatment } from 'argelander-leaflet';
import type { DemoInstrument } from './tles.js';
import { MAP_CLASSES, worldByKey } from './worlds.js';
import type { CreditPart, WorldSpec } from './worlds.js';

/** The map owner: the panel reads .map fresh because setWorld replaces it. */
export interface WorldHost {
  readonly map: L.Map;
  setWorld(key: string): void;
}

export interface PanelEntry {
  world: string;
  satName: string;
  instrument: DemoInstrument;
  layer: AcquisitionLayer;
}

interface LayerConfig {
  id: string;
  world: string;
  satName: string;
  instrument: DemoInstrument;
  layer: AcquisitionLayer;
  enabled: boolean;
  treatment: Treatment;
}

export interface PanelInit {
  host: WorldHost;
  worlds: readonly WorldSpec[];
  currentWorld: string;
  entries: readonly PanelEntry[];
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
    world: e.world,
    satName: e.satName,
    instrument: e.instrument,
    layer: e.layer,
    enabled: e.instrument.startOn !== false,
    treatment: init.defaultTreatment,
  }));

  const openSats = new Set<string>();
  let expandedId: string | null = null;
  let scanDetail: ScanStop = 'Standard';
  let world = init.currentWorld;
  const baseChoice = new Map(init.worlds.map((w) => [w.key, w.defaultBase]));
  let open = !window.matchMedia('(max-width: 640px)').matches;

  function visible(): LayerConfig[] {
    return configs.filter((c) => c.world === world);
  }

  function reconcile(): void {
    for (const c of visible()) {
      const on = init.host.map.hasLayer(c.layer);
      if (c.enabled && !on) c.layer.addTo(init.host.map);
      else if (!c.enabled && on) init.host.map.removeLayer(c.layer);
    }
  }

  /** Show the remembered basemap for the current world, tone class included. */
  function applyBase(): void {
    const spec = worldByKey(world);
    const name = baseChoice.get(world)!;
    for (const b of spec.bases) {
      if (b.name !== name && init.host.map.hasLayer(b.layer)) init.host.map.removeLayer(b.layer);
    }
    const base = spec.bases.find((b) => b.name === name)!;
    if (!init.host.map.hasLayer(base.layer)) base.layer.addTo(init.host.map);
    const container = init.host.map.getContainer();
    for (const cls of MAP_CLASSES) container.classList.remove(cls);
    if (base.mapClass) container.classList.add(base.mapClass);
  }

  function setBase(name: string): void {
    if (name === baseChoice.get(world)) return;
    baseChoice.set(world, name);
    applyBase();
  }

  function setWorld(key: string): void {
    if (key === world) return;
    world = key;
    expandedId = null;
    init.host.setWorld(key);
    applyBase();
    reconcile();
    render();
  }

  function setScanDetail(stop: ScanStop): void {
    scanDetail = stop;
    for (const c of configs) c.layer.setMechanismMinWidthPx(SCAN_STOPS[stop]);
  }

  function only(ids: readonly string[]): void {
    for (const c of visible()) c.enabled = ids.includes(c.id);
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
    for (const w of init.worlds) baseChoice.set(w.key, w.defaultBase);
    expandedId = null;
    if (world !== 'earth') {
      world = 'earth';
      init.host.setWorld('earth');
    }
    applyBase();
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

  function bulkValue(): string {
    const first = configs[0]?.treatment;
    return configs.every((c) => c.treatment === first) ? (first ?? init.defaultTreatment) : '__mixed';
  }

  function onCount(): number {
    return visible().filter((c) => c.enabled).length;
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

  /**
   * The always-visible per-row treatment chip: the only way into the detail
   * editor. Row taps toggle visibility (the layer-list expectation), so the
   * editor needs an explicit, discoverable control instead of a whole-row
   * tap that reads as random on a phone.
   */
  function treatmentChip(c: LayerConfig): HTMLElement {
    const chip = el('button', `t-chip${expandedId === c.id ? ' on' : ''}`, BADGES[c.treatment]);
    chip.title = `treatment: ${TREATMENT_LABELS[c.treatment]}`;
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      expandedId = expandedId === c.id ? null : c.id;
      render();
    });
    return chip;
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
    const expanded = expandedId === c.id;
    const row = el('div', `p-row ${flatSatName ? 'sat' : 'instr'}${c.enabled ? '' : ' off'}${expanded ? ' expanded' : ''}`);
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
    row.appendChild(treatmentChip(c));
    row.appendChild(onlyButton([c.id]));
    // The whole row is the visibility toggle, same as the checkbox: the
    // layer-list expectation, and a far bigger tap target on a phone.
    row.addEventListener('click', () => {
      c.enabled = !c.enabled;
      reconcile();
      render();
    });
    const frag = el('div');
    frag.appendChild(row);
    if (expanded) frag.appendChild(detailRow(c));
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
   * costing map pixels, and the licenses ask for reasonable credit, not a
   * permanent on-map box. Rendered per world and basemap.
   */
  function tileCredit(): HTMLElement {
    const credit = el('div', 'credit');
    const spec = worldByKey(world);
    const base = spec.bases.find((b) => b.name === baseChoice.get(world))!;
    for (const part of base.credit) {
      if (part.href) {
        const link = el('a', undefined, part.text);
        link.href = part.href;
        link.target = '_blank';
        link.rel = 'noopener';
        credit.appendChild(link);
      } else {
        credit.append(part.text);
      }
    }
    return credit;
  }

  // The bulk treatment macro over per-layer treatment, every world at once;
  // 'MIXED' appears only when layers diverge.
  function bulkTreatmentLine(): HTMLElement {
    const line = el('div', 'foot-line');
    line.appendChild(el('span', 'cap', 'treatment'));
    const select = el('select');
    for (const t of TREATMENTS) {
      const option = el('option', undefined, TREATMENT_LABELS[t]);
      option.value = t;
      select.appendChild(option);
    }
    const mixed = el('option', undefined, 'MIXED');
    mixed.value = '__mixed';
    mixed.hidden = true;
    select.appendChild(mixed);
    select.value = bulkValue();
    select.addEventListener('change', () => {
      const value = select.value as Treatment | '__mixed';
      if (value === '__mixed') return;
      for (const c of configs) {
        c.treatment = value;
        c.layer.setTreatment(value);
      }
      render();
    });
    line.appendChild(select);
    return line;
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
    const worldLabel = worldByKey(world).label;
    pill.textContent = `${worldLabel.toLowerCase()} · ${onCount()} on`;

    root.textContent = '';
    const head = el('div', 'panel-head');
    head.appendChild(el('span', 'count', `${worldLabel.toUpperCase()} · ${onCount()}/${visible().length} on`));
    const resetBtn = el('button', undefined, 'reset');
    resetBtn.addEventListener('click', reset);
    head.appendChild(resetBtn);
    const closeBtn = el('button', undefined, '✕');
    closeBtn.addEventListener('click', () => setOpen(false));
    head.appendChild(closeBtn);
    root.appendChild(head);

    const tree = el('div', 'panel-tree');
    const bySat = new Map<string, LayerConfig[]>();
    for (const c of visible()) {
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
    foot.appendChild(segControl('world', init.worlds.map((w) => w.label), worldLabel, (label) => {
      const picked = init.worlds.find((w) => w.label === label)!;
      setWorld(picked.key);
    }));
    foot.appendChild(bulkTreatmentLine());
    const spec = worldByKey(world);
    if (spec.bases.length > 1) {
      foot.appendChild(segControl('basemap', spec.bases.map((b) => b.name), baseChoice.get(world)!, setBase));
    }
    // The stops gate the mechanism treatment's LOD and nothing else; a
    // control that silently no-ops reads as broken, so it dims and says
    // why whenever no visible layer would respond to it.
    const scanLine = segControl('scan detail', Object.keys(SCAN_STOPS), scanDetail, (v) => setScanDetail(v as ScanStop));
    const mechanismLive = visible().some((c) => c.enabled && c.treatment === 'mechanism');
    foot.appendChild(scanLine);
    if (!mechanismLive) {
      scanLine.classList.add('dim');
      scanLine.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
      });
      foot.appendChild(el('div', 'foot-hint', 'applies to the MECHANISM TEXTURE treatment'));
    }
    foot.appendChild(tileCredit());
    root.appendChild(foot);
  }

  pill.addEventListener('click', () => setOpen(true));
  setOpen(open);
}
