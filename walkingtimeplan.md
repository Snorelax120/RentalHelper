# Walking Time Plan

## TODOs

- [x] Add walking-time constants to `scripts/config.js`.
- [x] Add `scripts/walking-time.js`.
- [x] Build and cache a SkyTrain station coordinate index.
- [x] Compute nearest stations with Haversine distance, circuity factor, and estimated walking minutes.
- [x] Detect visible price-like listing marker candidates inside the selected Marketplace map.
- [x] Classify marker anchors as bottom-center price bubbles or center circular markers.
- [x] Project marker anchors into Leaflet latitude/longitude coordinates.
- [x] Expose debug helpers for nearest-station estimates and listing marker candidates.
- [x] Load the walking-time module from `manifest.json`.
- [x] Clear walking-time diagnostic cache during overlay hide, pan smoothing, and zoom settling.
- [x] Add hover-only walking-time tooltip.
- [x] Ensure tooltip remains click-through and does not interfere with listing clicks or map controls.
- [x] Document the no-backend global walking-time architecture.
- [x] Add bundled city-pack support for future global/offline release.
- [x] Add a Vancouver walking pack resource.
- [x] Add runtime support for precomputed pedestrian graph packs.
- [x] Add graph-edge snapping from listing coordinates to the nearest walkable edge.
- [x] Add support for precomputed node-to-station walking distances.
- [x] Add a build-time script for generating walking packs from OSM/Overpass data.
- [x] Keep direct straight-line estimates as the fallback when no graph pack exists.
- [x] Generate a real Vancouver OSM pedestrian graph pack.
- [x] Replace the current Vancouver fallback pack with the generated graph pack.
- [x] Add a runtime edge-cell index so snapping does not scan every graph edge on each hover.
- [x] Reduce Vancouver graph pack size by limiting generated graph distances to the nearest 2 stations within 4 km walking distance.
- [x] Compact generated node IDs and coordinate precision.
- [x] Label direct fallback times as `est.` while graph-based times use `~`.
- [ ] Validate marker detection on live Facebook Marketplace map pages.
- [ ] Tune marker candidate filters based on live diagnostic output.
- [ ] Validate road-aware Vancouver walking times near barriers, bridges, station entrances, and block ends.
- [ ] Further compress or split the Vancouver walking pack if 41 MB uncompressed remains too large for release.
- [ ] Decide whether walking times should use only the Transit toggle or need a separate control.
- [ ] Add additional city packs only after the Vancouver pack is validated.

## Goal

Add estimated walking times from Facebook Marketplace rental map listings to the nearest Vancouver SkyTrain station, with support for showing either the nearest station or the nearest few stations.

This plan now tracks both implemented walking-time runtime work and the remaining validation/generation work.

## Scope

Keep the first version aligned with the current project constraints:

- Vancouver SkyTrain only.
- Static bundled station data only.
- Static bundled walking-time city packs only.
- No transit schedules.
- No live arrivals.
- No external routing, geocoding, or transit APIs at runtime.
- No backend service.
- No live global city support yet; the code should be ready for additional bundled city packs.
- No changes that interfere with Facebook Marketplace listing clicks or map controls.

The walking-time MVP should answer:

```text
From this visible listing marker, what SkyTrain station is probably closest by walking time?
```

## Product Definition

The first successful feature should:

- Detect when the user is hovering a visible Facebook Marketplace listing marker.
- Estimate that marker's latitude/longitude from its screen position on the synced map.
- Compute the nearest SkyTrain station using bundled station coordinates.
- Show a small click-through tooltip with estimated walking time.
- Optionally show the second-nearest station.
- Hide during pan, zoom, map re-sync, or when Transit is toggled off.

Example tooltip:

```text
Broadway-City Hall
~7 min walk

Olympic Village
~11 min walk
```

Use `~` or `est.` because the MVP will be an estimate, not exact pedestrian routing.

## Core Decision: No-Backend City Packs

The global architecture should avoid a backend while still allowing road-aware walking times.

Runtime should support two modes:

1. `precomputed-node-station-distances-v1`
   - Generated offline from OSM pedestrian data.
   - Bundled as a static city pack.
   - Runtime snaps a listing coordinate to the nearest walkable edge.
   - Runtime combines distance to each edge endpoint with precomputed node-to-station distances.
   - This handles block-end differences much better than grid or straight-line estimates.

2. `direct-estimate`
   - Uses Haversine straight-line distance plus circuity factor.
   - Used when a city has no graph pack yet or graph snapping fails.
   - Must stay clearly labeled as estimated.

