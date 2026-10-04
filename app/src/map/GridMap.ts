import { Map as MapLibreMap, type GeoJSONSource, type MapGeoJSONFeature, type Point, type PointLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Dataset, SiteKind, Tier } from '../lib/data';
import type { Impact } from '../lib/cascade';
import { distanceM } from '../lib/cascade';
import { geometryBBox, type BBox } from '../lib/geo';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
const STYLE = KEY
  ? `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${KEY}`
  : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export const COLORS = {
  gsp: '#c084fc',
  grid: '#60a5fa',
  primary: '#2dd4bf',
  secondary: '#22d3ee',
  failed: '#f43f5e',
  selected: '#fbbf24',
  flood: '#3b82f6',
  live: '#fb923c',
  sites: {
    hospital: '#fb7185',
    hospice: '#f472b6',
    care_home: '#fdba74',
    telecom: '#a78bfa',
    rail: '#e2e8f0',
    water: '#38bdf8',
  } satisfies Record<SiteKind, string>,
};

const LONDON: BBox = [-0.52, 51.28, 0.34, 51.7];

export interface LiveFault {
  id: string;
  lon: number;
  lat: number;
  type: string;
  customers: number;
  postcodes: string;
  message: string;
  restoration: string | null;
}

export type MapClick =
  | { kind: 'node'; id: string }
  | { kind: 'site'; index: number }
  | { kind: 'live'; fault: LiveFault }
  | { kind: 'none' };

export interface Padding { top: number; bottom: number; left: number; right: number }

export class GridMap {
  readonly map: MapLibreMap;
  private data: Dataset;
  private nodeFid = new Map<string, number>();
  private fidNode: string[] = [];
  private stateful = { areas: new Set<number>(), secondaries: new Set<number>(), sites: new Set<number>(), nodes: new Set<number>() };
  private anim = 0;
  private selected: string | null = null;
  private floodLoaded = false;
  private buildingLayer: string | null = null;
  private ready: Promise<void>;
  padding: () => Padding = () => ({ top: 60, bottom: 60, left: 60, right: 60 });

  constructor(container: HTMLElement, data: Dataset, onClick: (c: MapClick) => void) {
    this.data = data;
    this.map = new MapLibreMap({
      container,
      style: STYLE,
      bounds: LONDON,
      fitBoundsOptions: { padding: 20 },
      maxBounds: [[-2.5, 50.2], [2.3, 52.9]],
      minZoom: 7,
      maxPitch: 70,
      attributionControl: { compact: true },
      dragRotate: true,
    });
    this.map.touchZoomRotate.enableRotation();
    this.ready = new Promise((resolve) => this.map.once('load', () => { this.addLayers(); resolve(); }));
    this.map.on('click', (e) => onClick(this.hitTest(e.point)));
    this.map.on('mousemove', (e) => {
      const hit = this.hitTest(e.point);
      this.map.getCanvas().style.cursor = hit.kind === 'none' && !this.areaAt(e.point) ? '' : 'pointer';
    });
  }

  whenReady() { return this.ready; }

  // ---------------------------------------------------------------------------
  // Layers

