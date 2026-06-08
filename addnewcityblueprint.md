# Add New City Blueprint

This is the repeatable data checklist for adding a new city to the Marketplace Transit Overlay.

## Required Runtime Outputs

Every supported city should end with these packaged files:

```text
data/<city>-stations.geojson
data/<city>-lines.geojson
data/<city>-walking-pack.json
data/city-packs/<city>/manifest.json
data/city-packs/<city>/addresses.json
data/city-packs/<city>/transit.json
data/city-packs/<city>/grid.json
```

Add all files to `manifest.json` under `web_accessible_resources`, then register the city in:

- `config.OVERLAY_CITY_DATASETS`
- `config.WALKING_CITY_PACKS`
- `config.TRANSIT_CITY_PACKS`
- `config.lineColors`
- `config.lineNames`
- `config.DEFAULT_VISIBLE_LINES`

## Data Sources To Collect

For every source, record:

- Source name and owner.
- Download URL or open-data package URL.
- License or terms link.
- Download date.
- Feed date or dataset version if provided.
- Raw file location under `tmp/<city>/`.
- Generated runtime file location under `data/`.

Do not ship raw downloads in the extension package.

### 1. Static GTFS

Purpose:

- Bus/streetcar/subway stop locations.
- Route names and route numbers.
- Stop-to-stop scheduled travel times for offline commute estimates.
- Rapid-transit station and line geometry generation.

Required GTFS files:

```text
stops.txt
routes.txt
trips.txt
stop_times.txt
```

Optional GTFS files:

```text
shapes.txt
transfers.txt
calendar.txt
```

Use official agency or city open-data feeds only. Do not use Google Maps data.

### 2. Rapid Transit Station And Line Data

Purpose:

- Station dots on the map.
- Rapid-transit route overlay lines.
- Station hover labels.
- Walking-time station targets.

Preferred source:

- Generate from GTFS route IDs for subway/metro/LRT routes.

Output format:

- `data/<city>-stations.geojson`: `Point` features.
- `data/<city>-lines.geojson`: simplified station-to-station `LineString` features.

Minimum station properties:

```json
{
  "station_id": "station-slug",
  "station_name": "Station Name",
  "line": ["Line 1"],
  "system": "TTC",
  "city": "toronto",
  "source": "GTFS stops.txt and stop_times.txt"
}
```

For shared stations, `line` must be an array:

```json
"line": ["Line 1", "Line 2"]
```

### 3. Walking Network Data

Purpose:

- Estimate walking time from listing markers to nearby rapid-transit stations.

Preferred source:

- Official pedestrian network GeoJSON, if the city publishes one.
- Otherwise use OpenStreetMap Overpass JSON containing walkable ways.

Supported build inputs:

```text
--geojson pedestrian-network.geojson
--osm overpass-walking-network.json
```

The walking pack builder precomputes station distances from graph nodes near rapid-transit stations. This keeps runtime fast.

If no walking network is available, a direct-distance fallback can work, but it is less accurate and should be documented as approximate.

### 4. Address Lookup Data

Purpose:

- Destination address autocomplete in the Commute panel.
- Offline geocoding without a backend.

Preferred source:

- Official municipal address point data with WGS84 latitude/longitude.

Minimum fields needed after normalization:

```text
label
search text
latitude
longitude
cell id
kind
```

The packed file should be:

```text
data/city-packs/<city>/addresses.json
```

Do not include raw address downloads in the extension package.

### 5. Transit/Commute Graph Data

Purpose:

- Offline route estimates from listing location to selected destination.
- Route number display.
- Walk + transit + transfer breakdown.

Built from GTFS:

```text
routes.txt
trips.txt
stop_times.txt
stops.txt
```

Output:

```text
data/city-packs/<city>/transit.json
```

The route graph stores compact stop-to-stop edges with average scheduled minutes. It does not include live arrivals, wait time, alerts, traffic, or service frequency.

### 6. City Grid

Purpose:

- Fast lookup of nearby addresses and transit stops.

Output:

```text
data/city-packs/<city>/grid.json
```

The build script creates this from address and transit stop coordinates.

## Build Commands

### Generate Rapid Transit GeoJSON From GTFS

```bash
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

### Generate Walking Pack From Pedestrian GeoJSON

```bash
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

### Generate City Pack

```bash
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

## Runtime Integration Checklist

After generating data:

1. Add new resources to `manifest.json`.
2. Add the overlay dataset entry to `config.OVERLAY_CITY_DATASETS`.
3. Add walking pack entry to `config.WALKING_CITY_PACKS`.
4. Add city pack entry to `config.TRANSIT_CITY_PACKS`.
5. Add line colors and default visibility.
6. Add line-chip CSS if the line names are new.
7. Run validation.
8. Test on the city map in Facebook Marketplace.

## City Metadata Checklist

Each city needs stable metadata before runtime integration:

```json
{
  "id": "toronto",
  "name": "Toronto",
  "bounds": {
    "west": -79.75,
    "south": 43.55,
    "east": -79.1,
    "north": 43.95
  },
  "routeSystem": "TTC",
  "rapidTransitRoutes": ["1", "2", "4", "5", "6"]
}
```

The bounds are used to select the correct offline walking and commute pack from the Marketplace map center. Keep them wide enough for normal search areas but not so wide that adjacent cities overlap unexpectedly.

## Toronto Baseline Added

Toronto support was generated from these source categories:

- TTC GTFS static data for subway/LRT stations, TTC stops, route names, and stop-to-stop graph edges.
- City of Toronto address point data for offline destination lookup.
- City of Toronto pedestrian network GeoJSON for walking-time graph generation.

Generated runtime files:

```text
data/toronto-stations.geojson
data/toronto-lines.geojson
data/toronto-walking-pack.json
data/city-packs/toronto/manifest.json
data/city-packs/toronto/addresses.json
data/city-packs/toronto/transit.json
data/city-packs/toronto/grid.json
```

Toronto routes included:

- Line 1
- Line 2
- Line 4
- Line 5
- Line 6

Known Toronto limitations:

- Route lines are simplified from representative GTFS trips, not exact track geometry.
- Streetcars are currently grouped into the Bus/surface transit mode for commute estimates.
- The generated walking pack snapped 110 of 112 rapid-transit stations to the pedestrian graph; unsnapped stations fall back to direct walking estimates where needed.

## Validation

Run:

```bash
for f in content.js scripts/*.js; do node --check "$f" || exit 1; done
node scripts/validate-data.js
python3 -m json.tool manifest.json >/dev/null
```

Manual tests:

- Open Facebook Marketplace map centered in the new city.
- Confirm station dots and route lines appear.
- Pan and zoom; confirm overlay alignment still works.
- Hover station dots; confirm line labels and colors.
- Hover listing markers; confirm walking estimates.
- Enter a destination address; confirm address suggestions.
- Toggle Bus/Train modes and confirm commute estimates update.
- Confirm listing clicks still pass through the overlay.

## Packaging Rules

Include only packed runtime files in the extension package:

```text
data/
scripts/
vendor/
manifest.json
content.js
content.css
```

Exclude raw inputs:

```text
tmp/
raw GTFS zips
raw address downloads
raw pedestrian network downloads
scratch files
```

Keep source URLs and license notes in project docs so data provenance is clear for publishing.
