import type { LiveFault } from '../map/GridMap';

const URL =
  'https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults/records' +
  '?limit=100&where=' + encodeURIComponent("powercuttype != 'Restored' and in_bbox(geopoint, 51.28, -0.52, 51.70, 0.34)");

interface Row {
  incidentreference: string;
  powercuttype: string;
  nocustomeraffected: number | null;
  noplannedcustomers: number | null;
  postcodesaffected: string | null;
  mainmessage: string | null;
  incidentcategorycustomerfriendlydescription: string | null;
  plannedincidentreason: string | null;
  estimatedrestorationdate: string | null;
  geopoint: { lon: number; lat: number } | null;
}

/** Current (unrestored) power cuts in and around London, from UKPN's open live-faults feed. */
export async function fetchLiveFaults(): Promise<LiveFault[]> {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Live faults: ${res.status}`);
  const { results } = (await res.json()) as { results: Row[] };
  return results
    .filter((r) => r.geopoint)
    .map((r) => ({
      id: r.incidentreference,
      lon: r.geopoint!.lon,
      lat: r.geopoint!.lat,
      type: r.powercuttype,
      customers: (r.nocustomeraffected || 0) + (r.noplannedcustomers || 0),
      postcodes: (r.postcodesaffected ?? '').split(';').filter(Boolean).slice(0, 6).join(', '),
      message: r.powercuttype === 'Planned'
        ? r.plannedincidentreason ?? 'Planned work'
        : r.incidentcategorycustomerfriendlydescription ?? r.mainmessage ?? 'Unplanned power cut',
      restoration: r.estimatedrestorationdate,
    }));
}
