#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, "..");

if (!args.stops || !args.routes || !args.trips || !args.stopTimes || !args.routeIds || !args.outStations || !args.outLines) {
  console.error(
    [
      "Usage:",
      "node scripts/build-gtfs-metro-geojson.js \\",
      "  --city toronto \\",
      "  --system TTC \\",
      "  --stops tmp/toronto/gtfs/stops.txt \\",
      "  --routes tmp/toronto/gtfs/routes.txt \\",
      "  --trips tmp/toronto/gtfs/trips.txt \\",
      "  --stopTimes tmp/toronto/gtfs/stop_times.txt \\",
      "  --routeIds 1,2,4,5,6 \\",
      "  --outStations data/toronto-stations.geojson \\",
      "  --outLines data/toronto-lines.geojson"
    ].join("\n")
  );
  process.exit(1);
}

function main() {
  const routeIds = new Set(String(args.routeIds).split(",").map((value) => value.trim()).filter(Boolean));
  const stops = readCsv(args.stops);
  const routes = readCsv(args.routes).filter((route) => routeIds.has(String(route.route_id)));
  const trips = readCsv(args.trips).filter((trip) => routeIds.has(String(trip.route_id)));
  const stopById = new Map(stops.map((stop) => [String(stop.stop_id), stop]));
  const routeById = new Map(routes.map((route) => [String(route.route_id), route]));
  const tripRouteById = new Map(trips.map((trip) => [String(trip.trip_id), String(trip.route_id)]));
  const routeTripStops = getRouteTripStops({ stopTimesPath: args.stopTimes, tripRouteById });
  const stationByName = new Map();
  const lineFeatures = [];

  for (const route of routes.sort((a, b) => Number(a.route_short_name) - Number(b.route_short_name))) {
    const routeId = String(route.route_id);
    const tripStops = routeTripStops.get(routeId) || [];
    if (!tripStops.length) continue;

    const bestTripStops = tripStops.sort((a, b) => b.length - a.length)[0];
    const lineName = getLineName(route);
    const stationNames = [];
    const coordinates = [];

    for (const stopId of bestTripStops) {
      const stop = stopById.get(String(stopId));
      if (!stop) continue;

      const stationName = cleanStationName(stop.stop_name);
      const lat = roundCoordinate(stop.stop_lat);
      const lng = roundCoordinate(stop.stop_lon);
      if (!stationName || !isValidLatLng({ lat, lng })) continue;
      if (stationNames[stationNames.length - 1] === stationName) continue;

      stationNames.push(stationName);
      coordinates.push([lng, lat]);

      const current = stationByName.get(stationName) || {
        stationName,
        stationId: slugify(stationName),
        system: args.system || "Transit",
        city: args.city || "",
        lines: new Set(),
        samples: []
      };
      current.lines.add(lineName);
      current.samples.push({ lat, lng });
      stationByName.set(stationName, current);
    }

    if (stationNames.length >= 2) {
      lineFeatures.push({
        type: "Feature",
        properties: {
          line: lineName,
          branch: route.route_long_name || lineName,
          route_id: routeId,
          station_names: stationNames,
          source: "GTFS representative longest trip"
        },
        geometry: {
          type: "LineString",
          coordinates
        }
      });
    }
  }

  const stationFeatures = Array.from(stationByName.values())
    .sort((a, b) => a.stationName.localeCompare(b.stationName))
    .map((station) => {
      const lat = average(station.samples.map((sample) => sample.lat));
      const lng = average(station.samples.map((sample) => sample.lng));
      const lines = Array.from(station.lines).sort(compareLineNames);

      return {
        type: "Feature",
        properties: {
          station_id: station.stationId,
          station_name: station.stationName,
          line: lines,
          system: station.system,
          city: station.city,
          source: "GTFS stops.txt and stop_times.txt"
        },
        geometry: {
          type: "Point",
          coordinates: [roundCoordinate(lng), roundCoordinate(lat)]
        }
      };
    });

  writeJson(args.outStations, {
    type: "FeatureCollection",
    features: stationFeatures
  });
  writeJson(args.outLines, {
    type: "FeatureCollection",
    features: lineFeatures
  });

  console.log(
    [
      `Wrote ${args.outStations} (${stationFeatures.length} stations)`,
      `Wrote ${args.outLines} (${lineFeatures.length} line features)`
    ].join("\n")
  );
}

function getRouteTripStops({ stopTimesPath, tripRouteById }) {
  const byTrip = new Map();

  readCsvRowsByLine(stopTimesPath, (row) => {
    const tripId = String(row.trip_id);
    const routeId = tripRouteById.get(tripId);
    if (!routeId) return;

    const entries = byTrip.get(tripId) || {
      routeId,
      stops: []
    };
    entries.stops.push({
      stopId: String(row.stop_id),
      sequence: Number(row.stop_sequence)
    });
    byTrip.set(tripId, entries);
  });

  const byRoute = new Map();
  for (const trip of byTrip.values()) {
    const entries = byRoute.get(trip.routeId) || [];
    entries.push(trip.stops.sort((a, b) => a.sequence - b.sequence).map((stop) => stop.stopId));
    byRoute.set(trip.routeId, entries);
  }

  return byRoute;
}

function getLineName(route) {
  const shortName = String(route.route_short_name || route.route_id || "").trim();
  return shortName ? `Line ${shortName}` : route.route_long_name || "Line";
}

function cleanStationName(value) {
  return String(value || "")
    .replace(/\s+-\s+(North|South|East|West)bound Platform.*$/i, "")
    .replace(/\s+-\s+Subway Platform.*$/i, "")
    .replace(/\s+Subway Platform.*$/i, " Station")
    .replace(/\s+LRT Platform.*$/i, " Station")
    .replace(/\s+(North|South|East|West)bound Platform.*$/i, "")
    .replace(/\s+Platform.*$/i, "")
    .replace(/\s+-\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(.+?)(?<!Station)$/i, (match) => {
      if (/Station$/i.test(match)) return match;
      if (/York University$/i.test(match)) return `${match} Station`;
      return match;
    });
}

function compareLineNames(a, b) {
  return Number(a.replace(/\D+/g, "")) - Number(b.replace(/\D+/g, "")) || a.localeCompare(b);
}

function readCsv(relativePath) {
  const text = fs.readFileSync(path.resolve(root, relativePath), "utf8");
  const rows = parseCsv(text);
  const headers = rows.shift();
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function readCsvRowsByLine(relativePath, onRow) {
  const text = fs.readFileSync(path.resolve(root, relativePath), "utf8");
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() || "");

  for (const line of lines) {
    if (!line) continue;
    const row = parseCsvLine(line);
    onRow(Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line) {
  const rows = parseCsv(`${line}\n`);
  return rows[0] || [];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function isValidLatLng(latLng) {
  return (
    Number.isFinite(Number(latLng.lat)) &&
    Number.isFinite(Number(latLng.lng)) &&
    Number(latLng.lat) >= -90 &&
    Number(latLng.lat) <= 90 &&
    Number(latLng.lng) >= -180 &&
    Number(latLng.lng) <= 180
  );
}

function roundCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : NaN;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function writeJson(relativePath, value) {
  const absolutePath = path.resolve(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value)}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    parsed[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

main();
