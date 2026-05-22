# Transit Time Plan

## Implementation Status

Initial implementation is complete for the offline data foundation and MVP UI:

- Added a bundled city-pack index and Vancouver city pack.
- Added City of Vancouver address lookup data.
- Added TransLink GTFS bus stop locations.
- Added SkyTrain stations as `metro` stops in the same transit-stop pack.
- Added a shared city grid tying addresses and transit stops to the same cell ids.
- Added a Commute panel with destination input, address suggestions, and Bus/SkyTrain toggles.
- Added persisted destination and mode state with `chrome.storage.local`.
- Added rough listing-to-destination commute estimates to the existing hover tooltip.

Known limitation:

- Current commute estimates are rough offline estimates, not full scheduled GTFS routing. Bus/SkyTrain support now uses compact GTFS route edges when possible, shows route numbers, and omits wait time from both the calculation and tooltip. Full time-dependent GTFS routing remains future work.

## Goal

Add offline transit-time estimates from visible Facebook Marketplace rental listings to a user-entered destination address.

The feature should let the user enter an address in a small extension panel, choose whether transit can use buses and/or SkyTrain, and then see estimated transit times from listings to that destination.

This is a planning document only. Do not implement runtime code from this file until the data strategy and UI behavior are validated.

## Scope

First version:

- Vancouver / Metro Vancouver only.
- Chrome/Chromium MV3 only.
- Offline after extension install.
- No backend.
- No live routing API.
- No live geocoding API.
- No live arrivals.
- No disruption alerts.
- No fare calculation.
- No accessibility routing.
- No biking, driving, rideshare, SeaBus, or West Coast Express in the first pass.

Supported transit modes:

- SkyTrain / metro.
- Bus.
- Combined bus + SkyTrain if both toggles are enabled.

The user-facing mode labels should probably say:

- `SkyTrain`
- `Bus`

Internally, code can use mode names like `metro` and `bus`.

## Product Definition

The user should be able to:

1. Open a compact `Commute` or `Transit Time` panel.
2. Enter a destination address.
3. Select allowed transit modes:
   - SkyTrain toggle
   - Bus toggle
4. Save the destination locally.
5. Hover or inspect visible Marketplace listing markers.
6. See estimated transit time from that listing to the saved destination.

Example listing tooltip:

```text
To 555 W Hastings
~28 min transit
7 min walk + Expo Line + 5 min walk
```

If exact schedule data is not available for the selected time:

```text
~31 min typical transit
```

Wording should clearly distinguish:

- `~` for offline estimated or scheduled-static results.
- `typical` for frequency/average-headway estimates.
- `No route found` when the enabled modes cannot produce a usable path.

## Core Constraint: Offline Address Input

An address text box does not produce coordinates by itself.

Because this feature must work offline without a backend, the project needs one of these strategies:

### Option A: Bundled Offline Address Index

Generate a Metro Vancouver address/POI index at build time and bundle it with the extension.

Runtime behavior:

- User types an address.
- Extension searches the bundled local index.
- User picks a suggested match.
- Destination is stored as coordinates plus display text.

Pros:

- Works offline.
- Private.
- Fits the no-backend architecture.
- Good UX once built.

Cons:

- Requires a data generation pipeline.
- Address data can be large.
- Address matching quality must be validated.
- Incomplete address data will cause user frustration.

This is the recommended long-term offline approach.

### Option B: Map Pin / Coordinate Input Fallback

Let the user choose a destination by:

- Entering latitude/longitude.
- Clicking a map point.
- Selecting one of the known SkyTrain stations.
- Selecting a saved destination.

Pros:

- Works offline without a full address index.
- Useful for diagnostics and early testing.
- Avoids pretending address geocoding is solved.

Cons:

- Less natural than address input.
- Does not fully satisfy the desired address-input UX.

This should be included as a fallback even if address search exists.

### Option C: External Geocoding API

Use an online geocoder.

Reject for this feature phase.

Reasons:

- Violates the no-backend/offline requirement.
- Adds privacy, key management, rate limit, latency, and host-permission issues.

## Core Routing Decision

Use offline static transit packs generated from GTFS and walking packs.

Runtime should not call any transit or mapping service. It should load local data and compute routes in the browser.

Required data:

- Destination coordinate from local address index or pin fallback.
- Listing coordinate from existing marker projection.
- Walking access from listing to nearby stops/stations.
- Walking egress from nearby stops/stations to destination.
- Transit stop coordinates.
- Transit routes.
- Trips / stop sequences / service calendars, or simplified frequency profiles.
- Mode metadata for route filtering.

