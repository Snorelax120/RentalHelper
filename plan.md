# Vancouver Station Overlay MVP Plan

## Project Goal

Build a Chrome/Chromium Manifest V3 extension that overlays Vancouver SkyTrain station locations on Facebook Marketplace map results.

The first version is Vancouver-specific by design. Future global support can build on the same overlay and data-loading architecture, but it should not complicate the MVP.

The MVP renders static bundled transit geometry:

- No schedules
- No live arrivals
- No alerts
- No external transit APIs
- No buses, SeaBus, West Coast Express, or global city support
- Station markers and simplified station-to-station SkyTrain route lines

## Success Criteria

The project is successful when:

- The extension loads as an unpacked Chrome/Chromium MV3 extension.
- It runs only on Facebook Marketplace map pages.
- Vancouver SkyTrain station markers and route lines appear over the Facebook Marketplace map.
- Transit geometry stays visually aligned while the Facebook map pans and zooms.
- The Facebook map and listing interactions still work through the overlay.
- A compact Transit toggle can show or hide the station overlay.
- The toggle state persists across page refreshes and browser sessions.
- All station data is bundled locally in the extension.
- Route-line data is bundled locally in the extension.
- No external transit API calls are made.
- Normal usage does not produce major console errors.

## Architecture

Use a "ghost layer" overlay architecture.

Facebook Marketplace remains the host map and the source of user interaction. The extension injects a transparent overlay above the Marketplace map and renders station markers inside that overlay with Leaflet.

The extension must not modify or depend on Facebook's internal React or map implementation beyond detecting the visible map container and reading map state from the page URL where available.

Core architecture:

- Host: Facebook Marketplace map.
- Overlay: a fixed-position transparent `div` containing a tileless Leaflet map.
- Renderer: Leaflet route lines and markers backed by bundled GeoJSON data.
- Center sync source: Facebook Marketplace URL latitude and longitude parameters.
- Zoom sync source: Facebook map tile URLs when available.
- Fallback sync: history listeners, periodic polling, and default zoom only before tile zoom is known.
- Interactions: overlay is click-through by default using `pointer-events: none`.
- Controls: the Transit toggle uses `pointer-events: auto`.

## Extension File Structure

Create this initial structure:

```text
manifest.json
content.js
content.css
vendor/
  leaflet.js
  leaflet.css
data/
  vancouver-stations.geojson
  vancouver-lines.geojson
```

Optional supporting files:

```text
README.md
icons/
  icon-16.png
  icon-48.png
  icon-128.png
```

## Manifest Requirements

Use Manifest V3.

Required permissions:

- `storage` for persisting the Transit overlay toggle state.

Content script matches:

- `https://www.facebook.com/marketplace/*`
- `https://web.facebook.com/marketplace/*`

Web-accessible resources:

- `vendor/leaflet.js`
- `vendor/leaflet.css`
- `data/vancouver-stations.geojson`
- `data/vancouver-lines.geojson`
- Leaflet image assets if the local Leaflet build requires them.

The content script should inject or load Leaflet assets from the extension bundle, not from a CDN.

## Static Station Data

Store station data in:

```text
data/vancouver-stations.geojson
```

The file should be a GeoJSON `FeatureCollection` containing only `Point` features.

Each station feature must include:

- `station_name`
- `line`
- `geometry.coordinates`

Recommended feature shape:

```json
{
  "type": "Feature",
  "properties": {
    "station_name": "Waterfront",
    "line": ["Expo", "Canada"],
    "city": "Vancouver",
    "system": "SkyTrain"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [-123.1119, 49.2856]
  }
}
```

Notes:

- Coordinates must use GeoJSON order: longitude, latitude.
- Shared stations should use an array for `line`, for example `["Expo", "Millennium"]`.
- Simplified route line geometry is supported with station-to-station `LineString` features.
- Static station data can be manually maintained for the Vancouver-only version.

## Map Detection

Facebook Marketplace loads dynamically, so the extension must detect the map after initial page load and after single-page-app navigation.

Implement a map hunter in `content.js`:

