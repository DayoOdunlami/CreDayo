// Builds the static datasets the app ships with, from UK Power Networks open data,
// NHS ODS (via fetch-critical-sites.mjs) and OpenStreetMap extracts in data/raw.
//
//   UKPN_API_KEY=... node scripts/build-network.mjs
//
// UKPN responses are cached in data/raw/ukpn (git-ignored); delete it to refresh.
// Behind a proxy, run with NODE_USE_ENV_PROXY=1 so fetch honours HTTPS_PROXY.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import * as turf from '@turf/turf';

const root = new URL('..', import.meta.url);
const path = (p) => new URL(p, root);
const readJson = async (p) => JSON.parse(await readFile(path(p), 'utf8'));
const writeJson = (p, data) => writeFile(path(p), JSON.stringify(data));
const round = (n, dp = 5) => +n.toFixed(dp);

// ---------------------------------------------------------------------------
// UKPN fetch (cached)

const UKPN = 'https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets';

async function ukpn(name, dataset, params, format = 'json') {
  const cache = `data/raw/ukpn/${name}.${format}`;
  try {
    await access(path(cache));
    return readJson(cache);
  } catch {}
  const key = process.env.UKPN_API_KEY;
  if (!key) throw new Error('UKPN_API_KEY is not set (and no cached data in data/raw/ukpn)');
  const url = `${UKPN}/${dataset}/exports/${format}?${new URLSearchParams(params)}`;
  console.log(`Fetching ${dataset}…`);
  const res = await fetch(url, { headers: { Authorization: `Apikey ${key}` } });
  if (!res.ok) throw new Error(`${dataset}: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  await mkdir(path('data/raw/ukpn'), { recursive: true });
  await writeJson(cache, data);
  return data;
}

// Greater London = local authority codes E09xxxxxxx (City + 32 boroughs).
const laByPrimary = await ukpn('la-by-primary', 'ukpn-local-authority-by-primary', {
  select: 'primary_floc,name,code',
  where: 'startswith(code, "E09")',
});
const londonPrimaryFlocs = new Set(laByPrimary.map((r) => r.primary_floc));

const primaryAreas = await ukpn('primary-areas', 'ukpn_primary_postcode_area', {
  select: 'primary,primary_floc,grid_site,grid_site_floc,grid_supply_point,grid_supply_point_floc,dno,demand,firmcapacitywinter,geo_point_2d,geo_shape',
}, 'geojson');

const sites = await ukpn('grid-and-primary-sites', 'grid-and-primary-sites', {
  select: 'sitefunctionallocation,sitename,sitetype,sitevoltage,spatial_coordinates,towncity',
});

const secondaries = await ukpn('secondary-sites', 'ukpn-secondary-sites', {
  select: 'functionallocation,substationalias,customer_count,primaryfeederfunctionallocation,geopoint,localauthority,onanrating',
  where: 'startswith(localauthoritycode, "E09")',
});

const floodAreas = await ukpn('flood-warning-areas', 'ukpn-flood-warning-areas', {
  select: 'fws_tacode,ta_name,descrip,river_sea,la_name,geo_shape',
}, 'geojson');

// ---------------------------------------------------------------------------
// Network hierarchy: GSP → grid → primary → secondary

const titleCase = (s) =>
  s.toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(\d+)kv\b/gi, '$1kV')
    .replace(/\bSt\b/g, 'St')
    .replace(/'S\b/g, "'s");
// "DUKE ST B 11KV" → "Duke St B"
const displayName = (s) => titleCase(s.replace(/\s+\d+(\.\d+)?\s*KV$/i, '').trim());

const siteByFloc = new Map(sites.map((s) => [s.sitefunctionallocation, s]));
const osmSupergrid = (await readJson('data/raw/osm-substations.json')).assets.filter((a) => (a.voltage ?? 0) >= 275000);

const areaFeatures = primaryAreas.features.filter((f) => londonPrimaryFlocs.has(f.properties.primary_floc) && f.geometry);
console.log(`London primaries with feeding areas: ${areaFeatures.length}`);

const primaries = new Map();
const grids = new Map();
const gsps = new Map();

for (const f of areaFeatures) {
  const p = f.properties;
  const site = siteByFloc.get(p.primary_floc);
  const coords = site?.spatial_coordinates ?? p.geo_point_2d;
  // Some London primaries are 132/11kV grid sites that feed 11kV directly: grid_site == primary.
  const gridFed = p.grid_site_floc === p.primary_floc;
  primaries.set(p.primary_floc, {
    id: p.primary_floc,
    name: displayName(p.primary),
    lon: round(coords.lon),
    lat: round(coords.lat),
    parent: gridFed ? p.grid_supply_point_floc : p.grid_site_floc,
    gridFed,
    dno: p.dno,
    demandMw: p.demand != null ? round(p.demand, 1) : null,
    firmCapacityMw: p.firmcapacitywinter != null ? round(p.firmcapacitywinter, 1) : null,
  });
  if (!gridFed && p.grid_site_floc && !grids.has(p.grid_site_floc)) {
    grids.set(p.grid_site_floc, { id: p.grid_site_floc, name: displayName(p.grid_site), parent: p.grid_supply_point_floc });
  }
  if (p.grid_supply_point_floc && !gsps.has(p.grid_supply_point_floc)) {
    gsps.set(p.grid_supply_point_floc, { id: p.grid_supply_point_floc, name: titleCase(p.grid_supply_point) });
  }
}

// Locate grid sites; fall back to the centroid of the primaries they feed.
const centroidOf = (children) => {
  const lon = children.reduce((s, c) => s + c.lon, 0) / children.length;
  const lat = children.reduce((s, c) => s + c.lat, 0) / children.length;
  return { lon: round(lon), lat: round(lat) };
};
for (const g of grids.values()) {
  const site = siteByFloc.get(g.id);
  Object.assign(g, site ? { lon: round(site.spatial_coordinates.lon), lat: round(site.spatial_coordinates.lat), located: 'ukpn' }
    : { ...centroidOf([...primaries.values()].filter((p) => p.parent === g.id)), located: 'approx' });
}
// Grid supply points are National Grid sites: match by name to OSM ≥275kV substations, else centroid.
const norm = (s) => s.toLowerCase().replace(/substation|\b\d+kv\b|[^a-z]/g, '');
for (const s of gsps.values()) {
  const site = siteByFloc.get(s.id);
  const osm = osmSupergrid.find((o) => norm(o.name) && (norm(o.name) === norm(s.name) || norm(o.name).startsWith(norm(s.name))));
  const children = [...grids.values(), ...primaries.values()].filter((c) => c.parent === s.id);
  if (site) Object.assign(s, { lon: round(site.spatial_coordinates.lon), lat: round(site.spatial_coordinates.lat), located: 'ukpn' });
  else if (osm) Object.assign(s, { lon: osm.lon, lat: osm.lat, located: 'osm' });
  else Object.assign(s, { ...centroidOf(children), located: 'approx' });
}

// Secondaries: compact rows [lon, lat, customers, primaryIndex]
const primaryIds = [...primaries.keys()];
const primaryIndex = new Map(primaryIds.map((id, i) => [id, i]));
const secRows = [];
let orphanSecondaries = 0;
for (const s of secondaries) {
  const pi = primaryIndex.get(s.primaryfeederfunctionallocation);
  if (pi == null || !s.geopoint) { orphanSecondaries++; continue; }
  secRows.push([round(s.geopoint.lon), round(s.geopoint.lat), s.customer_count ?? 0, pi]);
}
console.log(`Secondaries: ${secRows.length} linked, ${orphanSecondaries} without a London primary`);

for (const p of primaries.values()) { p.customers = 0; p.secondaries = 0; }
for (const [, , cust, pi] of secRows) {
  const p = primaries.get(primaryIds[pi]);
  p.customers += cust;
  p.secondaries += 1;
}

// ---------------------------------------------------------------------------
// Feeding areas (simplified) keyed by primary index

const areas = {
  type: 'FeatureCollection',
  features: areaFeatures.map((f) => {
    const simplified = turf.simplify(turf.feature(f.geometry), { tolerance: 0.00025, highQuality: false });
    const truncated = turf.truncate(simplified, { precision: 5 });
    return { type: 'Feature', id: primaryIndex.get(f.properties.primary_floc), properties: { id: f.properties.primary_floc }, geometry: truncated.geometry };
  }),
};


// Spatial lookup: which primary feeding area contains a point
const areaBoxes = areas.features.map((f) => ({ f, bbox: turf.bbox(f) }));
function primaryAt(lon, lat) {
  const pt = turf.point([lon, lat]);
  for (const { f, bbox } of areaBoxes) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (turf.booleanPointInPolygon(pt, f)) return f.properties.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sites that depend on power: critical care (NHS ODS) + cross-sector assets (OSM)

const critical = (await readJson('data/raw/critical-sites.json')).sites;
// NHS trust sites repeat per department; keep one hospital per postcode, preferring the plainest name.
const hospitalsByPostcode = new Map();
for (const s of critical.filter((s) => s.kind === 'hospital' && !/at home|day hospital|outreach/i.test(s.name))) {
  const prev = hospitalsByPostcode.get(s.postcode);
  const score = (n) => (/^(the )?[\w' ]+ hospital$/i.test(n) ? 0 : 1) * 100 + n.length;
  if (!prev || score(s.name) < score(prev.name)) hospitalsByPostcode.set(s.postcode, s);
}
// ...and one per name (the same hospital can be registered at several postcodes).
const cleanName = (n) => n.replace(/\s+(Nhst|Nhs Trust|Nhs Foundation Trust|Nhsft)$/i, '');
const hospitalsByName = new Map();
for (const h of hospitalsByPostcode.values()) {
  const key = cleanName(h.name).toLowerCase().replace(/[^a-z]/g, '');
  if (!hospitalsByName.has(key)) hospitalsByName.set(key, { ...h, name: cleanName(h.name) });
}
const careSites = [...hospitalsByName.values(), ...critical.filter((s) => s.kind !== 'hospital')];

const osm = async (type) => (await readJson(`data/raw/osm-${type}.json`)).assets;
const crossSector = [
  ...(await osm('telecom')).map((a) => ({ id: a.id, name: a.name, kind: 'telecom', lon: a.lon, lat: a.lat })),
  ...(await osm('transport')).filter((a) => a.subtype === 'rail').map((a) => ({ id: a.id, name: a.name, kind: 'rail', lon: a.lon, lat: a.lat })),
  ...(await osm('water')).filter((a) => ['pumping', 'treatment', 'wastewater'].includes(a.subtype)).map((a) => ({ id: a.id, name: a.name, kind: 'water', lon: a.lon, lat: a.lat })),
];

const isPlaceholder = (n) => /^(Power|Water|Telecom|Transport) \d+$/.test(n);
const siteRows = [];
for (const s of [...careSites, ...crossSector]) {
  const servedBy = primaryAt(s.lon, s.lat);
  if (!servedBy) continue;
  siteRows.push({
    name: isPlaceholder(s.name) ? null : s.name,
    kind: s.kind,
    lon: round(s.lon),
    lat: round(s.lat),
    p: primaryIndex.get(servedBy),
  });
}
const kindCounts = siteRows.reduce((c, s) => ((c[s.kind] = (c[s.kind] ?? 0) + 1), c), {});
console.log('Sites inside London feeding areas:', kindCounts);

// ---------------------------------------------------------------------------
// Flood warning areas in London + a Thames tidal flood scenario

const londonBox = turf.bboxPolygon(turf.bbox(areas));
const flood = {
  type: 'FeatureCollection',
  features: floodAreas.features
    .filter((f) => f.geometry && turf.booleanIntersects(f, londonBox))
    .map((f, i) => {
      const g = turf.truncate(turf.simplify(turf.feature(f.geometry), { tolerance: 0.0002 }), { precision: 5 }).geometry;
      return { type: 'Feature', id: i, properties: { name: f.properties.ta_name, river: f.properties.river_sea || null }, geometry: g };
    }),
};

function scenarioFor(test) {
  const zones = flood.features.filter((f) => test(f.properties.river ?? ''));
  const boxes = zones.map((f) => ({ f, bbox: turf.bbox(f) }));
  const flooded = (lon, lat) => boxes.some(({ f, bbox }) =>
    lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3] && turf.booleanPointInPolygon(turf.point([lon, lat]), f));
  return {
    zones: zones.map((f) => f.id),
    // Substations physically inside the flood zone fail; everything downstream of them follows.
    failed: [...gsps.values(), ...grids.values(), ...primaries.values()].filter((n) => flooded(n.lon, n.lat)).map((n) => n.id),
    failedSecondaries: secRows.map((r, i) => (flooded(r[0], r[1]) ? i : -1)).filter((i) => i >= 0),
  };
}
const scenarios = [
  {
    id: 'thames',
    name: 'Thames tidal flood',
    blurb: 'Every Environment Agency flood warning area along the tidal Thames floods at once: a breach of the Thames Barrier defences on a surge tide.',
    ...scenarioFor((r) => /thames/i.test(r)),
  },
  {
    id: 'rivers',
    name: 'Surface & river flooding',
    blurb: "London's tributary rivers (the Lee, Wandle, Brent, Roding, Ravensbourne and more) all burst their banks after prolonged heavy rain.",
    ...scenarioFor((r) => r && !/thames/i.test(r)),
  },
];
for (const s of scenarios) console.log(`Scenario ${s.id}: ${s.zones.length} zones, ${s.failed.length} substations, ${s.failedSecondaries.length} secondaries flooded`);

// ---------------------------------------------------------------------------
// Write

await mkdir(path('public/data'), { recursive: true });
const network = {
  generated: new Date().toISOString(),
  sources: [
    'UK Power Networks Open Data Portal (CC BY 4.0): grid & primary sites, primary feeding areas, secondary sites, flood warning areas',
    'NHS Organisation Data Service (OGL) geocoded via postcodes.io: hospitals, hospices, care homes',
    'OpenStreetMap contributors (ODbL): telecoms masts, rail stations, water sites, supergrid locations',
  ],
  gsps: [...gsps.values()],
  grids: [...grids.values()],
  primaries: primaryIds.map((id) => primaries.get(id)),
  // [lon, lat, customers, primaryIndex]
  secondaries: secRows,
};
await writeJson('public/data/network.json', network);
await writeJson('public/data/areas.geojson', areas);
await writeJson('public/data/sites.json', siteRows);
await writeJson('public/data/flood.geojson', flood);
await writeJson('public/data/scenarios.json', scenarios);

const total = network.primaries.reduce((s, p) => s + p.customers, 0);
console.log(`GSPs ${network.gsps.length}, grid ${network.grids.length}, primaries ${network.primaries.length}, customers ${total.toLocaleString()}`);
console.log(`Unlocated: grids ${network.grids.filter((g) => g.located === 'approx').length}, GSPs ${network.gsps.filter((g) => g.located === 'approx').length}`);