## Unified City Mobility Pack

Yes: the walking-time grid and address grid should be bundled together as one logical city mobility pack.

This should make the feature better because the same spatial cells can serve multiple jobs:

- Offline address search.
- Snapping listing coordinates to the walking graph.
- Snapping destination coordinates to the walking graph.
- Finding nearby transit stops and stations.
- Finding nearby POIs, stations, or known places for destination suggestions.
- Loading only the data needed for the active city or active map area.

Recommended design:

- Use one shared grid system per city pack.
- Store address entries, walking graph references, transit stops, and POIs against the same grid cell ids.
- Keep one lightweight city-pack manifest that describes available resources and bounds.
- Physically split large datasets into separate resources or chunks if needed, but treat them as one logical pack at runtime.

This is better than maintaining separate unrelated `walking`, `geocoder`, and `transit` indexes because separate grids duplicate bounds, cell lookup logic, coordinate quantization, and cache behavior.

Recommended logical pack:

```text
data/city-packs/index.json
data/city-packs/vancouver/manifest.json
data/city-packs/vancouver/grid.json
data/city-packs/vancouver/addresses.json
data/city-packs/vancouver/walking.json
data/city-packs/vancouver/transit.json
data/city-packs/vancouver/poi.json
```

The pack can still be bundled with the extension and loaded with `chrome.runtime.getURL(...)`. "Unified" should mean shared indexing and shared city metadata, not necessarily one giant JSON file.

Example city pack manifest:

```json
{
  "id": "vancouver",
  "name": "Metro Vancouver",
  "version": 1,
  "bounds": {
    "west": -123.35,
    "south": 49.0,
    "east": -122.45,
    "north": 49.45
  },
  "grid": {
    "type": "fixed-lat-lng",
    "cellSizeMeters": 250,
    "resource": "grid.json"
  },
  "resources": {
    "addresses": "addresses.json",
    "walking": "walking.json",
    "transit": "transit.json",
    "poi": "poi.json"
  }
}
```

Example shared grid cell:

```json
{
  "id": "vancouver:142:087",
  "bounds": [-123.124, 49.278, -123.121, 49.281],
  "addressRangeIds": [1234, 1235],
  "walkEdgeIds": [882, 883, 884],
  "transitStopIds": [51, 52],
  "poiIds": [7]
}
```

Runtime flow:

1. Detect active city from map center or destination coordinate.
2. Load that city pack manifest.
3. Load the shared grid.
4. For destination input, search address/POI entries using text tokens, then rank by grid proximity.
5. For listing and destination routing, use the same grid cell to find nearby walking edges and transit stops.
6. Route using the walking and transit resources.

Implementation caution:

- A single monolithic file would be simpler but may parse slowly and use too much memory.
- Prefer a single logical pack with shared cell ids, plus physical resource splitting.
- If the Vancouver walking pack remains large, split walking graph data by grid tile or district before adding a full address index and bus pack.

## Routing Accuracy Levels

Plan for two levels.

### Level 1: Typical-Time Transit Estimates

Use static route geometry, representative travel times, and average wait/headway by time bucket.

Example:

```text
walk to stop/station
+ average wait
+ in-vehicle time
+ transfer walk/wait
+ walk to destination
```

Pros:

- Smaller data.
- Faster runtime.
- Stable offline behavior.
- Good enough for apartment search comparisons.

Cons:

- Not an exact departure-time itinerary.
- Cannot reflect service gaps precisely.
- Needs careful labeling as typical/estimated.

This is recommended for the first transit-time MVP.

### Level 2: Scheduled GTFS Routing

Use `calendar`, `calendar_dates`, `trips`, `stop_times`, `routes`, and `stops` from GTFS to compute time-dependent journeys.

Pros:

- More accurate for a chosen departure time.
- Can reflect service frequency and late-night gaps better.

Cons:

- More data.
- More complex routing.
- Needs timezone/date/service-day handling.
- Static GTFS becomes stale unless regenerated periodically.

This should be a second phase after Level 1 is usable.

## Recommended MVP

Build a static, offline, typical-time router first.

MVP assumptions:

- Use current local time or a user-selectable time bucket later.
- Estimate wait time from headway profiles.
- Use walking pack for access/egress where available.
- Fall back to direct walking estimates where graph snapping fails.
- Support SkyTrain-only and bus+SkyTrain routing.
- Support bus-only only if bus toggle is enabled and SkyTrain toggle is disabled.
- Display route summary, not turn-by-turn directions.

Example output shape:

```js
{
  totalMinutes: 28,
  confidence: "typical",
  accessWalkMinutes: 6,
  egressWalkMinutes: 5,
  transitMinutes: 17,
  transfers: 0,
  legs: [
    {
      type: "walk",
      minutes: 6,
      to: "Commercial-Broadway Station"
    },
    {
      type: "metro",
      line: "Expo",
      from: "Commercial-Broadway",
      to: "Burrard",
      minutes: 17
    },
    {
      type: "walk",
      minutes: 5,
      to: "555 W Hastings St"
    }
  ]
}
```

## User Panel Plan

Add a compact panel anchored near the existing Transit toggle.

Possible title:

```text
Commute
```

Panel contents:

- Destination input.
- Search result suggestions.
- Saved selected destination display.
- `SkyTrain` toggle.
- `Bus` toggle.
- Optional `Now` / time-bucket selector later.
- Clear destination button.

Required behavior:

- Panel must not cover too much of the map.
- Panel controls can use `pointer-events: auto`.
- Map overlay, station markers, route lines, walking-time tooltips, and transit-time tooltips remain click-through.
- Destination and mode settings persist in `chrome.storage.local`.
- If both `SkyTrain` and `Bus` are off, show a validation message and do not compute routes.

Suggested storage keys:

```text
vancouverTransitCommuteDestination
vancouverTransitCommuteModes
vancouverTransitCommutePanelOpen
```

Suggested stored destination shape:

```js
{
  label: "555 W Hastings St, Vancouver",
  lat: 49.2848,
  lng: -123.1119,
  source: "offline-address-index"
}
```

Mode settings:

```js
{
  metro: true,
  bus: false
}
```

## Address Search Plan

Add generated offline address resources inside the unified city mobility pack.

Possible files:

```text
data/city-packs/index.json
data/city-packs/vancouver/manifest.json
data/city-packs/vancouver/addresses.json
scripts/build-geocoder-pack.js
```

