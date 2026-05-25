# Project Log

## Current Status

The Vancouver Transit Overlay is a Chrome/Chromium Manifest V3 extension for Facebook Marketplace map results.

Current MVP behavior:

- Detects the visible Facebook Marketplace map after dynamic page loads and route changes.
- Injects a fixed-position transparent Leaflet overlay above the map.
- Renders bundled SkyTrain station markers from `data/vancouver-stations.geojson`.
- Renders bundled simplified route lines from `data/vancouver-lines.geojson`.
- Uses Facebook URL latitude/longitude as the center source.
- Uses Facebook `map_tile.php` tile `z` values as the zoom source.
- Applies temporary pan smoothing during drag so stations move with the host map while URL center state catches up.
- Keeps markers, route lines, and hover tooltips click-through so listings and map controls still work.
- Shows road-aware walking estimates from visible listing markers to nearby SkyTrain stations.
- Provides an offline Commute panel with destination lookup, Bus/SkyTrain mode toggles, and rough listing-to-destination transit estimates.
- Keeps commute route summaries readable by limiting graph routes to at most two transit legs and penalizing route changes.
- Uses a compact publish-ready UI for map toggles, the commute panel, station hover, walking estimates, and commute steps.
- Provides a persisted Transit toggle.
- Keeps debug tools in the codebase but disables them by default with `DEBUG = false`.

Validation completed:

- `manifest.json` parses as valid JSON.
- `data/vancouver-stations.geojson` parses as valid GeoJSON.
- `data/vancouver-lines.geojson` parses as valid GeoJSON.
- `content.js` and every file in `scripts/` pass `node --check`.
- `node scripts/validate-data.js` validates manifest resources, station data, route-line data, coordinates, and station/line references.

## How The Project Works

Facebook Marketplace remains the real map and interaction layer. The extension adds a separate transparent overlay above the visible Marketplace map.

The overlay contains a tileless Leaflet map with disabled Leaflet interactions. Leaflet is used only to project and render transit data.

Runtime flow:

- `content.js` wires ordered modules from `manifest.json`.
- `scripts/map-detector.js` finds the map surface using scored DOM heuristics.
- `scripts/overlay.js` creates the overlay, loads station/line GeoJSON, renders route lines below station markers, and manages persisted line visibility.
- `scripts/sync.js` mirrors URL center and Facebook tile zoom into Leaflet.
- `scripts/pan-smoothing.js` applies visual-only CSS translation during map drag.
- `scripts/station-hover.js` uses document-level hit testing for non-intercepting station hover details.
- `scripts/transit-time.js` loads the offline city pack, searches destinations, and estimates simple Bus/SkyTrain routes from listing locations.
- `scripts/walking-time*.js` scans visible listing markers, projects marker anchors through Leaflet, loads walking city packs, estimates nearby station walking times, and renders the walking-time tooltip.
- `scripts/storage-debug.js` loads persisted toggle, calibration, and visible-line state.
- `scripts/diagnostics.js` and `scripts/debug-bridge.js` remain available when `DEBUG = true`.

Walking-time runtime flow:

- `scripts/walking-time-utils.js` owns shared constants, geometry, distance, normalization, DOM-rectangle, and HTML escaping helpers.
- `scripts/walking-time-city-packs.js` loads configured walking city packs with `chrome.runtime.getURL(...)`, normalizes bounds/stations/nodes/edges, builds the edge index, snaps listing coordinates to the walking graph, and falls back to direct estimates when needed.
- `scripts/walking-time-candidates.js` scans the Marketplace map for price-like marker elements, filters controls and extension UI, scores candidates, dedupes repeated DOM wrappers, projects marker anchors to lat/lng, and caches diagnostics briefly.
- `scripts/walking-time-tooltip.js` owns the tooltip element, station-row rendering, commute-estimate merge, render signature, and viewport positioning.
- `scripts/walking-time.js` is now the small coordinator that starts the feature, listens to pointer movement, clears stale state, and exposes the public `T.walkingTime` API used by debug tools.

