# Project Log

## Current Status

Started building the Vancouver Station Overlay MVP as a Chrome/Chromium Manifest V3 extension.

The project now has:

- A root implementation plan in `plan.md`.
- A Manifest V3 extension scaffold.
- Local Leaflet runtime files in `vendor/`.
- Static SkyTrain station GeoJSON in `data/vancouver-stations.geojson`.
- Modular content scripts that detect Facebook Marketplace maps, inject a transparent Leaflet overlay, render station markers, sync map state, and provide a persisted Transit toggle.
- Basic CSS for the overlay, markers, tooltip, and toggle.
- A README with local installation instructions.

Validation completed:

- `manifest.json` parses as valid JSON.
- `data/vancouver-stations.geojson` parses as valid JSON.
- `content.js` and every file in `scripts/` pass `node --check`.
- Station GeoJSON contains 54 `Point` features with `station_name`, `line`, and longitude/latitude coordinates.

Latest browser test:

- Station dots render.
- The Transit button renders.
- Toggle state persists after refresh.
- Listing clicks still work.
- The pink overlay outline now covers only the map, not the sidebar.
- Station alignment is correct at default/no calibration when Facebook Marketplace radius is set to 3.
- Station alignment re-syncs after map movement stops, but the delay feels bad.
- Station alignment breaks for other Marketplace radius values and when zooming.

## How The Project Works

Facebook Marketplace remains the real map and interaction layer. The extension adds a separate transparent overlay above the visible Marketplace map.

The overlay contains a Leaflet map with no base tiles and no user interactions. Leaflet is used only to project and render static SkyTrain station points.

The content script:

- Loads ordered modules from `manifest.json`.
- Finds the Marketplace map after Facebook's dynamic page load.
- Aligns `#transit-overlay-container` to the map using `getBoundingClientRect()`.
- Keeps the overlay aligned with `ResizeObserver`, resize, scroll, and periodic layout checks.
- Loads bundled station data from `data/vancouver-stations.geojson`.
- Parses map latitude, longitude, and zoom from the Facebook URL.
- Calls `leafletMap.setView()` to mirror Facebook's map state.
- Keeps the overlay click-through except for the Transit toggle.

## Decisions Made

- The MVP is Vancouver-only.
- The MVP renders station locations only.
- Route line geometry is deferred.
- No external transit APIs are used at runtime.
- Leaflet is bundled locally instead of loaded from a CDN.
- Static station data is generated from TransLink GTFS Static Data.
- Shared stations store multiple lines in the `line` property array.
- The overlay is appended to `document.body` and positioned with `position: fixed` to avoid Facebook layout and offset-parent issues.
- URL state is the first synchronization source; polling and history hooks provide resilience.
- If URL map coordinates are missing, the overlay stays hidden rather than rendering station markers in the wrong position.
- Alignment now uses a scored map-surface detector instead of the largest map-like DOM element.
- Debug mode is temporarily enabled in `content.js` so the selected map surface, overlay rect, and parsed Leaflet view are logged in DevTools.
- Station marker tooltips are deferred; markers are click-through until alignment is stable.
- A temporary debug calibration panel is enabled so Leaflet center/zoom can be tuned against Facebook's live map.

## Alignment Fix Notes

Implemented fixes for the first alignment bug report:

- Prefer the deepest visible map surface containing canvas or map imagery.
- Penalize candidate elements that include Marketplace listing links or start near the left sidebar while spanning most of the viewport.
- Clip the overlay to the selected visible map rect before sizing Leaflet.
- Add a pink debug outline around `#transit-overlay-container`.
- Expand URL parsing for map-specific params, generic lat/lng params, center pairs, bounds, and encoded map/location objects.
- Log the chosen map candidate, overlay rect, parsed map state, and applied Leaflet view.

Current tuning defaults:

- `DEBUG = true`
- `DEFAULT_ZOOM = 13`
- Saved calibration defaults:
  - `version = 4`
  - `latOffset = 0`
  - `lngOffset = 0`
  - `zoomOffset = 1`

Second alignment pass:

- Added hash/query parsing for Facebook URLs that store map state outside normal search params.
- Added path parsing for `@lat,lng,zoomz` and path-encoded center pairs.
- Replaced the fixed `ZOOM_OFFSET` constant with persisted calibration stored in `chrome.storage.local`.
- Added a debug panel with Dots up/down/left/right, Zoom +/-, and Reset calibration controls.
- Switched extension diagnostics from `console.debug` to `console.info` so logs are visible in the default DevTools console filter.

Third alignment pass:

- Reset calibration defaults to zero and versioned calibration storage so older debug defaults do not linger.
- Derived Leaflet zoom from Facebook Marketplace `radius` when no true zoom param is available.
- Radius-to-zoom baseline: `radius = 3` maps to Leaflet zoom `14`.
- Reduced URL polling from 250ms to 75ms.
- Added pointer, wheel, and history burst syncs to reduce the post-pan/zoom delay.
- Fade station dots during active map movement to make delayed re-sync less visually jarring.

Fourth alignment pass:

- User readout showed `radius=3` deriving zoom `13`, but the previously aligned state likely used the old hidden `+1` zoom default.
- Updated the radius baseline so `radius=3` now derives zoom `14` without requiring manual calibration.
- Updated the debug readout to show raw parsed zoom and final applied zoom separately.

Fifth alignment pass:

- Added host-map zoom detection by scanning the selected Facebook map element for tile URL zoom values.
- Host tile zoom now takes priority over radius-derived zoom when available.
- Sync now runs every 75ms even when the URL does not change, so DOM zoom changes can be picked up faster.
- Radius remains a fallback because Marketplace radius has proven to be a search filter, not a reliable map zoom.

