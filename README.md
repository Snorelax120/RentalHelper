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
- Adds a compact Transit toggle with persisted state.

## MVP Scope

This first version is Vancouver-specific and static-data only.
It includes stations and simplified station-to-station SkyTrain route lines.

Out of scope for the MVP:

- Transit schedules
- Live arrivals
- Alerts
- Buses, SeaBus, or West Coast Express
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

The current file was generated from TransLink GTFS Static Data published on May 1, 2026. Runtime extension behavior uses only the bundled GeoJSON file.

## Validate

Run local validation before loading a release build:

```sh
for f in content.js scripts/*.js; do node --check "$f" || exit 1; done
node scripts/validate-data.js
python3 -m json.tool manifest.json
```
