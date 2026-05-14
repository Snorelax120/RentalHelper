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
- `scripts/storage-debug.js` loads persisted toggle, calibration, and visible-line state.
- `scripts/diagnostics.js` and `scripts/debug-bridge.js` remain available when `DEBUG = true`.

## Decisions Made

- The MVP is Vancouver-only.
- Runtime data is static and bundled locally.
- No external transit APIs are used at runtime.
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
- `scripts/diagnostics.js`
- `scripts/debug-bridge.js`
- `scripts/page-debug-bridge.js`

Data and validation:

- `data/vancouver-stations.geojson`
- `data/vancouver-lines.geojson`
- `scripts/validate-data.js`

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