  private addLayers() {
    const m = this.map;
    const { network, sites } = this.data;
    const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;

    // 3D buildings from the basemap's own vector tiles (hidden until 3D mode)
    const buildingSrc = m.getStyle().layers.find((l) => 'source-layer' in l && l['source-layer'] === 'building');
    if (buildingSrc && 'source' in buildingSrc) {
      this.buildingLayer = 'buildings-3d';
      m.addLayer({
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: buildingSrc.source as string,
        'source-layer': 'building',
        minzoom: 13,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#1e293b', 60, '#334155', 150, '#475569'],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_height'], 8]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      }, before);
    }

    m.addSource('flood', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'flood-fill', type: 'fill', source: 'flood', layout: { visibility: 'none' }, paint: {
      'fill-color': COLORS.flood,
      'fill-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 0.5, 0.22],
    } }, before);
    m.addLayer({ id: 'flood-line', type: 'line', source: 'flood', layout: { visibility: 'none' }, paint: {
      'line-color': '#93c5fd', 'line-width': 0.8, 'line-opacity': 0.7,
    } }, before);

    m.addSource('areas', { type: 'geojson', data: this.data.areas });
    m.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: {
      'fill-color': ['case', ['boolean', ['feature-state', 'failed'], false], COLORS.failed, ['boolean', ['feature-state', 'selected'], false], COLORS.selected, '#38bdf8'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'failed'], false], 0.3, ['boolean', ['feature-state', 'selected'], false], 0.14, 0.015],
      'fill-opacity-transition': { duration: 500 },
    } }, before);
    m.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'failed'], false], COLORS.failed, ['boolean', ['feature-state', 'selected'], false], COLORS.selected, '#38bdf8'],
      'line-opacity': ['case', ['boolean', ['feature-state', 'failed'], false], 0.85, ['boolean', ['feature-state', 'selected'], false], 0.95, 0.22],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, ['boolean', ['feature-state', 'failed'], false], 1.4, 0.7],
    } }, before);

    m.addSource('links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'links', type: 'line', source: 'links', layout: { 'line-cap': 'round' }, paint: {
      'line-color': ['match', ['get', 'state'], 'failed', COLORS.failed, COLORS.selected],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2.5],
      'line-opacity': ['match', ['get', 'role'], 'parent', 0.5, 0.85],
      'line-dasharray': [2, 1.5],
    } }, before);

    m.addSource('secondaries', { type: 'geojson', data: {
      type: 'FeatureCollection',
      features: network.secondaries.map((s, i) => ({ type: 'Feature', id: i, properties: { c: s[2] }, geometry: { type: 'Point', coordinates: [s[0], s[1]] } })),
    } });
    m.addLayer({ id: 'secondaries', type: 'circle', source: 'secondaries', minzoom: 10, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1, 13, 2.4, 16, 5],
      'circle-color': ['case', ['boolean', ['feature-state', 'failed'], false], COLORS.failed, COLORS.secondary],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['boolean', ['feature-state', 'failed'], false], 0.9, 0.25], 14, ['case', ['boolean', ['feature-state', 'failed'], false], 1, 0.6]],
      'circle-blur': ['case', ['boolean', ['feature-state', 'failed'], false], 0.3, 0],
      'circle-color-transition': { duration: 300 },
    } }, before);

    m.addSource('sites', { type: 'geojson', data: {
      type: 'FeatureCollection',
      features: sites.map((s, i) => ({ type: 'Feature', id: i, properties: { kind: s.kind, name: s.name ?? '' }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })),
    } });
    const affected = ['boolean', ['feature-state', 'affected'], false];
    const careKind = ['in', ['get', 'kind'], ['literal', ['hospital', 'hospice', 'care_home']]];
    m.addLayer({ id: 'sites', type: 'circle', source: 'sites', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', affected, 2.2, 2], 12, ['case', affected, 4, 3], 14, ['case', affected, 8, 5]],
      'circle-color': ['match', ['get', 'kind'], ...Object.entries(COLORS.sites).flat(), '#fff'] as never,
      'circle-stroke-color': ['case', affected, '#fff', '#0f172a'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', affected, 0.8, 0.5], 13, ['case', affected, 2, 1]],
      // Normally only care sites show, from zoom 12. Affected sites always show.
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, ['case', affected, 1, 0], 13, ['case', affected, 1, careKind, 0.85, 0], 14.5, ['case', affected, 1, 0.85]],
      'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, ['case', affected, 1, 0], 13, ['case', affected, 1, careKind, 0.85, 0], 14.5, ['case', affected, 1, 0.85]],
    } as never }, before);
    m.addLayer({ id: 'sites-label', type: 'symbol', source: 'sites', minzoom: 14, filter: ['in', ['get', 'kind'], ['literal', ['hospital', 'hospice']]], layout: {
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 10,
    }, paint: { 'text-color': '#fecdd3', 'text-halo-color': '#0f172a', 'text-halo-width': 1.4 } });

    m.addSource('live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'live-halo', type: 'circle', source: 'live', layout: { visibility: 'none' }, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 22], 'circle-color': COLORS.live, 'circle-opacity': 0.18, 'circle-blur': 0.4,
    } });
    m.addLayer({ id: 'live', type: 'circle', source: 'live', layout: { visibility: 'none' }, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8], 'circle-color': COLORS.live, 'circle-stroke-color': '#fff7ed', 'circle-stroke-width': 1.5,
    } });

    const nodes: GeoJSON.Feature[] = [];
    const pushNode = (n: { id: string; name: string; lon: number; lat: number }, tier: Tier) => {
      const fid = nodes.length;
      this.nodeFid.set(n.id, fid);
      this.fidNode[fid] = n.id;
      nodes.push({ type: 'Feature', id: fid, properties: { id: n.id, tier, name: n.name }, geometry: { type: 'Point', coordinates: [n.lon, n.lat] } });
    };
    network.primaries.forEach((n) => pushNode(n, 'primary'));
    network.grids.forEach((n) => pushNode(n, 'grid'));
    network.gsps.forEach((n) => pushNode(n, 'gsp'));
    m.addSource('nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: nodes } });
    const tierSize = (p: number, g: number, s: number) => ['match', ['get', 'tier'], 'gsp', s, 'grid', g, p];
    m.addLayer({ id: 'nodes', type: 'circle', source: 'nodes', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, tierSize(3, 4.5, 6), 13, tierSize(6, 8, 10), 16, tierSize(9, 11, 13)],
      'circle-color': ['case', ['boolean', ['feature-state', 'failed'], false], COLORS.failed, ['match', ['get', 'tier'], 'gsp', COLORS.gsp, 'grid', COLORS.grid, COLORS.primary]],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], COLORS.selected, '#0b1120'],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, 1.5],
    } as never });
    m.addLayer({ id: 'nodes-label', type: 'symbol', source: 'nodes', minzoom: 11, layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
      'symbol-sort-key': ['match', ['get', 'tier'], 'gsp', 0, 'grid', 1, 2],
    }, paint: {
      'text-color': ['case', ['boolean', ['feature-state', 'failed'], false], '#fecdd3', '#e2e8f0'],
      'text-halo-color': '#0b1120', 'text-halo-width': 1.5,
    } });
  }

  // ---------------------------------------------------------------------------
  // Hit testing

  private hitTest(point: Point): MapClick {
    const pad = 10;
    const box: [PointLike, PointLike] = [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]];
    const first = (layers: string[]) => this.map.queryRenderedFeatures(box, { layers: layers.filter((l) => this.map.getLayer(l)) })[0] as MapGeoJSONFeature | undefined;

    const live = this.map.getLayoutProperty('live', 'visibility') === 'visible' ? first(['live']) : undefined;
    if (live) return { kind: 'live', fault: JSON.parse(live.properties.json as string) };
    const node = first(['nodes']);
    if (node) return { kind: 'node', id: node.properties.id as string };
    const site = this.map.queryRenderedFeatures(box, { layers: ['sites'] }).find((f) => this.siteVisible(f));
    if (site) return { kind: 'site', index: site.id as number };
    const area = this.areaAt(point);
    if (area) return { kind: 'node', id: area };
    return { kind: 'none' };
  }

  private siteVisible(f: MapGeoJSONFeature) {
    if (this.stateful.sites.has(f.id as number)) return true;
    const z = this.map.getZoom();
    return z >= 13 && (['hospital', 'hospice', 'care_home'].includes(f.properties.kind as string) || z >= 14.5);
  }

  private areaAt(point: Point): string | null {
    const f = this.map.queryRenderedFeatures(point, { layers: ['areas-fill'] })[0];
    return (f?.properties.id as string) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Selection

  setSelected(id: string | null) {
    const m = this.map;
    if (this.selected) {
      const fid = this.nodeFid.get(this.selected);
      if (fid != null) m.setFeatureState({ source: 'nodes', id: fid }, { selected: false });
      for (const pi of this.areasUnder(this.selected)) m.setFeatureState({ source: 'areas', id: pi }, { selected: false });
    }
    this.selected = id;
    if (!id) { this.setLinks([]); return; }
    const fid = this.nodeFid.get(id);
    if (fid != null) m.setFeatureState({ source: 'nodes', id: fid }, { selected: true });
    for (const pi of this.areasUnder(id)) m.setFeatureState({ source: 'areas', id: pi }, { selected: true });

    const node = this.data.nodeById.get(id)!;
    const links: GeoJSON.Feature[] = [];
    const parent = node.parent && this.data.nodeById.get(node.parent);
    if (parent) links.push(line(node, parent, 'selected', 'parent'));
    for (const c of this.data.children.get(id) ?? []) links.push(line(node, this.data.nodeById.get(c)!, 'selected', 'child'));
    if (!this.stateful.nodes.size) this.setLinks(links);
  }

  private areasUnder(id: string): number[] {
    const out: number[] = [];
    const stack = [id];
    while (stack.length) {
      const n = stack.pop()!;
      const pi = this.data.primaryIndex.get(n);
      if (pi != null) out.push(pi);
      stack.push(...(this.data.children.get(n) ?? []));
    }
    return out;
  }

  private setLinks(features: GeoJSON.Feature[]) {
    (this.map.getSource('links') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  bboxOf(ids: string[], secondaries: number[] = []): BBox | null {
    let b: BBox | null = null;
    const areaIds = new Set(ids.flatMap((id) => this.areasUnder(id)));
    for (const f of this.data.areas.features) if (areaIds.has(f.id as number)) b = geometryBBox(f.geometry, b);
    for (const s of secondaries) {
      const [lon, lat] = this.data.network.secondaries[s];
      b = b ? [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)] : [lon, lat, lon, lat];
    }
    return b;
  }

  fitTo(b: BBox | null, maxZoom = 14) {
    if (!b) return;
    this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: this.padding(), maxZoom, duration: 1200, pitch: this.map.getPitch(), bearing: this.map.getBearing() });
  }

  flyTo(lon: number, lat: number, zoom = 14) {
    const p = this.padding();
    this.map.flyTo({ center: [lon, lat], zoom, padding: p, duration: 1400, essential: true });
  }

  home() {
    this.map.fitBounds([[-0.45, 51.33], [0.25, 51.66]], { padding: this.padding(), duration: 900, pitch: this.map.getPitch() });
  }

  // ---------------------------------------------------------------------------
  // Cascade animation

  clearImpact() {
    cancelAnimationFrame(this.anim);
    const m = this.map;
    for (const id of this.stateful.areas) m.setFeatureState({ source: 'areas', id }, { failed: false });
    for (const id of this.stateful.secondaries) m.setFeatureState({ source: 'secondaries', id }, { failed: false });
    for (const id of this.stateful.sites) m.setFeatureState({ source: 'sites', id }, { affected: false });
    for (const id of this.stateful.nodes) m.setFeatureState({ source: 'nodes', id }, { failed: false });
    for (const set of Object.values(this.stateful)) set.clear();
    this.setLinks([]);
    this.setSelected(this.selected);
  }

  /** Plays the failure spreading outward; calls onProgress with customers lost so far. */
  playImpact(impact: Impact, onProgress: (customers: number, done: boolean) => void) {
    this.clearImpact();
    const m = this.map;
    const { data } = this;
    const events: { t: number; run: () => number }[] = [];

    // Depth of each failed node below the roots → when it trips.
    const depth = new Map<string, number>(impact.roots.map((r) => [r, 0]));
    const queue = [...impact.roots];
    while (queue.length) {
      const id = queue.shift()!;
      for (const c of data.children.get(id) ?? []) if (!depth.has(c)) { depth.set(c, depth.get(id)! + 1); queue.push(c); }
    }

    const STEP = 650;
    const links: GeoJSON.Feature[] = [];
    for (const id of impact.failedNodes) {
      const node = data.nodeById.get(id)!;
      const t = (depth.get(id) ?? 0) * STEP + jitter(id) * 250;
      const fid = this.nodeFid.get(id);
      events.push({ t, run: () => { if (fid != null) { m.setFeatureState({ source: 'nodes', id: fid }, { failed: true }); this.stateful.nodes.add(fid); } return 0; } });
      const parent = node.parent && depth.has(node.parent) ? data.nodeById.get(node.parent) : undefined;
      if (parent) links.push(line(parent, node, 'failed', 'child'));

      const pi = data.primaryIndex.get(id);
      if (pi == null) continue;
      events.push({ t: t + 120, run: () => { m.setFeatureState({ source: 'areas', id: pi }, { failed: true }); this.stateful.areas.add(pi); return 0; } });
      // Ripple out from the primary to its local substations.
      const secs = data.secondariesByPrimary[pi];
      const far = Math.max(1, ...secs.map((s) => distanceM(node.lon, node.lat, data.network.secondaries[s][0], data.network.secondaries[s][1])));
      for (const s of secs) {
        const row = data.network.secondaries[s];
        const ts = t + 200 + (distanceM(node.lon, node.lat, row[0], row[1]) / far) * 1100;
        events.push({ t: ts, run: () => { m.setFeatureState({ source: 'secondaries', id: s }, { failed: true }); this.stateful.secondaries.add(s); return row[2]; } });
      }
    }
    // Individually failed secondaries (flooded) that aren't under a failed primary.
    const covered = new Set(impact.failedNodes.map((id) => data.primaryIndex.get(id)).filter((x): x is number => x != null));
    for (const s of impact.failedSecondaries) {
      const row = data.network.secondaries[s];
      if (covered.has(row[3])) continue;
      events.push({ t: 300 + jitter(String(s)) * 1800, run: () => { m.setFeatureState({ source: 'secondaries', id: s }, { failed: true }); this.stateful.secondaries.add(s); return row[2]; } });
    }
    const maxT = events.reduce((a, e) => Math.max(a, e.t), 0);
    for (const si of impact.siteIndexes) {
      events.push({ t: Math.min(maxT, 400 + jitter(`site${si}`) * maxT) + 150, run: () => { m.setFeatureState({ source: 'sites', id: si }, { affected: true }); this.stateful.sites.add(si); return 0; } });
    }
    this.setLinks(links);

    events.sort((a, b) => a.t - b.t);
    const start = performance.now();
    let i = 0;
    let customers = 0;
    const tick = () => {
      const now = performance.now() - start;
      while (i < events.length && events[i].t <= now) customers += events[i++].run();
      const done = i >= events.length;
      onProgress(done ? impact.customers : customers, done);
      if (!done) this.anim = requestAnimationFrame(tick);
    };
    this.anim = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------------------
  // Layers & view

  async showFlood(visible: boolean, activeZones: number[] = []) {
    const m = this.map;
    if (visible && !this.floodLoaded) {
      this.floodLoaded = true;
      const res = await fetch('/data/flood.geojson');
      (m.getSource('flood') as GeoJSONSource).setData(await res.json());
      await new Promise((r) => m.once('idle', r));
    }
    for (const l of ['flood-fill', 'flood-line']) m.setLayoutProperty(l, 'visibility', visible ? 'visible' : 'none');
    m.removeFeatureState({ source: 'flood' });
    for (const id of activeZones) m.setFeatureState({ source: 'flood', id }, { active: true });
  }

  setLive(faults: LiveFault[], visible: boolean) {
    (this.map.getSource('live') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: faults.map((f) => ({ type: 'Feature', properties: { json: JSON.stringify(f) }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } })),
    });
    for (const l of ['live', 'live-halo']) this.map.setLayoutProperty(l, 'visibility', visible ? 'visible' : 'none');
  }

  set3D(on: boolean) {
    if (this.buildingLayer) this.map.setLayoutProperty(this.buildingLayer, 'visibility', on ? 'visible' : 'none');
    const zoom = on ? Math.max(this.map.getZoom(), 14.2) : this.map.getZoom();
    this.map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -20 : 0, zoom, duration: 1200, padding: this.padding() });
  }

  resize() { this.map.resize(); }

  destroy() {
    cancelAnimationFrame(this.anim);
    this.map.remove();
  }
}

function line(a: { lon: number; lat: number }, b: { lon: number; lat: number }, state: string, role: string): GeoJSON.Feature {
  return { type: 'Feature', properties: { state, role }, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } };
}

/** Deterministic 0–1 jitter so replays look the same. */
function jitter(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
