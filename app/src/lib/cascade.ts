import type { Dataset, SiteKind } from './data';

/**
 * Value of Lost Load: what customers would pay to avoid an outage.
 * £17,000/MWh is the London Economics estimate for Ofgem/DECC (2013), used across GB network planning.
 */
export const VOLL_PER_MWH = 17_000;

export interface Impact {
  /** the nodes the user (or scenario) failed directly */
  roots: string[];
  /** every grid/GSP/primary node that loses supply */
  failedNodes: string[];
  failedPrimaries: number[];
  /** secondary indexes that lose supply, in no particular order */
  failedSecondaries: number[];
  customers: number;
  demandMw: number;
  costPerHour: number;
  siteIndexes: number[];
  siteCounts: Record<SiteKind, number>;
  /** primaries whose whole feeding area is off (vs. partial, scenario-only) */
  wholeAreaPrimaries: Set<number>;
}

/** Everything downstream of `roots`, plus individually-failed secondaries (e.g. flooded ones). */
export function computeImpact(data: Dataset, roots: string[], extraSecondaries: number[] = []): Impact {
  const failedNodes = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (failedNodes.has(id)) continue;
    failedNodes.add(id);
    stack.push(...(data.children.get(id) ?? []));
  }

  const wholeAreaPrimaries = new Set<number>();
  for (const id of failedNodes) {
    const i = data.primaryIndex.get(id);
    if (i != null) wholeAreaPrimaries.add(i);
  }

  const failedSecondaries = new Set<number>();
  for (const pi of wholeAreaPrimaries) for (const s of data.secondariesByPrimary[pi]) failedSecondaries.add(s);
  for (const s of extraSecondaries) failedSecondaries.add(s);

  const primariesTouched = new Set(wholeAreaPrimaries);
  let customers = 0;
  for (const s of failedSecondaries) {
    const row = data.network.secondaries[s];
    customers += row[2];
    primariesTouched.add(row[3]);
  }

  // Demand: whole primaries use UKPN's recorded demand; partial ones pro-rata by customers.
  let demandMw = 0;
  const partialCustomers = new Map<number, number>();
  for (const s of failedSecondaries) {
    const row = data.network.secondaries[s];
    if (!wholeAreaPrimaries.has(row[3])) partialCustomers.set(row[3], (partialCustomers.get(row[3]) ?? 0) + row[2]);
  }
  for (const pi of wholeAreaPrimaries) demandMw += demandOf(data, pi);
  for (const [pi, cust] of partialCustomers) {
    const p = data.network.primaries[pi];
    demandMw += p.customers ? demandOf(data, pi) * (cust / p.customers) : 0;
  }

  // Sites: everything in a fully-failed area. In partial areas, sites near a flooded secondary.
  const siteIndexes: number[] = [];
  for (const pi of wholeAreaPrimaries) siteIndexes.push(...data.sitesByPrimary[pi]);
  if (partialCustomers.size) {
    const flooded = [...failedSecondaries].filter((s) => !wholeAreaPrimaries.has(data.network.secondaries[s][3]));
    for (const pi of partialCustomers.keys()) {
      for (const si of data.sitesByPrimary[pi]) {
        const site = data.sites[si];
        const near = flooded.some((s) => {
          const r = data.network.secondaries[s];
          return r[3] === pi && distanceM(site.lon, site.lat, r[0], r[1]) < 250;
        });
        if (near) siteIndexes.push(si);
      }
    }
  }

  const siteCounts: Record<SiteKind, number> = { hospital: 0, hospice: 0, care_home: 0, telecom: 0, rail: 0, water: 0 };
  for (const i of siteIndexes) siteCounts[data.sites[i].kind]++;

  return {
    roots,
    failedNodes: [...failedNodes],
    failedPrimaries: [...primariesTouched],
    failedSecondaries: [...failedSecondaries],
    customers,
    demandMw,
    costPerHour: demandMw * VOLL_PER_MWH,
    siteIndexes,
    siteCounts,
    wholeAreaPrimaries,
  };
}

/** UKPN demand where recorded, else ~1.1 kW per customer (London after-diversity peak). */
function demandOf(data: Dataset, pi: number) {
  const p = data.network.primaries[pi];
  return p.demandMw ?? (p.customers * 1.1) / 1000;
}

export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * 111_320;
}