Runtime formula for graph packs:

```text
listing_lat_lng -> nearest walkable edge
edge_snap -> endpoint A and endpoint B
station_walk_meters =
  min(
    snap_to_A_meters + precomputed_A_to_station_meters,
    snap_to_B_meters + precomputed_B_to_station_meters
  )
walking_minutes = station_walk_meters / WALKING_SPEED_METERS_PER_MINUTE
```

This is the best no-backend global approach because it keeps user locations private, avoids runtime API costs, and can be extended city by city through extension updates.

Vancouver now has a generated `precomputed-node-station-distances-v1` pack built from OSM/Overpass walking-network data. The current release-sized pack stores the nearest 2 station distances for walkable graph nodes within 4 km of a SkyTrain station. Farther points fall back to direct estimates. The generated JSON is about 41 MB uncompressed and about 9.9 MB gzip-compressed. The remaining release risk is validation against live map examples near barriers, bridges, station entrances, and block ends.

## Fallback Decision: Estimate First

Start with estimated walking time, not exact routed walking time.

Reason:

- We already have reliable static SkyTrain station coordinates.
- Straight-line distance math is simple, fast, private, and offline.
- Exact walking routes need either an external routing API or a bundled pedestrian street graph.
- External APIs add latency, keys, cost, privacy concerns, and rate limits.
- A bundled walking graph is possible later, but it is a separate data-engineering project.

MVP formula:

```text
straight_line_meters = haversine(listing, station)
estimated_walk_meters = straight_line_meters * WALKING_CIRCUITY_FACTOR
walking_minutes = estimated_walk_meters / WALKING_SPEED_METERS_PER_MINUTE
```

Initial constants:

- Walking speed: `4.8 km/h`
- Walking speed in meters/minute: `80`
- Circuity factor: `1.25`
- Minimum displayed time: `1 min`
- Rounding: nearest whole minute
- Default result count: `2`

These constants should live in `scripts/config.js` when implementation starts.

## Main Risk

The hard part is not nearest-station math. The hard part is getting a reliable coordinate for a Facebook Marketplace listing.

Facebook listing markers are visible on the map, but Facebook does not expose a stable public API for listing coordinates. The MVP should avoid depending on internal React state unless diagnostics prove there is no better option.

## Listing Coordinate Strategies

### Strategy A: Project Visible Listing Marker Position

Use the current synced Leaflet overlay to convert a Facebook listing marker's screen position into latitude/longitude.

Flow:

1. Detect visible listing marker candidates inside `state.mapElement`.
2. Read each candidate's `getBoundingClientRect()`.
3. Choose an anchor point:
   - price bubble: bottom center
   - circular marker: center
   - cluster: ignore for MVP unless it is clearly a single listing
4. Convert viewport coordinates into overlay container coordinates.
5. Use `state.leafletMap.containerPointToLatLng()`.
6. Compute nearest station results from the derived coordinate.

This is the recommended MVP approach.

Pros:

- Fits the current overlay architecture.
- Avoids external APIs.
- Avoids parsing Facebook internal data.
- Works for visible markers immediately.

Cons:

- Accuracy depends on overlay sync and marker anchor detection.
- Facebook may change marker DOM structure.
- Some markers may represent clusters or approximate positions.

### Strategy B: Parse Coordinates From Listing Detail State

When a listing is selected or opened, inspect URL parameters, embedded script data, or nearby DOM metadata for latitude/longitude.

Use this only as an investigation fallback.

Pros:

- Could be more accurate if exact coordinates exist.
- Could work for a selected listing even if its marker is not visible.

Cons:

- Brittle.
- More privacy-sensitive.
- More dependent on undocumented Facebook internals.

### Strategy C: Geocode Listing Text

Parse address or neighborhood text and geocode it.

Defer.

Reasons:

- Requires external geocoding or a large local address dataset.
- Marketplace listings often do not show precise addresses.
- Results can be misleading.

## Nearest Station Algorithm

Build a small pure utility:

Input:

```js
{
  lat: 49.263,
  lng: -123.115
}
```

Output:

```js
[
  {
    stationName: "Broadway-City Hall",
    lines: ["Canada"],
    straightLineMeters: 420,
    estimatedWalkMeters: 525,
    estimatedWalkMinutes: 7
  }
]
```

Algorithm:

1. Normalize stations from `state.stationsGeojson`.
2. For each station, compute Haversine distance in meters.
3. Multiply by the circuity factor.
4. Convert to minutes.
5. Sort by estimated walking minutes, then straight-line distance.
6. Return the top `N` stations.

