# Vancouver Transit Overlay

Chrome/Chromium MV3 extension that overlays Vancouver SkyTrain station markers on Facebook Marketplace maps.

## What It Does

- Detects the Facebook Marketplace map.
- Injects a transparent Leaflet overlay above it.
- Loads bundled static SkyTrain station GeoJSON.
- Loads bundled simplified SkyTrain route-line GeoJSON.
- Mirrors the Marketplace map center from Facebook URL coordinates.
- Mirrors map zoom from Facebook map tile URLs.
- Smooths station movement during map drag while Facebook updates URL state.
- Shows hover-only station details without intercepting clicks.
- Shows hover-only estimated walking times from visible rental map markers to nearby SkyTrain stations.
- Adds an offline Commute panel with destination lookup, Bus/SkyTrain toggles, and rough listing-to-destination transit estimates.
- Adds a compact Transit toggle with persisted state.

## MVP Scope

This first version is Vancouver-specific and static-data only.
It includes stations and simplified station-to-station SkyTrain route lines.

Out of scope for the MVP:

- Transit schedules
- Live arrivals
- Alerts
- Live bus schedules, SeaBus, or West Coast Express
- Global city support
- External transit API calls at runtime

## Install Locally

1. Open Chrome or another Chromium browser.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select this project directory.
6. Open a Facebook Marketplace map page for Vancouver.

## Data

Station data lives in `data/vancouver-stations.geojson`.
Route-line data lives in `data/vancouver-lines.geojson`.
Walking city-pack data lives in `data/vancouver-walking-pack.json`.
Offline address and transit-stop lookup data lives in `data/city-packs/vancouver/`.

The station and bus-stop data are generated from TransLink GTFS Static Data. The offline address lookup uses City of Vancouver property-addresses open data. Runtime extension behavior uses only bundled files and does not call external APIs.

The Vancouver walking pack is generated from an OSM/Overpass walking-network export. Keep the generated pack scoped to the nearest 2 stations within 4 km so the extension has road-aware walking times without shipping the full regional pedestrian graph.

```sh
node --max-old-space-size=8192 scripts/build-walking-pack.js \
  --id vancouver \
  --name "Metro Vancouver" \
  --osm tmp/vancouver-walking-overpass.json \
  --stations data/vancouver-stations.geojson \
  --out data/vancouver-walking-pack.json \
  --stationSnapMeters 700
```

```sh
node scripts/build-city-pack.js \
  --stops tmp/gtfs/stops.txt \
  --routes tmp/gtfs/routes.txt \
  --trips tmp/gtfs/trips.txt \
  --stopTimes tmp/gtfs/stop_times.txt \
  --addresses tmp/address/vancouver-property-addresses.json \
  --stations data/vancouver-stations.geojson \
  --walking data/vancouver-walking-pack.json \
  --outDir data/city-packs/vancouver
```

## Validate

Run local validation before loading a release build:

```sh
for f in content.js scripts/*.js; do node --check "$f" || exit 1; done
node scripts/validate-data.js
python3 -m json.tool manifest.json
python3 -m json.tool data/vancouver-walking-pack.json
```