Rollback pass:

- User reported the modular/latest sync made dot positions wrong at all zoom levels and dots no longer moved with the map.
- Kept the modular file split, but restored the first debug-panel behavioral baseline.
- Removed radius-derived zoom from active sync.
- Removed host tile zoom scanning from active sync.
- Restored URL polling to 250ms and only syncs on URL/history changes.
- Restored default calibration to `zoomOffset = 1` with a new calibration version so newer bad saved values are ignored.
- Removed movement fade/pointer-wheel burst sync behavior.

Modularization pass:

- Split the previous 1,314-line `content.js` into ordered content-script modules.
- `scripts/config.js`: constants, shared state, and low-level utilities.
- `scripts/storage-debug.js`: persisted toggle/calibration state and the temporary debug panel.
- `scripts/sync.js`: URL/hash/path parsing and Leaflet `setView` sync.
- `scripts/map-detector.js`: Facebook map-surface detection, candidate scoring, resize observation, and interaction burst syncs.
- `scripts/overlay.js`: overlay/toggle injection, Leaflet initialization, station rendering, and overlay alignment.
- `scripts/diagnostics.js`: read-only diagnostics for map resources, transforms, bounds-like signals, and pointer deltas.
- `content.js`: small bootstrap that wires modules together.

Non-URL diagnostics pass:

- Added read-only diagnostics without changing active URL-based sync behavior.
- Added `PerformanceObserver` resource scanning for map/tile/vector/bounds-like URLs.
- Added transform sampling on descendants of the selected map element.
- Added pointer delta sampling during map drags.
- Added bounds-like signal scanning across URL, selected map attributes, and recent scripts.
- Added map-state snapshots for selected map rect, descendants, controls, transforms, resource examples, and calibration state.
- Exposed debug API:
  - `window.__transitOverlayDebug.startDiagnostics()`
  - `window.__transitOverlayDebug.stopDiagnostics()`
  - `window.__transitOverlayDebug.getDiagnosticsSummary()`
  - `window.__transitOverlayDebug.snapshotMapState()`

Debug bridge fix:

- Chrome content scripts run in an isolated JavaScript world, so DevTools on the Facebook page cannot directly see objects assigned by `content.js`.
- Added `scripts/debug-bridge.js` and `scripts/page-debug-bridge.js`.
- The page-visible API is now bridged through DOM events and returns Promises:
  - `await window.__transitOverlayDebug.ping()`
  - `await window.__transitOverlayDebug.startDiagnostics()`
  - `await window.__transitOverlayDebug.stopDiagnostics()`
  - `await window.__transitOverlayDebug.getDiagnosticsSummary()`
  - `await window.__transitOverlayDebug.snapshotMapState()`
- Active map sync behavior remains unchanged by this bridge.

Host tile zoom sync:

- Diagnostics showed Facebook Marketplace is rendering map tiles from `map_tile.php` with an explicit `z` query parameter.
- At the previously working radius `3`, Facebook reported `z=14` and the overlay applied Leaflet zoom `14`, confirming the host tile zoom is the correct zoom source.
- Active sync now reads the dominant visible Facebook map tile zoom from the selected map DOM and uses it instead of URL/default zoom when available.
- Recent resource timing tile zoom is kept as a fallback if visible DOM tiles are not readable.
- The 250ms sync poll now runs even when the URL has not changed so tile zoom changes are picked up without waiting for Facebook to rewrite the URL.
- Calibration version moved to `5`; default `zoomOffset` is now `0` because the previous `+1` existed only to compensate for missing URL zoom.

## Data Notes

Source: TransLink GTFS Static Data.

Downloaded source feed:

- File: `google_transit.zip`
- Feed date in archive: May 1, 2026
- Rail routes used:
  - `13686`: Canada Line
  - `30052`: Millennium Line
  - `30053`: Expo Line

Generated output:

- `data/vancouver-stations.geojson`
- 54 unique SkyTrain station features
- Coordinates are GeoJSON longitude, latitude pairs
- Features use `area: "Metro Vancouver"` because the SkyTrain network extends beyond the City of Vancouver.

## Files Added

- `manifest.json`
- `content.js`
- `content.css`
- `README.md`
- `projects.md`
- `scripts/config.js`
- `scripts/storage-debug.js`
- `scripts/sync.js`
- `scripts/map-detector.js`
- `scripts/overlay.js`
- `scripts/diagnostics.js`
- `vendor/leaflet.js`
- `vendor/leaflet.css`
- `data/vancouver-stations.geojson`

## Next Work

- Load the extension unpacked in Chrome.
- Test on actual Facebook Marketplace Vancouver map URLs.
- Reload the extension after the alignment fix.
- Confirm the pink debug outline covers only the map and never the sidebar.
- Inspect DevTools logs for the selected map candidate and parsed URL source.
- Confirm the restored debug-panel baseline matches the earlier behavior before trying the next sync strategy.
- Run diagnostics while panning, zooming, and switching radius levels `1`, `2`, `3`, `6`, and `11`.
- Compare diagnostic resource zooms, transform signatures, bounds hits, and pointer deltas before changing active sync behavior.
- Turn `DEBUG` off after alignment is confirmed.

## Known Risks

- Facebook can change the Marketplace DOM or URL format.
- Facebook map zoom may not exactly match Leaflet zoom.
- Some Facebook map pages may not expose latitude and longitude in query parameters.
- Debug mode should be disabled after alignment is confirmed.
