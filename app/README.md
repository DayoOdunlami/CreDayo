# CreDayo: London grid resilience

What happens when part of London's electricity network fails? Tap a substation, fail it, and watch the
outage spread through the real UK Power Networks hierarchy to the homes, hospitals, care homes, masts,
stations and water sites it supplies.

This folder is a self-contained rebuild of the earlier CreDayo experiments in the repo root. Lift it into a fresh repo as-is.

## What's in it

- **Real network**: UKPN open data for Greater London (33 boroughs): 30 grid supply points → 51 grid sites →
  226 primary substations (with their actual feeding-area polygons) → 17,408 local substations with customer counts.
- **Failure cascade**: failing any node takes out everything downstream. Demand lost uses UKPN's recorded
  primary demand, and cost uses the Value of Lost Load (£17k/MWh).
- **Vulnerable sites**: NHS ODS hospitals, hospices and care homes (geocoded via postcodes.io), plus OSM
  telecoms masts, rail stations and water sites, each assigned to the primary whose area contains it.
- **Flood scenarios**: UKPN/EA flood warning areas. Substations inside the zone fail, along with everything below them.
- **Live**: current power cuts from UKPN's open live-faults feed (fetched in the browser, no key).
- **2D / 3D**: MapLibre with MapTiler's dark basemap. 3D extrudes buildings from the same vector tiles.
- **Shareable links**: `#select=<id>`, `#fail=<id>`, `#scenario=thames|rivers`.
- Responsive: side panel on laptop, draggable bottom sheet on phone and tablet.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
```

`VITE_MAPTILER_KEY` is read from `app/.env`, falling back to the repo root `.env` while the app lives here.
Without a key the map falls back to CARTO's dark basemap.

## Refresh the data

```bash
# Hospitals, hospices, care homes → data/raw/critical-sites.json (no key needed)
npm run data:sites

# UKPN network, areas, flood zones → public/data/*.json
# needs a free key from https://ukpowernetworks.opendatasoft.com (put UKPN_API_KEY in .env.local)
UKPN_API_KEY=... npm run data
```

UKPN responses are cached in `data/raw/ukpn/` (git-ignored). Delete that folder to re-download. Behind a
corporate proxy, prefix commands with `NODE_USE_ENV_PROXY=1`.

## Caveats

The cascade is illustrative worst-case logic. Real distribution networks are meshed, and automatic
switching restores many customers within minutes. Sites are linked to the primary whose feeding area
contains them, not to their actual feeder.

Data: UK Power Networks (CC BY 4.0), NHS ODS (OGL), ONS Postcode Directory via postcodes.io (OGL),
© OpenStreetMap contributors (ODbL), © MapTiler.
