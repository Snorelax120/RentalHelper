# Transit Overlay for Marketplace

Chrome/Chromium MV3 extension that overlays supported-city rapid transit stations, walking estimates, and offline commute estimates on Facebook Marketplace maps.

## What It Does

- Detects the Facebook Marketplace map.
- Injects a transparent Leaflet overlay above it.
- Loads bundled static rapid-transit station GeoJSON for supported cities.
- Loads bundled simplified rapid-transit route-line GeoJSON.
- Mirrors the Marketplace map center from Facebook URL coordinates.
- Mirrors map zoom from Facebook map tile URLs.
- Smooths station movement during map drag while Facebook updates URL state.
- Shows hover-only station details without intercepting clicks.
- Shows hover-only estimated walking times from visible rental map markers to nearby rapid-transit stations.
- Adds an offline Commute panel with destination lookup, Bus/Train toggles, and rough listing-to-destination transit estimates.
- Adds a compact Transit toggle with persisted state.

## Supported Cities

Current bundled support:

- Metro Vancouver: SkyTrain station markers, simplified SkyTrain route lines, walking pack, offline address lookup, and TransLink GTFS-derived commute graph.
- Toronto: TTC Lines 1, 2, 4, 5, and 6 station markers, simplified route lines, walking pack, offline address lookup, and TTC GTFS-derived commute graph.

Runtime behavior uses static bundled data only. There are no external transit API calls at runtime.

## Scope

Out of scope for the MVP:

- Transit schedules
- Live arrivals
- Alerts
- Live bus schedules, SeaBus, or West Coast Express
- External transit API calls at runtime
- On-demand city-pack downloads

## Install Locally

1. Open Chrome or another Chromium browser.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select this project directory.
6. Open a Facebook Marketplace map page for Vancouver or Toronto.

## Data

Overlay data:

- `data/vancouver-stations.geojson`
- `data/vancouver-lines.geojson`
- `data/toronto-stations.geojson`
- `data/toronto-lines.geojson`

Walking packs:

- `data/vancouver-walking-pack.json`
- `data/toronto-walking-pack.json`

Offline address and transit packs:

- `data/city-packs/index.json`
- `data/city-packs/vancouver/`
- `data/city-packs/toronto/`

Vancouver station and bus-stop data are generated from TransLink GTFS Static Data. Vancouver address lookup uses City of Vancouver property-addresses open data.

Toronto station, route, and transit-stop data are generated from TTC GTFS Static Data. Toronto address lookup uses City of Toronto address point data. Toronto walking estimates use the City of Toronto pedestrian network.

Raw downloads stay in `tmp/` for regeneration and should not be included in a Chrome Web Store package.

## Build Data

Vancouver walking pack:

```sh
node --max-old-space-size=8192 scripts/build-walking-pack.js \
  --id vancouver \
  --name "Metro Vancouver" \
  --osm tmp/vancouver-walking-overpass.json \
  --stations data/vancouver-stations.geojson \
  --out data/vancouver-walking-pack.json \
  --stationSnapMeters 700
```

Vancouver city pack:

```sh
node scripts/build-city-pack.js \
  --id vancouver \
  --name "Metro Vancouver" \
  --cityLabel Vancouver \
  --bounds -123.35,49,-122.45,49.45 \
  --stops tmp/gtfs/stops.txt \
  --routes tmp/gtfs/routes.txt \
  --trips tmp/gtfs/trips.txt \
  --stopTimes tmp/gtfs/stop_times.txt \
  --addresses tmp/address/vancouver-property-addresses.json \
  --stations data/vancouver-stations.geojson \
  --walking data/vancouver-walking-pack.json \
  --outDir data/city-packs/vancouver
```

Toronto rapid-transit GeoJSON:

```sh
node scripts/build-gtfs-metro-geojson.js \
  --city toronto \
  --system TTC \
  --stops tmp/toronto/gtfs/stops.txt \
  --routes tmp/toronto/gtfs/routes.txt \
  --trips tmp/toronto/gtfs/trips.txt \
  --stopTimes tmp/toronto/gtfs/stop_times.txt \
  --routeIds 1,2,4,5,6 \
  --outStations data/toronto-stations.geojson \
  --outLines data/toronto-lines.geojson
```

Toronto walking pack:

```sh
node scripts/build-walking-pack.js \
  --id toronto \
  --name "Toronto" \
  --geojson tmp/toronto/pedestrian-network.geojson \
  --stations data/toronto-stations.geojson \
  --out data/toronto-walking-pack.json \
  --stationCount 2 \
  --maxDistanceMeters 4000 \
  --stationSnapMeters 800
```

Toronto city pack:

```sh
node scripts/build-city-pack.js \
  --id toronto \
  --name Toronto \
  --cityLabel Toronto \
  --bounds -79.75,43.55,-79.1,43.95 \
  --stops tmp/toronto/gtfs/stops.txt \
  --addresses tmp/toronto/address/address-points.json \
  --addressFormat toronto-oar \
  --routes tmp/toronto/gtfs/routes.txt \
  --trips tmp/toronto/gtfs/trips.txt \
  --stopTimes tmp/toronto/gtfs/stop_times.txt \
  --stations data/toronto-stations.geojson \
  --walking data/toronto-walking-pack.json \
  --outDir data/city-packs/toronto
```

## Validate

Run local validation before loading a release build:

```sh
for f in content.js scripts/*.js; do node --check "$f" || exit 1; done
node scripts/validate-data.js
python3 -m json.tool manifest.json
python3 -m json.tool data/vancouver-walking-pack.json
python3 -m json.tool data/toronto-walking-pack.json
```