Walking-time load order:

1. `scripts/walking-time-utils.js`
2. `scripts/walking-time-city-packs.js`
3. `scripts/walking-time-candidates.js`
4. `scripts/walking-time-tooltip.js`
5. `scripts/walking-time.js`

Walking-time hover flow:

1. `content.js` calls `T.walkingTime.start()`.
2. The coordinator creates the tooltip, begins loading city packs, and listens to document-level pointer movement.
3. Pointer movement is throttled through `requestAnimationFrame`.
4. The coordinator verifies that the overlay is enabled, map state is valid, zoom and pan smoothing are settled, and the pointer is inside the Marketplace map.
5. `walking-time-candidates.js` finds the best listing marker near the pointer.
6. The marker anchor is projected through `state.leafletMap.containerPointToLatLng(...)`.
7. `walking-time-city-packs.js` finds nearby stations for that projected coordinate.
8. The station hover tooltip is cleared so the listing tooltip is the only active hover UI.
9. `walking-time-tooltip.js` renders and positions the walking-time tooltip.

Walking-time city pack estimate flow:

- The Vancouver walking pack lives at `data/vancouver-walking-pack.json` and is configured in `config.WALKING_CITY_PACKS`.
- Loaded packs normalize into `bounds`, `stations`, `nodes`, `edges`, and `edgeIndex`.
- For listing coordinates inside a pack, candidate walking graph edges are found from nearby edge-index cells.
- The listing coordinate is snapped to the nearest edge within `config.WALKING_SNAP_MAX_METERS`.
- Station distances from both edge endpoints are combined with the distance from the listing snap point to each endpoint.
- The shortest distance per station wins.
- Results are converted to minutes using `config.WALKING_SPEED_METERS_PER_MINUTE`.
- Results are sorted by minutes, meters, and station name.
- If no city pack is active, no graph exists, or snapping fails, the module estimates walking distance by multiplying straight-line distance by `config.WALKING_CIRCUITY_FACTOR`.

Walking-time cache and clear behavior:

- Candidate scans are cached briefly because Marketplace maps can contain many nested elements.
- The cache is cleared when walking-time state becomes stale, including pointer down, window blur, scroll, overlay alignment, overlay hiding, sync changes, and pan smoothing.
- `T.walkingTime.clear(reason)` resets the candidate cache, latest pointer position, pending animation frame, tooltip visibility, tooltip render signature, and `state.walkingTime.lastClearReason`.

Walking-time debug helpers:

- When `config.DEBUG` is true, `content.js` exposes `getListingMarkerCandidates(...)`, `getNearestStations(...)`, and `getWalkingCityPacks()` through `window.__transitOverlayDebug`.
- These helpers still call the stable public `T.walkingTime` methods after the split.

## Decisions Made

- The MVP is Vancouver-only.
- Runtime data is static and bundled locally.
- No external transit APIs are used at runtime.
- Offline address lookup uses bundled City of Vancouver property-addresses data.
- Bus stop lookup uses bundled TransLink GTFS static stop data.
- No schedules, live arrivals, alerts, buses, SeaBus, West Coast Express, or global city support are included.
- Route lines are simplified station-to-station geometry, not exact GTFS track geometry.
- Station markers and route lines remain `pointer-events: none`.
- Station UX is hover-only so Marketplace clicks are preserved.
- Leaflet is bundled locally instead of loaded from a CDN.
- Static station data was generated from TransLink GTFS Static Data.
- Shared stations store multiple lines in the `line` property array.
- The overlay is appended to `document.body` and positioned with `position: fixed` to avoid Facebook offset-parent issues.
- If URL map coordinates are missing, the overlay stays hidden rather than rendering in the wrong position.
- Debug UI, pink outline, and page debug bridge are disabled by default for release testing.
- Commute routing tracks active route state during graph search instead of only the current stop. This prevents unrealistic downtown micro-transfer chains such as `Bus 6 -> Bus 2 -> Bus 44 -> Bus N22 -> Bus 240`.
- Commute routing currently caps displayed graph itineraries at two transit legs. If no simple static-GTFS route is found, the extension falls back to a rough direct stop-to-stop estimate.
- Publishing UI pass keeps the overlay click-through model unchanged. Only the Transit and Commute buttons/panel accept pointer events; map markers, route lines, and hover estimate tooltips remain non-intercepting.