Index entry:

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
  "resource": "data/city-packs/vancouver/manifest.json"
}
```

Address pack entry:

```json
{
  "label": "555 W Hastings St, Vancouver",
  "tokens": ["555", "w", "west", "hastings", "st", "street", "vancouver"],
  "lat": 49.2848,
  "lng": -123.1119,
  "kind": "address"
}
```

Search behavior:

1. Normalize input.
2. Tokenize text.
3. Match exact civic number + street first.
4. Match street/intersection/POI next.
5. Use the shared city grid to favor candidates near the current map center or previously selected area.
6. Return top 5 suggestions.

Minimum viable address search can start with:

- Known stations.
- Common universities, hospitals, and downtown landmarks.
- User-entered latitude/longitude.
- Later expand to full address points.

This allows the panel UX to be built before the full address index exists.

## Transit Data Pack Plan

Add static transit resources inside the unified city mobility pack, generated offline from GTFS.

Possible files:

```text
data/city-packs/index.json
data/city-packs/vancouver/manifest.json
data/city-packs/vancouver/transit.json
scripts/build-transit-pack.js
```

Transit pack contents:

```js
{
  version: 1,
  cityId: "vancouver",
  generatedAt: "...",
  source: "TransLink GTFS static",
  bounds: {},
  stops: [],
  routes: [],
  patterns: [],
  transfers: [],
  headways: [],
  typicalTravelTimes: []
}
```

Recommended compact data model:

- `stops`: compact stop id, lat, lng, name, modes.
- `routes`: route id, name, mode, color.
- `patterns`: ordered stop sequences for common route variants.
- `segmentTimes`: typical travel minutes between adjacent stops by route pattern.
- `headways`: average wait by route and time bucket.
- `transfers`: walkable transfer links between nearby stops/stations.

Modes:

```text
metro
bus
```

Data size needs attention. Full bus GTFS can be much larger than the current station/line overlay data.

## Routing Algorithm Plan

Use a small multimodal graph.

Graph nodes:

- Listing origin point.
- Destination point.
- Nearby access stops/stations.
- Transit stops/stations.

Graph edges:

- Walking from origin to nearby stops.
- Walking from nearby stops to destination.
- Transit edges along route patterns.
- Transfer walking edges between nearby stops/stations.
- Optional waiting cost on transit boarding edges.

Search:

- Use Dijkstra for MVP.
- Use A* later if graph size requires it.
- Limit access stops:
  - nearest `N` stops/stations within a max walk distance
  - example: `N = 8`, max walk `1200m`
- Limit egress stops similarly around destination.
- Filter transit edges by enabled modes.
- Add wait penalty when boarding a route.
- Add transfer penalty when changing route/mode.

Mode filter examples:

- SkyTrain on, bus off: route only through `metro` edges.
- Bus on, SkyTrain off: route only through `bus` edges.
- Both on: allow both and transfers between them.

Initial constants:

```js
TRANSIT_ACCESS_WALK_MAX_METERS: 1200
TRANSIT_ACCESS_STOP_LIMIT: 8
TRANSIT_TRANSFER_PENALTY_MINUTES: 3
TRANSIT_DEFAULT_BUS_WAIT_MINUTES: 6
TRANSIT_DEFAULT_METRO_WAIT_MINUTES: 4
TRANSIT_MAX_RESULT_MINUTES: 120
```

## Integration With Existing Walking Packs

Use the existing walking-time infrastructure for:

- Listing marker coordinate projection.
- Road-aware walking time from listing to nearby stops.
- Road-aware walking time from destination to nearby stops.
- Direct walking fallback if graph pack is unavailable.

Needed extension:

- Walking packs currently focus on nearest stations.
- Transit routing needs walking access to arbitrary stops, especially bus stops.
- For bus support, the walking pack must support stop snapping or general graph-node distance queries.

This is a major implementation point. Bus routing is not just "turn on bus GTFS"; access/egress to many bus stops must also work offline.

The walking pack should become part of the unified city mobility pack.

Required changes to the data model:

- Keep the current road-aware walking graph and edge-cell index.
- Add address and POI entries that reference the same grid cells.
- Add transit stops/stations that reference the same grid cells.
- Support a generic "nearest walkable graph edge" query for any coordinate, not only listing markers.
- Support a generic "nearby transit stops" query from the shared grid.

This creates one spatial foundation:

```text
coordinate -> grid cell -> nearby walk edges / stops / addresses / POIs
```

That foundation can power:

- Existing walking time to nearest station.
- Destination address search.
- Listing-to-destination walking access.
- Destination-to-transit egress.
- Bus and SkyTrain stop lookup.

Planning decision:

- Do not build a separate address grid if the walking grid is already good enough for spatial lookup.
- If the walking grid cell size is too coarse for address search, keep a text-search index for addresses but still store each address's spatial cell id from the shared grid.

## UI Output Plan

When hovering a listing marker and a destination is set:

Show a commute tooltip section below or beside the walking-time tooltip.

Example:

```text
To 555 W Hastings
~28 min transit
Expo Line from Commercial-Broadway
```

For bus + SkyTrain:

```text
~34 min transit
Walk 5m -> 99 B-Line -> Canada Line
```

If no route:

```text
No transit route found
Try enabling Bus or SkyTrain
```

Avoid showing too much detail in the map tooltip. A later expanded view can show full legs.

## Implementation Phases

### Phase 1: Destination Panel Shell

Planning target:

- Add a small panel UI.
- Address input field.
- SkyTrain and Bus toggles.
- Persist selected destination and modes.
- No real routing yet.

Implementation should wait until this plan is approved.

### Phase 2: Offline Destination Resolution

Add destination lookup without backend.

Start with:

- Lat/lng parser.
- Known station selector.
- Small bundled POI/address sample pack.

Then expand to:

- Generated Metro Vancouver address index.
- Suggestion ranking.
- Address-pack validation.

Success:

- User can reliably select a destination coordinate offline.

### Phase 2.5: Unified City Pack Foundation

Before full bus routing, consolidate address, walking, POI, and transit-stop spatial lookup around one city pack manifest and shared grid.

Tasks:

- Define `data/city-packs/index.json`.
- Define `data/city-packs/vancouver/manifest.json`.
- Move or wrap the Vancouver walking pack under the city-pack manifest.
- Add shared grid metadata.
- Attach address/POI entries to shared grid cell ids.
- Attach transit stops/stations to shared grid cell ids.
- Add validation for cross-resource references.

Success:

- Address lookup, walking graph snapping, and nearby stop lookup all use one city-pack loader and one spatial cell model.

### Phase 3: SkyTrain-Only Transit MVP

Start with SkyTrain because current station data and route lines already exist.

Compute:

- Walk from listing to nearby SkyTrain station.
- In-vehicle time between stations.
- Walk from destination-nearest station to destination.

Data needed:

- Station-to-station travel times.
- SkyTrain transfer rules.
- Optional average wait by line.

Success:

- With Bus off and SkyTrain on, listings show plausible commute estimates to the destination.

### Phase 4: Static GTFS Transit Pack

Generate a compact transit pack from GTFS.

Include:

- Bus stops.
- Bus route patterns.
- Typical segment travel times.
- Headway estimates.
- SkyTrain as metro routes.
- Transfer links.

Success:

- Runtime can load the pack and route across bus and metro edges offline.

### Phase 5: Bus + SkyTrain Routing

Enable the Bus toggle.

Tasks:

- Add bus access/egress stop search.
- Add mode filtering.
- Add transfers.
- Add route summaries.
- Add no-route messaging.

Success:

- With both toggles enabled, the router can find plausible multimodal routes.

### Phase 6: UX Tuning

Refine:

- Tooltip density.
- Panel placement.
- Saved destinations.
- Clear/edit destination behavior.
- Result labels for typical vs scheduled estimates.
- Performance on many visible markers.

## Data Validation Plan

Extend validation scripts when implementation starts.

Validate geocoder pack:

- Coordinates are valid.
- Labels are non-empty.
- Tokens are normalized.
- Entries fall inside pack bounds.
- Duplicate labels are handled.
- Pack size is within budget.

Validate unified city pack:

- Manifest resources exist.
- City bounds contain address, walking, POI, and transit coordinates.
- Shared grid cell ids are unique.
- Address entries reference valid grid cells.
- Walking edges reference valid grid cells.
- Transit stops reference valid grid cells.
- POIs reference valid grid cells.
- Cross-resource references are internally consistent.
- Chunked resources can be loaded independently.

Validate transit pack:

- Stops have valid coordinates.
- Routes have supported modes.
- Patterns reference existing stops.
- Segment times are positive.
- Headways are positive.
- Transfers reference existing stops.
- Pack bounds match stop coordinates.

Validate routing:

- No negative edge weights.
- No impossible zero-time transit segments.
- Mode filters exclude disabled modes.
- Known station-to-station examples produce plausible times.

## Performance Plan

Risks:

- Bus data can be large.
- Address index can be large.
- Routing on every pointer move could become expensive.

Mitigations:

- Lazy-load the active city mobility pack.
- Split large city-pack resources by concern or grid chunk instead of parsing one monolithic JSON file.
- Cache selected destination coordinate.
- Cache visible listing marker route results by rounded coordinate and mode settings.
- Recompute only after map movement, mode change, destination change, or marker candidate refresh.
- Limit access/egress stops.
- Keep route graph compact.
- Use Web Worker later if main-thread routing causes UI jank.

## Privacy Plan

Because the feature is offline:

- Destination address should stay local in `chrome.storage.local`.
- No destination or listing coordinates should be sent over the network.
- No analytics should be added.
- Debug logs should avoid printing full user-entered addresses unless `DEBUG = true`.

## Testing Plan

Manual tests:

- Enter a destination address.
- Select a suggested destination.
- Toggle SkyTrain on/off.
- Toggle Bus on/off.
- Confirm both-off state is handled.
- Hover visible listing markers.
- Confirm transit-time tooltip appears only when destination is set.
- Confirm Marketplace clicks still work.
- Confirm tooltip clears during pan and zoom.
- Test known trips:
  - Commercial-Broadway to Downtown.
  - Metrotown to Downtown.
  - Richmond-Brighouse to Downtown.
  - UBC-adjacent destination with Bus enabled.
  - YVR-adjacent destination with SkyTrain enabled.
- Compare results against common-sense expected travel times.

Local checks:

```sh
for f in content.js scripts/*.js; do node --check "$f" || exit 1; done
node scripts/validate-data.js
python3 -m json.tool manifest.json
```

Future route regression tests:

- Build a small static fixture graph.
- Test mode filters.
- Test transfer penalties.
- Test no-route behavior.
- Test destination persistence serialization.

## Open Questions

- Should the destination be "work/school" style saved destinations, or just one active destination?
- Should results use current time, morning commute, evening commute, or all-day typical times?
- Should the first version support only SkyTrain before buses?
- How large is an acceptable bundled address index?
- How large is an acceptable bundled bus transit pack?
- Should sidebar listing cards also show transit time once map marker routing works?
- Should transit results appear in the same tooltip as walking time or in a separate commute tooltip?

## Recommendation

Implement in this order after planning approval:

1. Panel shell and local state.
2. Offline destination selection with lat/lng and small known-place pack.
3. Unified city mobility pack manifest and shared grid.
4. SkyTrain-only transit estimates.
5. Full offline address resources inside the city pack.
6. Bus + SkyTrain static transit resources inside the city pack.

Do not start with buses. Bus support requires a much larger stop graph, transfer model, and offline access/egress strategy. SkyTrain-only routing will prove the destination panel, mode toggles, local persistence, and result UI with much less risk.

The walking grid and address grid should not evolve as separate systems. Use one shared city grid where possible, with separate text-search data for addresses only where text matching requires it.