- Start detection when the content script loads.
- Use a `MutationObserver` on `document.body`.
- Prefer map containers with known accessible labels, especially `aria-label="Map Explorer"`.
- Add fallback heuristics for large map-like containers that contain canvas, image tiles, or map control elements.
- Ignore containers that are too small to be the main Marketplace map.
- Re-run detection when Facebook changes Marketplace routes without a full reload.

When a map is found:

- Store a reference to the detected map element.
- Measure it with `getBoundingClientRect()`.
- Initialize the overlay if it has not already been created.
- Re-align the overlay whenever the map bounds change.

## Overlay Injection

Create a fixed-position overlay container:

```text
#transit-overlay-container
```

Recommended behavior:

- Append the overlay to `document.body`.
- Use `position: fixed`.
- Set `top`, `left`, `width`, and `height` from the detected map's `getBoundingClientRect()`.
- Use a transparent background.
- Use a `z-index` high enough to sit above the map but below Facebook navigation and dialogs.
- Set `pointer-events: none` on the overlay container.
- Hide the overlay if the map cannot be detected or has invalid dimensions.

Keep the overlay aligned with:

- `ResizeObserver` on the detected map element.
- `window` resize listener.
- `window` scroll listener.
- A lightweight periodic alignment check if Facebook changes layout without firing expected events.

## Leaflet Setup

Initialize Leaflet inside `#transit-overlay-container`.

Use Leaflet as a transparent renderer only:

- Do not add base map tiles.
- Disable attribution.
- Disable zoom controls.
- Disable dragging.
- Disable keyboard navigation.
- Disable scroll wheel zoom.
- Disable double-click zoom.
- Disable touch zoom.
- Disable box zoom.

Facebook's map handles all user interaction. Leaflet mirrors the visible map state and renders station markers.

## Station Rendering

Load `data/vancouver-stations.geojson` with `chrome.runtime.getURL()` and `fetch()`.

Render station markers above simplified route lines.

Recommended marker styling:

- Use `L.circleMarker`.
- Radius: `5` or `6`.
- Fill color: white or a line-specific color.
- Stroke color: dark navy or black.
- Stroke weight: `2`.
- Fill opacity: `0.9`.
- Marker pane should remain visually above the Facebook map.

Line color mapping for station styling:

- Expo: `#005596`
- Millennium: `#FFCD00`
- Canada: `#00A7E1`
- Shared station fallback: dark neutral stroke with a white fill.

MVP interactivity:

- Station hover tooltip with station name and line.
- Keep hover non-intercepting so Marketplace listing clicks still pass through.

## Route Line Rendering

Load `data/vancouver-lines.geojson` with `chrome.runtime.getURL()` and `fetch()`.

Route line behavior:

- Render station-to-station `LineString` features below station markers.
- Include Expo main branch, Expo Production Way branch, Millennium Line, Canada Richmond branch, and Canada YVR branch.
- Keep route lines `pointer-events: none`.
- Use line-specific colors with moderate opacity.
- Store line visibility for Expo, Millennium, and Canada in `chrome.storage.local`; default all visible.

## Synchronization Engine

The extension should mirror Facebook's current map state into Leaflet.

Primary sync:

- Parse latitude and longitude from the Facebook Marketplace URL when available.
- Read the current Facebook map tile `z` value from visible `map_tile.php` image URLs when available.
- Call `leafletMap.setView([latitude, longitude], adjustedZoom, { animate: false })`.

URL monitoring:

- Patch or listen around `history.pushState`.
- Patch or listen around `history.replaceState`.
- Listen for `popstate`.
- Poll `window.location.href` as a fallback.

Performance requirements:

- Throttle sync work with `requestAnimationFrame` or a short debounce.
- Avoid calling `setView()` when the parsed center and zoom have not changed.
- Keep a configurable zoom offset, defaulting to `0`, for development-only calibration.
- Use visual pan smoothing during drag so stations move with Facebook's map while URL state catches up.

Failure behavior:

- If latitude, longitude, or zoom cannot be parsed, do not render the overlay in an obviously wrong position.
- Keep the overlay initialized but visually hidden until valid map state is available.

## Toggle UI

Inject a compact Transit toggle button inside the detected map area.

Behavior:

- Button label: `Transit`.
- Button state: active or inactive.
- Clicking the button shows or hides the station overlay.
- Persist state with `chrome.storage.local`.
- Restore persisted state on load.
- Button must use `pointer-events: auto`.
- The rest of the overlay must remain click-through.

Recommended placement:

- Top-right corner inside the map bounds.
- Avoid overlapping Facebook's main navigation, dialogs, or listing cards.

## Implementation Tasks

1. Create the extension scaffold.
2. Add Manifest V3 configuration.
3. Bundle Leaflet locally under `vendor/`.
4. Create `data/vancouver-stations.geojson`.
5. Implement content-script asset loading.
6. Implement Facebook Marketplace map detection.
7. Inject and align the transparent overlay.
8. Initialize a tileless, non-interactive Leaflet map.
9. Load and render station GeoJSON markers.
10. Load and render route-line GeoJSON.
11. Implement URL center and tile-zoom synchronization.
12. Add pan smoothing during map drag.
13. Add hover-only station details.
14. Add the Transit toggle button.
15. Persist toggle and line visibility state with `chrome.storage.local`.
16. Test on Facebook Marketplace Vancouver map pages.
17. Document installation and manual testing steps in `README.md`.

## Test Plan

Manual Chrome extension testing:

- Load the project as an unpacked extension.
- Open Facebook Marketplace.
- Navigate to a Vancouver map search.
- Confirm the extension activates only on Marketplace pages.
- Confirm Vancouver SkyTrain stations appear over the map.
- Confirm route lines appear below station markers.
- Pan the Facebook map and confirm markers remain aligned.
- Zoom the Facebook map and confirm markers remain aligned.
- Hover known stations and confirm non-intercepting station details appear.
- Resize the browser and confirm the overlay still matches the map bounds.
- Scroll the page and confirm the overlay remains positioned over the map.
- Click Marketplace listings and confirm clicks pass through the overlay.
- Toggle Transit off and confirm station markers disappear.
- Toggle Transit on and confirm station markers reappear.
- Refresh the page and confirm toggle state persists.
- Navigate within Facebook without a full reload and confirm the extension re-detects the map.
- Open DevTools and confirm no major console errors.
- Confirm the Network panel shows no external transit API calls.

Data validation:

- Validate `data/vancouver-stations.geojson` as legal GeoJSON.
- Validate `data/vancouver-lines.geojson` as legal GeoJSON.
- Run `node scripts/validate-data.js`.
- Confirm every feature is a `Point`.
- Confirm every feature has `station_name`.
- Confirm every feature has `line`.
- Confirm every coordinate pair uses longitude, latitude order.
- Spot-check major stations such as Waterfront, Commercial-Broadway, Broadway-City Hall, Metrotown, Bridgeport, Richmond-Brighouse, YVR-Airport, Lougheed Town Centre, Production Way-University, and Lafarge Lake-Douglas.

## Risks And Mitigations

Facebook DOM changes:

- Use multiple detection strategies instead of depending on a single selector.
- Re-run map detection after DOM mutations and SPA navigation.

Facebook URL parameter changes:

- Keep URL parsing isolated in one function.
- Add logging in development mode when map state cannot be parsed.
- Keep the overlay hidden rather than incorrectly aligned.

Leaflet and Facebook zoom mismatch:

- Use a configurable zoom offset.
- Tune after visual testing on known stations.

Overlay blocking Marketplace interactions:

- Keep the overlay container `pointer-events: none`.
- Enable pointer events only on the Transit toggle.
- Keep station markers, route lines, and hover tooltips click-through.

Stale station data:

- Accept this for the MVP because schedules and real-time data are out of scope.
- Keep the station file simple and manually maintainable.

Extension asset loading failures:

- Register all local assets in `web_accessible_resources`.
- Use `chrome.runtime.getURL()` for bundled resources.

## Future Work

Do not include these in the MVP unless the MVP is already stable:

- Global city support.
- Multiple transit agencies.
- Exact GTFS track geometry.
- Bus, SeaBus, or West Coast Express data.
- Schedule lookup.
- Live arrivals.
- Service alerts.
- Walking-time calculations.
- Options page for city selection.
- Automatic data update pipeline.

The architecture should leave room for future global support by keeping station data loading, map sync, and rendering logic modular.