## Global Release Recommendation

Use a no-backend city-pack model for global release.

Recommended first global architecture:

- Bundle a lightweight walking-pack index with the extension.
- Give each city pack its own static resource file.
- Detect the active map coordinate from the current Marketplace map state.
- Match that coordinate against city bounds in the index.
- Lazy-load only the matching city pack with `chrome.runtime.getURL(...)`.
- Cache loaded packs in memory during the page session.
- Swap packs when the map moves into another supported city.
- Fall back to direct estimates when no city pack matches or graph snapping fails.

Recommended file layout:

```text
data/walking-packs/index.json
data/walking-packs/vancouver.json
data/walking-packs/toronto.json
data/walking-packs/seattle.json
```

Example index entry:

```json
{
  "id": "vancouver",
  "name": "Metro Vancouver",
  "bounds": {
    "west": -123.35,
    "south": 49.0,
    "east": -122.45,
    "north": 49.45
  },
  "resource": "data/walking-packs/vancouver.json"
}
```

This avoids a backend and keeps runtime private. Lazy loading reduces memory use and JSON parse cost because only the active city pack is loaded. It does not reduce the extension install size if every city pack is bundled in the package.

For larger global scale, use static-hosted downloadable city packs rather than a dynamic backend:

```text
extension -> static pack index -> static city pack file -> IndexedDB cache
```

That avoids operating an application backend, but it does introduce runtime network dependency, host permissions, versioning, cache invalidation, and offline-download UX. Use this only after bundled city packs become too large for normal extension distribution.

Preferred rollout:

- Keep Vancouver bundled first.
- Add a bundled `index.json` and lazy loader before adding more cities.
- Add only a few validated city packs to the extension package.
- Move to static-hosted downloadable packs if the extension package becomes too large.
- Consider separate regional extensions if static hosting is not acceptable.

## Data Notes

Station data:

- File: `data/vancouver-stations.geojson`
- 54 unique SkyTrain station features
- Coordinates are GeoJSON longitude, latitude pairs
- Each station includes `station_name`, `line`, `system`, source metadata, and coordinates

Route-line data:

- File: `data/vancouver-lines.geojson`
- Simplified station-to-station `LineString` features
- Branches included:
  - Expo King George
  - Expo Production Way-University
  - Millennium Lafarge Lake-Douglas
  - Canada Richmond-Brighouse
  - Canada YVR-Airport

Source:

- TransLink GTFS Static Data
- Feed date in archive: May 1, 2026
- Rail routes used:
  - `13686`: Canada Line
  - `30052`: Millennium Line
  - `30053`: Expo Line

City pack data:

- Files:
  - `data/city-packs/index.json`
  - `data/city-packs/vancouver/manifest.json`
  - `data/city-packs/vancouver/addresses.json`
  - `data/city-packs/vancouver/transit.json`
  - `data/city-packs/vancouver/grid.json`
- Address lookup source: City of Vancouver property-addresses open data.
- Transit stop source: TransLink GTFS Static Data `stops.txt`.
- Current city pack includes about 98k address/station lookup entries and about 8.6k bus/SkyTrain stops.
- The Commute panel uses this data offline and stores the selected destination and mode toggles in `chrome.storage.local`.
- Current transit-time tooltip is a rough offline estimate based on access/egress walking estimates and compact GTFS route edges from `trips.txt` and `stop_times.txt`. It can show bus/SkyTrain route numbers and transfers when the static route graph can connect the selected stops.
- Transit-time estimates do not include wait time.
- Bus route times use a conservative correction multiplier and transfer penalty because raw static GTFS edge averages were undercounting short downtown examples such as 1150 Jervis St to 725 Granville St.
- The route graph still does not model live schedules, current departure time, traffic, or service frequency.

