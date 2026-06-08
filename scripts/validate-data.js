#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const allowedLines = new Set(["Expo", "Millennium", "Canada", "Line 1", "Line 2", "Line 4", "Line 5", "Line 6"]);
const requiredWebResources = new Set([
  "data/vancouver-stations.geojson",
  "data/vancouver-lines.geojson",
  "data/vancouver-walking-pack.json",
  "data/toronto-stations.geojson",
  "data/toronto-lines.geojson",
  "data/toronto-walking-pack.json",
  "data/city-packs/index.json",
  "data/city-packs/vancouver/manifest.json",
  "data/city-packs/vancouver/addresses.json",
  "data/city-packs/vancouver/transit.json",
  "data/city-packs/vancouver/grid.json",
  "data/city-packs/toronto/manifest.json",
  "data/city-packs/toronto/addresses.json",
  "data/city-packs/toronto/transit.json",
  "data/city-packs/toronto/grid.json"
]);

function main() {
  const manifest = readJson("manifest.json");
  const stations = readJson("data/vancouver-stations.geojson");
  const lines = readJson("data/vancouver-lines.geojson");
  const walkingPack = readJson("data/vancouver-walking-pack.json");
  const torontoStations = readJson("data/toronto-stations.geojson");
  const torontoLines = readJson("data/toronto-lines.geojson");
  const torontoWalkingPack = readJson("data/toronto-walking-pack.json");
  const cityIndex = readJson("data/city-packs/index.json");
  const cityManifest = readJson("data/city-packs/vancouver/manifest.json");
  const addressPack = readJson("data/city-packs/vancouver/addresses.json");
  const transitPack = readJson("data/city-packs/vancouver/transit.json");
  const cityGrid = readJson("data/city-packs/vancouver/grid.json");
  const torontoCityManifest = readJson("data/city-packs/toronto/manifest.json");
  const torontoAddressPack = readJson("data/city-packs/toronto/addresses.json");
  const torontoTransitPack = readJson("data/city-packs/toronto/transit.json");
  const torontoCityGrid = readJson("data/city-packs/toronto/grid.json");

  validateManifest(manifest);
  const stationMap = validateStations(stations, { minStations: 50 });
  validateLines(lines, stationMap, {
    minFeatures: 5,
    requiredBranches: [
      "Expo:King George",
      "Expo:Production Way-University",
      "Millennium:Lafarge Lake-Douglas",
      "Canada:Richmond-Brighouse",
      "Canada:YVR-Airport"
    ]
  });
  validateWalkingPack(walkingPack);
  const torontoStationMap = validateStations(torontoStations, { minStations: 100 });
  validateLines(torontoLines, torontoStationMap, {
    minFeatures: 5,
    allowApproxCoordinates: true,
    requiredBranches: [
      "Line 1:Line 1 (Yonge-University)",
      "Line 2:Line 2 (Bloor - Danforth)",
      "Line 4:Line 4 (Sheppard)",
      "Line 5:Line 5 Eglinton",
      "Line 6:Line 6 Finch West"
    ]
  });
  validateWalkingPack(torontoWalkingPack);
  validateCityPack({ cityIndex, cityManifest, addressPack, transitPack, cityGrid }, {
    id: "vancouver",
    minAddresses: 50000,
    minStops: 8000,
    minBusStops: 8000,
    minMetroStops: 50,
    minRoutes: 200,
    minRouteEdges: 10000
  });
  validateCityPack({
    cityIndex,
    cityManifest: torontoCityManifest,
    addressPack: torontoAddressPack,
    transitPack: torontoTransitPack,
    cityGrid: torontoCityGrid
  }, {
    id: "toronto",
    minAddresses: 200000,
    minStops: 9000,
    minBusStops: 8500,
    minMetroStops: 100,
    minRoutes: 200,
    minRouteEdges: 10000
  });

  console.log("Validation passed: manifest, station data, route line data, walking packs, and city packs are valid.");
}

function readJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function validateManifest(manifest) {
  assert(manifest.manifest_version === 3, "manifest.json must use Manifest V3.");
  assert(Array.isArray(manifest.content_scripts), "manifest.json must define content_scripts.");

  const resources = new Set(
    (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
  );

  for (const resource of requiredWebResources) {
    assert(resources.has(resource), `manifest.json must expose ${resource} as a web_accessible_resource.`);
  }
}

function validateStations(geojson, options = {}) {
  assert(geojson.type === "FeatureCollection", "Station GeoJSON must be a FeatureCollection.");
  assert(Array.isArray(geojson.features), "Station GeoJSON must contain features.");

  const stationMap = new Map();

  for (const feature of geojson.features) {
    assert(feature.type === "Feature", "Every station entry must be a Feature.");
    assert(feature.geometry?.type === "Point", "Every station geometry must be a Point.");

    const name = feature.properties?.station_name;
    const lines = normalizeLines(feature.properties?.line);
    const coordinates = feature.geometry.coordinates;

    assert(typeof name === "string" && name.trim(), "Every station must have station_name.");
    assert(lines.length > 0, `${name} must have at least one line.`);
    assert(!stationMap.has(name), `Duplicate station_name: ${name}.`);

    for (const line of lines) {
      assert(allowedLines.has(line), `${name} references unknown line ${line}.`);
    }

    assertValidCoordinates(coordinates, `${name} coordinates`);
    stationMap.set(name, {
      coordinates,
      lines
    });
  }

  assert(stationMap.size >= (options.minStations || 1), "Station GeoJSON should contain the expected station set.");
  return stationMap;
}

function validateLines(geojson, stationMap, options = {}) {
  assert(geojson.type === "FeatureCollection", "Route line GeoJSON must be a FeatureCollection.");
  assert(Array.isArray(geojson.features), "Route line GeoJSON must contain features.");
  assert(geojson.features.length >= (options.minFeatures || 1), "Route line GeoJSON must include the required branches.");

  const branches = new Set();

  for (const feature of geojson.features) {
    assert(feature.type === "Feature", "Every route line entry must be a Feature.");
    assert(feature.geometry?.type === "LineString", "Every route line geometry must be a LineString.");

    const line = feature.properties?.line;
    const branch = feature.properties?.branch;
    const stationNames = feature.properties?.station_names;
    const coordinates = feature.geometry.coordinates;

    assert(allowedLines.has(line), `Route line references unknown line ${line}.`);
    assert(typeof branch === "string" && branch.trim(), `${line} route line must have branch.`);
    assert(Array.isArray(stationNames) && stationNames.length >= 2, `${line} ${branch} must list station_names.`);
    assert(Array.isArray(coordinates) && coordinates.length === stationNames.length, `${line} ${branch} coordinate count must match station_names count.`);

    branches.add(`${line}:${branch}`);

    stationNames.forEach((stationName, index) => {
      const station = stationMap.get(stationName);
      assert(station, `${line} ${branch} references missing station ${stationName}.`);
      assert(station.lines.includes(line), `${line} ${branch} references ${stationName}, but the station is not on ${line}.`);
      if (options.allowApproxCoordinates) {
        assertValidCoordinates(coordinates[index], `${line} ${branch} ${stationName}`);
      } else {
        assertCoordinatesEqual(coordinates[index], station.coordinates, `${line} ${branch} ${stationName}`);
      }
    });
  }

  for (const required of options.requiredBranches || []) {
    assert(branches.has(required), `Missing required route branch ${required}.`);
  }
}

function validateWalkingPack(pack) {
  assert(pack.schema === "transit-walking-city-pack", "Walking pack must use transit-walking-city-pack schema.");
  assert(pack.version === 1, "Walking pack version must be 1.");
  assert(typeof pack.id === "string" && pack.id.trim(), "Walking pack must have an id.");
  assert(typeof pack.name === "string" && pack.name.trim(), "Walking pack must have a name.");

  const bounds = pack.bounds;
  assert(bounds && typeof bounds === "object", "Walking pack must define bounds.");
  assertValidCoordinates([bounds.west, bounds.south], "Walking pack southwest bounds");
  assertValidCoordinates([bounds.east, bounds.north], "Walking pack northeast bounds");
  assert(bounds.west < bounds.east, "Walking pack west bound must be less than east bound.");
  assert(bounds.south < bounds.north, "Walking pack south bound must be less than north bound.");

  const routing = pack.routing;
  assert(routing && typeof routing === "object", "Walking pack must define routing metadata.");
  assert(
    ["direct-estimate", "precomputed-node-station-distances-v1"].includes(routing.mode),
    `Walking pack routing mode is unsupported: ${routing.mode}.`
  );
  assert(Array.isArray(routing.nodes), "Walking pack routing.nodes must be an array.");
  assert(Array.isArray(routing.edges), "Walking pack routing.edges must be an array.");

  if (routing.mode === "precomputed-node-station-distances-v1") {
    assert(Array.isArray(routing.stations), "Graph walking pack must include routing.stations.");
    assert(routing.nodes.length > 0, "Graph walking pack must include nodes.");
    assert(routing.edges.length > 0, "Graph walking pack must include edges.");
  }
}

function validateCityPack({ cityIndex, cityManifest, addressPack, transitPack, cityGrid }, options = {}) {
  const id = options.id || cityManifest.id;
  assert(cityIndex.version === 1, "City pack index version must be 1.");
  assert(Array.isArray(cityIndex.packs) && cityIndex.packs.length > 0, "City pack index must contain packs.");
  assert(cityIndex.packs.some((pack) => pack.id === id), `City pack index must include ${id}.`);

  assert(cityManifest.schema === "transit-city-pack", "City manifest must use transit-city-pack schema.");
  assert(cityManifest.id === id, `City manifest id must be ${id}.`);
  validateBounds(cityManifest.bounds, "City manifest bounds");
  assert(cityManifest.resources?.addresses?.resource === "addresses.json", "City manifest must reference addresses.json.");
  assert(cityManifest.resources?.transit?.resource === "transit.json", "City manifest must reference transit.json.");
  assert(cityManifest.grid?.resource === "grid.json", "City manifest must reference grid.json.");

  assert(addressPack.schema === "transit-address-pack", "Address pack schema is invalid.");
  assert(Array.isArray(addressPack.entries), "Address pack entries must be an array.");
  assert(addressPack.entries.length >= (options.minAddresses || 1), "Address pack should include city addresses.");

  const addressCells = new Set();
  for (const [index, entry] of addressPack.entries.entries()) {
    assert(Array.isArray(entry) && entry.length >= 6, `Address entry ${index} must use compact array format.`);
    const [label, search, lat, lng, cellId, kind] = entry;
    assert(typeof label === "string" && label.trim(), `Address entry ${index} must have a label.`);
    assert(typeof search === "string" && search.trim(), `Address entry ${index} must have search text.`);
    assertValidLatLngObject({ lat, lng }, `Address entry ${index}`);
    assert(typeof cellId === "string" && cellId.trim(), `Address entry ${index} must have a cell id.`);
    assert(["address", "station"].includes(kind), `Address entry ${index} has unsupported kind ${kind}.`);
    addressCells.add(cellId);
  }

  assert(transitPack.schema === "transit-stop-pack", "Transit stop pack schema is invalid.");
  assert(Array.isArray(transitPack.stops), "Transit stop pack stops must be an array.");
  assert(Array.isArray(transitPack.routes), "Transit stop pack routes must be an array.");
  assert(Array.isArray(transitPack.routeEdges), "Transit stop pack routeEdges must be an array.");
  assert(Array.isArray(transitPack.transferEdges), "Transit stop pack transferEdges must be an array.");
  assert(transitPack.stops.length >= (options.minStops || 1), "Transit stop pack should include GTFS stops.");
  assert(transitPack.routes.length >= (options.minRoutes || 1), "Transit stop pack should include GTFS routes.");
  assert(transitPack.routeEdges.length >= (options.minRouteEdges || 1), "Transit stop pack should include GTFS route edges.");

  const stopCells = new Set();
  let busCount = 0;
  let metroCount = 0;
  for (const [index, stop] of transitPack.stops.entries()) {
    assert(Array.isArray(stop) && stop.length >= 7, `Transit stop ${index} must use compact array format.`);
    const [id, code, name, mode, lat, lng, cellId] = stop;
    assert(typeof id === "string" && id.trim(), `Transit stop ${index} must have an id.`);
    assert(typeof code === "string", `Transit stop ${index} must have a code string.`);
    assert(typeof name === "string" && name.trim(), `Transit stop ${index} must have a name.`);
    assert(["bus", "metro"].includes(mode), `Transit stop ${index} has unsupported mode ${mode}.`);
    assertValidLatLngObject({ lat, lng }, `Transit stop ${index}`);
    assert(typeof cellId === "string" && cellId.trim(), `Transit stop ${index} must have a cell id.`);
    if (mode === "bus") busCount += 1;
    if (mode === "metro") metroCount += 1;
    stopCells.add(cellId);
  }
  assert(busCount >= (options.minBusStops || 0), "Transit stop pack should include expected bus/surface stops.");
  assert(metroCount >= (options.minMetroStops || 0), "Transit stop pack should include expected rapid transit stops.");

  for (const [index, route] of transitPack.routes.entries()) {
    assert(Array.isArray(route) && route.length >= 4, `Transit route ${index} must use compact array format.`);
    assert(typeof route[0] === "string" && route[0].trim(), `Transit route ${index} must have an id.`);
    assert(typeof route[1] === "string" && route[1].trim(), `Transit route ${index} must have a label.`);
    assert(["bus", "metro"].includes(route[3]), `Transit route ${index} has unsupported mode ${route[3]}.`);
  }

  for (const [index, edge] of transitPack.routeEdges.entries()) {
    assert(Array.isArray(edge) && edge.length >= 4, `Route edge ${index} must use compact array format.`);
    assert(Number.isInteger(edge[0]) && edge[0] >= 0 && edge[0] < transitPack.stops.length, `Route edge ${index} has invalid from stop.`);
    assert(Number.isInteger(edge[1]) && edge[1] >= 0 && edge[1] < transitPack.stops.length, `Route edge ${index} has invalid to stop.`);
    assert(Number.isFinite(edge[2]) && edge[2] > 0, `Route edge ${index} must have positive minutes.`);
    assert(Number.isInteger(edge[3]) && edge[3] >= 0 && edge[3] < transitPack.routes.length, `Route edge ${index} has invalid route index.`);
  }

  for (const [index, edge] of transitPack.transferEdges.entries()) {
    assert(Array.isArray(edge) && edge.length >= 3, `Transfer edge ${index} must use compact array format.`);
    assert(Number.isInteger(edge[0]) && edge[0] >= 0 && edge[0] < transitPack.stops.length, `Transfer edge ${index} has invalid from stop.`);
    assert(Number.isInteger(edge[1]) && edge[1] >= 0 && edge[1] < transitPack.stops.length, `Transfer edge ${index} has invalid to stop.`);
    assert(Number.isFinite(edge[2]) && edge[2] > 0, `Transfer edge ${index} must have positive minutes.`);
  }

  assert(cityGrid.schema === "transit-city-grid", "City grid schema is invalid.");
  assert(Array.isArray(cityGrid.cells), "City grid cells must be an array.");
  const gridCells = new Set();
  for (const [index, cell] of cityGrid.cells.entries()) {
    assert(Array.isArray(cell) && cell.length >= 3, `Grid cell ${index} must use compact array format.`);
    const [id, addressIds, transitStopIds] = cell;
    assert(typeof id === "string" && id.trim(), `Grid cell ${index} must have an id.`);
    assert(!gridCells.has(id), `Duplicate grid cell id ${id}.`);
    assert(Array.isArray(addressIds), `Grid cell ${id} addressIds must be an array.`);
    assert(Array.isArray(transitStopIds), `Grid cell ${id} transitStopIds must be an array.`);
    for (const addressIndex of addressIds) {
      assert(Number.isInteger(addressIndex) && addressIndex >= 0 && addressIndex < addressPack.entries.length, `Grid cell ${id} references invalid address index ${addressIndex}.`);
    }
    for (const stopIndex of transitStopIds) {
      assert(Number.isInteger(stopIndex) && stopIndex >= 0 && stopIndex < transitPack.stops.length, `Grid cell ${id} references invalid stop index ${stopIndex}.`);
    }
    gridCells.add(id);
  }

  for (const cellId of addressCells) {
    assert(gridCells.has(cellId), `Address pack references missing grid cell ${cellId}.`);
  }
  for (const cellId of stopCells) {
    assert(gridCells.has(cellId), `Transit stop pack references missing grid cell ${cellId}.`);
  }
}

function validateBounds(bounds, label) {
  assert(bounds && typeof bounds === "object", `${label} must be an object.`);
  assertValidCoordinates([bounds.west, bounds.south], `${label} southwest`);
  assertValidCoordinates([bounds.east, bounds.north], `${label} northeast`);
  assert(bounds.west < bounds.east, `${label} west must be less than east.`);
  assert(bounds.south < bounds.north, `${label} south must be less than north.`);
}

function assertValidLatLngObject(value, label) {
  assert(Number.isFinite(Number(value.lng)) && Number(value.lng) >= -180 && Number(value.lng) <= 180, `${label} longitude is invalid.`);
  assert(Number.isFinite(Number(value.lat)) && Number(value.lat) >= -90 && Number(value.lat) <= 90, `${label} latitude is invalid.`);
}

function normalizeLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

function assertValidCoordinates(coordinates, label) {
  assert(Array.isArray(coordinates) && coordinates.length === 2, `${label} must be [longitude, latitude].`);
  const [lng, lat] = coordinates;
  assert(Number.isFinite(lng) && lng >= -180 && lng <= 180, `${label} longitude is invalid.`);
  assert(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${label} latitude is invalid.`);
}

function assertCoordinatesEqual(actual, expected, label) {
  assertValidCoordinates(actual, `${label} route coordinates`);
  assert(
    actual[0] === expected[0] && actual[1] === expected[1],
    `${label} route coordinates must match station coordinates.`
  );
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`Validation failed: ${message}`);
  process.exit(1);
}

main();