Station count is small, so a linear scan is acceptable.

## Proposed Files

Implementation should happen later in a dedicated module:

```text
scripts/walking-time.js
data/vancouver-walking-pack.json
scripts/build-walking-pack.js
```

Likely responsibilities:

- Build and cache a station coordinate index.
- Detect visible listing marker candidates.
- Project marker anchors into lat/lng.
- Compute nearest station estimates.
- Manage hover state.
- Render and clear walking-time tooltip.
- Expose debug helpers when `DEBUG = true`.
- Load static walking city packs.
- Use graph pack routing when available.
- Fall back to direct estimates when graph data is unavailable.

`data/vancouver-walking-pack.json` responsibilities:

- Declare the Vancouver city-pack bounds.
- Declare the walking-pack routing mode.
- Store precomputed graph nodes, edges, stations, and node-to-station distances once generated.
- Remain a lightweight direct-estimate fallback until the OSM graph pack exists.

`scripts/build-walking-pack.js` responsibilities:

- Read OSM/Overpass walking-network data.
- Read bundled station GeoJSON.
- Build a pedestrian graph.
- Snap stations to graph nodes.
- Run offline shortest-path calculations from station nodes.
- Emit a compact static city pack for extension runtime use.

Potential config additions:

```js
WALKING_SPEED_KMPH: 4.8
WALKING_CIRCUITY_FACTOR: 1.25
WALKING_RESULT_COUNT: 2
WALKING_MARKER_SCAN_MS: 500
WALKING_HOVER_RADIUS_PX: 14
```

Potential storage keys if controls are added:

```text
vancouverTransitWalkingTimesEnabled
vancouverTransitWalkingResultCount
```

## UI Plan

Start with hover-only UI.

Rules:

- Tooltip must use `pointer-events: none`.
- Do not attach click handlers to Facebook listing markers.
- Do not prevent default pointer or click events.
- Do not add labels to every listing marker at once.
- Hide tooltip during pan smoothing, zoom settling, and overlay hide.
- Keep the existing Transit toggle as the master visibility control.

Tooltip content:

- Station name.
- Estimated walking time.
- Line badges or line-colored text.
- Optional second-nearest station.

Avoid in MVP:

- Drawing walking route paths.
- Showing walking times for every listing simultaneously.
- Sidebar cards.
- A large settings panel.

## Marker Detection Plan

Before production UI, add diagnostics behind `DEBUG`.

Candidate filters:

- Element is inside `state.mapElement`.
- Element is visible.
- Element intersects the map rect.
- Element contains price-like text such as `CA$`.
- Element dimensions are marker-like.
- Element is not a Facebook map control.
- Element is not part of the extension overlay.

Temporary debug API:

```js
await window.__transitOverlayDebug.getListingMarkerCandidates()
```

Diagnostic output should include:

- Candidate count.
- Candidate rects.
- Chosen anchor point.
- Projected lat/lng.
- Nearest station estimate.

Success condition:

- Candidate detection reliably identifies visible listing markers across pan/zoom states without picking map controls, station markers, route lines, or sidebar content.

## Coordinate Projection

For a price bubble:

```js
const anchorX = markerRect.left + markerRect.width / 2;
const anchorY = markerRect.bottom;
const containerX = anchorX - overlayRect.left;
const containerY = anchorY - overlayRect.top;
const latLng = state.leafletMap.containerPointToLatLng([containerX, containerY]);
```

For a circular marker:

```js
const anchorX = markerRect.left + markerRect.width / 2;
const anchorY = markerRect.top + markerRect.height / 2;
```

Projection must be disabled while:

- `state.zoomSync.pending` is true.
- Pan smoothing is actively applying a temporary transform.
- The overlay is hidden.
- Map state is invalid.

## Interaction With Existing Overlay

Walking-time UI depends on the current map sync being correct.

Required integration points:

- `T.overlay.updateOverlayVisibility()` should clear walking-time tooltip when overlay hides.
- `T.panSmoothing.clear()` or active pan state should clear walking-time tooltip.
- Zoom-settle logic should clear walking-time tooltip.
- Station hover and walking-time hover must not fight over the same tooltip position.

Possible internal API:

```js
T.walkingTime.start()
T.walkingTime.clear(reason)
T.walkingTime.getNearestStations(latLng, count)
T.walkingTime.getListingMarkerCandidates()
```

## Performance Plan

Expected scale:

