#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const allowedLines = new Set(["Expo", "Millennium", "Canada"]);
const requiredWebResources = new Set([
  "data/vancouver-stations.geojson",
  "data/vancouver-lines.geojson"
]);

function main() {
  const manifest = readJson("manifest.json");
  const stations = readJson("data/vancouver-stations.geojson");
  const lines = readJson("data/vancouver-lines.geojson");

  validateManifest(manifest);
  const stationMap = validateStations(stations);
  validateLines(lines, stationMap);

  console.log("Validation passed: manifest, station data, and route line data are valid.");
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

function validateStations(geojson) {
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

  assert(stationMap.size >= 50, "Station GeoJSON should contain the SkyTrain station set.");
  return stationMap;
}

function validateLines(geojson, stationMap) {
  assert(geojson.type === "FeatureCollection", "Route line GeoJSON must be a FeatureCollection.");
  assert(Array.isArray(geojson.features), "Route line GeoJSON must contain features.");
  assert(geojson.features.length >= 5, "Route line GeoJSON must include the required branches.");

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
      assertCoordinatesEqual(coordinates[index], station.coordinates, `${line} ${branch} ${stationName}`);
    });
  }

  for (const required of [
    "Expo:King George",
    "Expo:Production Way-University",
    "Millennium:Lafarge Lake-Douglas",
    "Canada:Richmond-Brighouse",
    "Canada:YVR-Airport"
  ]) {
    assert(branches.has(required), `Missing required route branch ${required}.`);
  }
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
