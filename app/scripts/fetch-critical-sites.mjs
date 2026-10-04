// Fetches hospitals, hospices and care homes in London from the NHS ODS directory
// and geocodes them with postcodes.io. Output: data/raw/critical-sites.json
//
//   node scripts/fetch-critical-sites.mjs
//
// Behind a proxy, run with NODE_USE_ENV_PROXY=1 so fetch honours HTTPS_PROXY.

import { writeFile } from 'node:fs/promises';

const ODS = 'https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations';
const LONDON_AREAS = ['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC', 'BR', 'CR', 'DA', 'EN', 'HA', 'IG', 'KT', 'RM', 'SM', 'TW', 'UB', 'WD'];
const BBOX = { minLon: -0.52, minLat: 51.28, maxLon: 0.34, maxLat: 51.70 };

const QUERIES = [
  { kind: 'hospital', params: { PrimaryRoleId: 'RO198' }, keep: (n) => /HOSPITAL|INFIRMARY/.test(n) && !/OCCUPATIONAL|PHARMACY|OFFICE|HQ\b|HEADQUARTERS/.test(n) },
  { kind: 'hospice', params: { NonPrimaryRoleId: 'RO7' }, keep: () => true },
  { kind: 'care_home', params: { NonPrimaryRoleId: 'RO269' }, keep: () => true },
];

async function getJson(url, init) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    if (res.status === 406 || res.status === 404) return null;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`Failed: ${url}`);
}

async function fetchOrgs({ params }, area) {
  const out = [];
  for (let offset = 1; ; offset += 1000) { // ODS offsets are 1-based
    const qs = new URLSearchParams({ ...params, Status: 'Active', PostCode: area, Limit: '1000', Offset: String(offset) });
    const json = await getJson(`${ODS}?${qs}`);
    const orgs = json?.Organisations ?? [];
    out.push(...orgs);
    if (orgs.length < 1000) break;
  }
  return out;
}

// Postcode prefix match: "E" must not match "EN"/"EC", so require the outward code to be area + digit.
const inArea = (postcode, area) => new RegExp(`^${area}\\d`).test(postcode.replace(/\s+/g, ''));

async function geocode(postcodes) {
  const result = new Map();
  for (let i = 0; i < postcodes.length; i += 100) {
    const batch = postcodes.slice(i, i + 100);
    const json = await getJson('https://api.postcodes.io/postcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postcodes: batch }),
    });
    for (const r of json.result) if (r.result) result.set(r.query, [r.result.longitude, r.result.latitude]);
  }
  return result;
}

const sites = new Map();
for (const q of QUERIES) {
  // ODS needs at least area + digit, so query each district prefix (SE1 also matches SE10-SE19).
  for (const area of LONDON_AREAS) for (let d = 0; d <= 9; d++) {
    const orgs = await fetchOrgs(q, `${area}${d}`);
    for (const o of orgs) {
      if (!o.PostCode || !inArea(o.PostCode, area) || !q.keep(o.Name)) continue;
      if (!sites.has(o.OrgId)) sites.set(o.OrgId, { id: o.OrgId, name: o.Name, kind: q.kind, postcode: o.PostCode });
    }
  }
  console.log(`${q.kind}: ${[...sites.values()].filter((s) => s.kind === q.kind).length}`);
}

const coords = await geocode([...new Set([...sites.values()].map((s) => s.postcode))]);
const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bNhs\b/g, 'NHS').replace(/'S\b/g, "'s");
const out = [];
for (const s of sites.values()) {
  const c = coords.get(s.postcode);
  if (!c) continue;
  const [lon, lat] = c;
  if (lon < BBOX.minLon || lon > BBOX.maxLon || lat < BBOX.minLat || lat > BBOX.maxLat) continue;
  out.push({ ...s, name: titleCase(s.name), lon: +lon.toFixed(6), lat: +lat.toFixed(6) });
}

await writeFile(
  new URL('../data/raw/critical-sites.json', import.meta.url),
  JSON.stringify({
    source: 'NHS Organisation Data Service (ODS), Open Government Licence; geocoded by postcode via postcodes.io (ONS Postcode Directory)',
    fetched: new Date().toISOString(),
    sites: out,
  }),
);
console.log(`Wrote ${out.length} sites`);