## Files

Core extension:

- `manifest.json`
- `content.js`
- `content.css`
- `vendor/leaflet.js`
- `vendor/leaflet.css`

Runtime modules:

- `scripts/config.js`
- `scripts/storage-debug.js`
- `scripts/sync.js`
- `scripts/map-detector.js`
- `scripts/overlay.js`
- `scripts/pan-smoothing.js`
- `scripts/station-hover.js`
- `scripts/transit-time.js`
- `scripts/walking-time-utils.js`
- `scripts/walking-time-city-packs.js`
- `scripts/walking-time-candidates.js`
- `scripts/walking-time-tooltip.js`
- `scripts/walking-time.js`
- `scripts/diagnostics.js`
- `scripts/debug-bridge.js`
- `scripts/page-debug-bridge.js`

Data and validation:

- `data/vancouver-stations.geojson`
- `data/vancouver-lines.geojson`
- `data/vancouver-walking-pack.json`
- `data/city-packs/index.json`
- `data/city-packs/vancouver/manifest.json`
- `data/city-packs/vancouver/addresses.json`
- `data/city-packs/vancouver/transit.json`
- `data/city-packs/vancouver/grid.json`
- `scripts/validate-data.js`
- `scripts/build-city-pack.js`

Docs:

- `README.md`
- `plan.md`
- `projects.md`

## Next Work

- Reload the unpacked extension in Chrome and test on Facebook Marketplace Vancouver map URLs.
- Confirm debug UI is hidden by default.
- Test station and route alignment at radius/zoom states `1`, `2`, `3`, `6`, and `11`.
- Hover-check Waterfront, Commercial-Broadway, Metrotown, Broadway-City Hall, Bridgeport, Richmond-Brighouse, and YVR-Airport.
- Confirm Marketplace listing clicks still pass through stations, route lines, and hover tooltips.
- Confirm Transit toggle persistence still works.
- Decide whether the next feature is line filter UI, exact GTFS shape geometry, packaging/icons, or global-city groundwork.

## Zoom Jump Mitigation Notes

- Zoom changes can otherwise look jumpy because Facebook animates the host map visually while URL center and tile zoom settle at different times.
- The transform/scale smoothing experiment made the jump worse and was removed.
- Current mitigation avoids applying intermediate zoom projections: the transit layer is hidden as soon as a wheel, zoom-control, or URL `radius`/zoom parameter change is detected, then the latest settled `setView()` is applied once.
- While zoom settling is active, all incoming map view updates are deferred, including center-only URL updates. This prevents Facebook's interim center from rendering at the old tile zoom.
- The transit Leaflet node is hidden with both the `transit-zoom-settling` class and inline `visibility: hidden` so stations and lines cannot flash during wrong projections.
- The whole overlay surface is now also hidden during zoom settling, while the Transit toggle stays visible and fixed.
- Reappearing is controlled by a host-map stability monitor, not only a fixed timeout. The monitor watches visible Facebook map tile keys/positions and the host map pane transform, then applies the pending Leaflet view after those signals are stable.
- If Facebook emits a center-only URL update during a zoom, the extension keeps the transit layer hidden until the host tile zoom changes. This avoids applying a new center against the old zoom level.
- During the zoom-settle window, the overlay container and Transit button positions are frozen so Facebook's transient map layout cannot pull them around the screen.
- Tunable constants are `ZOOM_SYNC_SETTLE_MS`, `ZOOM_SYNC_STABLE_MS`, `ZOOM_SYNC_MAX_MS`, and `ZOOM_INTENT_CLEAR_MS` in `scripts/config.js`.

## Known Risks

- Facebook can change the Marketplace DOM, tile URLs, or URL format.
- Some Facebook map pages may not expose latitude and longitude in query parameters.
- Station-to-station route lines are intentionally simplified and are not exact track geometry.
- Static station and line data must be manually regenerated or maintained for now.
