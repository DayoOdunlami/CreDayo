// Static datasets built by scripts/build-network.mjs, plus the indexes the app needs.

export type Tier = 'gsp' | 'grid' | 'primary';

export interface NetworkNode {
  id: string;
  name: string;
  lon: number;
  lat: number;
  parent?: string;
  located?: 'ukpn' | 'osm' | 'approx';
}

export interface Primary extends NetworkNode {
  gridFed: boolean;
  dno: string;
  demandMw: number | null;
  firmCapacityMw: number | null;
  customers: number;
  secondaries: number;
}

/** [lon, lat, customers, primaryIndex] */
export type SecondaryRow = [number, number, number, number];

export type SiteKind = 'hospital' | 'hospice' | 'care_home' | 'telecom' | 'rail' | 'water';

export interface Site {
  name: string | null;
  kind: SiteKind;
  lon: number;
  lat: number;
  /** index of the primary whose feeding area contains this site */
  p: number;
}

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  zones: number[];
  failed: string[];
  failedSecondaries: number[];
}

export interface Network {
  generated: string;
  sources: string[];
  gsps: NetworkNode[];
  grids: NetworkNode[];
  primaries: Primary[];
  secondaries: SecondaryRow[];
}

export interface Dataset {
  network: Network;
  areas: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { id: string }>;
  sites: Site[];
  scenarios: Scenario[];
  /** node id → tier */
  tierOf: Map<string, Tier>;
  nodeById: Map<string, NetworkNode>;
  primaryIndex: Map<string, number>;
  /** node id → direct children ids (GSP → grids/primaries, grid → primaries) */
  children: Map<string, string[]>;
  secondariesByPrimary: number[][];
  sitesByPrimary: number[][];
}

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
};

export async function loadDataset(): Promise<Dataset> {
  const [network, areas, sites, scenarios] = await Promise.all([
    getJson<Network>('/data/network.json'),
    getJson<Dataset['areas']>('/data/areas.geojson'),
    getJson<Site[]>('/data/sites.json'),
    getJson<Scenario[]>('/data/scenarios.json'),
  ]);

  const tierOf = new Map<string, Tier>();
  const nodeById = new Map<string, NetworkNode>();
  const children = new Map<string, string[]>();
  const add = (n: NetworkNode, tier: Tier) => {
    tierOf.set(n.id, tier);
    nodeById.set(n.id, n);
  };
  network.gsps.forEach((n) => add(n, 'gsp'));
  network.grids.forEach((n) => add(n, 'grid'));
  network.primaries.forEach((n) => add(n, 'primary'));
  for (const n of [...network.grids, ...network.primaries]) {
    if (!n.parent) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n.id);
    children.set(n.parent, list);
  }

  const secondariesByPrimary: number[][] = network.primaries.map(() => []);
  network.secondaries.forEach((s, i) => secondariesByPrimary[s[3]].push(i));
  const sitesByPrimary: number[][] = network.primaries.map(() => []);
  sites.forEach((s, i) => sitesByPrimary[s.p].push(i));

  return {
    network,
    areas,
    sites,
    scenarios,
    tierOf,
    nodeById,
    primaryIndex: new Map(network.primaries.map((p, i) => [p.id, i])),
    children,
    secondariesByPrimary,
    sitesByPrimary,
  };
}

export const TIER_LABEL: Record<Tier, string> = {
  gsp: 'Grid supply point',
  grid: 'Grid substation',
  primary: 'Primary substation',
};

export const TIER_BLURB: Record<Tier, string> = {
  gsp: 'Where National Grid hands power to UK Power Networks (400/275 kV → 132/66 kV).',
  grid: 'Steps 132/66 kV down to 33/22 kV and feeds a cluster of primary substations.',
  primary: 'Steps down to 11 kV and feeds the local substations on your street.',
};