- Stations: about 54.
- Visible listing markers: usually dozens.

Performance rules:

- Cache station coordinate data after station GeoJSON loads.
- Scope marker queries to `state.mapElement`.
- Do not scan the entire document on every pointer move.
- Use `requestAnimationFrame` for pointermove work.
- Keep a short-lived marker candidate cache.
- Rebuild candidate cache after pan/zoom/layout changes.

The nearest-station calculation itself is cheap.

## Implementation Phases

### Phase 1: Diagnostics Only

Add marker detection and coordinate projection behind `DEBUG`.

No user-facing UI yet.

Tasks:

- Add candidate detector.
- Add anchor classification.
- Add projection from marker rect to lat/lng.
- Add nearest-station calculation.
- Expose debug method.

Success:

- Hovered or sampled markers project to plausible map coordinates.
- Nearest station results are plausible in Downtown, Broadway, Metrotown, Richmond, and YVR examples.

### Phase 2: Hover Tooltip MVP

Add `scripts/walking-time.js` and a click-through tooltip.

Tasks:

- Register document-level pointermove listener.
- Detect hovered listing marker candidate.
- Compute nearest station results.
- Render tooltip near pointer or marker.
- Clear tooltip during pan/zoom.

Success:

- Hovering visible listing markers shows plausible estimated walking times.
- Marketplace clicks still work.
- Existing station/line overlay still works.

### Phase 3: Controls

Decide whether walking times need separate controls.

Options:

- Follow the existing Transit toggle only.
- Add a small `Walk` toggle.
- Add a setting for nearest `1` vs nearest `2`.

Recommendation:

- MVP should follow the existing Transit toggle.
- Add separate controls only if the tooltip becomes noisy.

### Phase 4: Offline Accuracy Upgrade

Generate and validate a real Vancouver pedestrian graph city pack.

Approach:

- Export or download OSM/Overpass walking data for Metro Vancouver.
- Build an offline preprocessing script from OSM walking data. Completed as `scripts/build-walking-pack.js`.
- Clip to Metro Vancouver.
- Simplify graph.
- Snap stations to graph nodes.
- Snap listing coordinates to nearest graph node.
- Run Dijkstra from station graph nodes during build time.
- Store nearest station distances per graph node.
- At runtime, snap listing coordinates to the nearest graph edge and combine endpoint distances.
- Replace the current direct-estimate Vancouver pack with the generated `precomputed-node-station-distances-v1` pack.

Risks:

- Larger extension package.
- More validation burden.
- More complex preprocessing.
- Pedestrian access data can still be imperfect.

External routing APIs should remain deferred unless the project explicitly accepts runtime dependency, privacy, cost, and rate-limit tradeoffs.

## Testing Plan

Manual tests:

- Load unpacked extension.
- Open Facebook Marketplace map results in Vancouver.
- Confirm station and route overlay still works.
- Hover visible listing markers.
- Confirm tooltip appears only on listing markers.
- Confirm tooltip does not block listing clicks.
- Confirm tooltip clears during pan.
- Confirm tooltip clears during zoom.
- Confirm tooltip does not appear while wrong map projections are hidden.
- Confirm nearest station results are plausible for:
  - Waterfront / Downtown
  - Commercial-Broadway
  - Metrotown
  - Broadway-City Hall
  - Bridgeport
  - Richmond-Brighouse
  - YVR-Airport
- Toggle Transit off and confirm walking-time UI disappears.
- Run `await window.__transitOverlayDebug.getWalkingCityPacks()` and confirm the Vancouver pack is loaded.
- For generated graph packs, confirm `routingMode` is `precomputed-node-station-distances-v1`.
- For the current fallback pack, confirm nearest station results include `estimationSource: "direct-estimate"`.

Local checks:

```sh
for f in content.js scripts/*.js; do node --check "$f" || exit 1; done
node scripts/validate-data.js
python3 -m json.tool manifest.json
python3 -m json.tool data/vancouver-walking-pack.json
```

## Open Questions

- Should the default show nearest `1` station or nearest `2` stations?
- Should walking times appear only on map marker hover, or also when hovering sidebar listing cards?
- Should the tooltip include exact distance, or only minutes?
- Should shared stations show all lines or only the most relevant line?
- What level of inaccuracy is acceptable before we need routed walking paths?

## Recommended Next Step

Start with Phase 1 diagnostics.

The key unknown is whether Facebook listing marker DOM positions can be detected and projected reliably. Once that is proven, nearest-station math and tooltip rendering are straightforward.
