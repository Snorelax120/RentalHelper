#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const CITY_ID = args.id || "vancouver";
const CITY_NAME = args.name || (CITY_ID === "vancouver" ? "Metro Vancouver" : titleCaseStreet(CITY_ID));
const CITY_LABEL = args.cityLabel || CITY_NAME.replace(/^Metro\s+/i, "");
const CITY_BOUNDS = parseBounds(args.bounds) || {
  west: -123.35,
  south: 49.0,
  east: -122.45,
  north: 49.45
};

if (!args.stops || !args.addresses || !args.stations || !args.outDir) {
  console.error(
    [
      "Usage:",
      "node scripts/build-city-pack.js \\",
      "  --id vancouver \\",
      "  --name \"Metro Vancouver\" \\",
      "  --cityLabel Vancouver \\",
      "  --bounds -123.35,49.0,-122.45,49.45 \\",
      "  --stops tmp/gtfs/stops.txt \\",
      "  --addresses tmp/address/vancouver-property-addresses.json \\",
      "  --addressFormat vancouver-property-addresses \\",
      "  --routes tmp/gtfs/routes.txt \\",
      "  --trips tmp/gtfs/trips.txt \\",
      "  --stopTimes tmp/gtfs/stop_times.txt \\",
      "  --stations data/vancouver-stations.geojson \\",
      "  --walking data/vancouver-walking-pack.json \\",
      "  --outDir data/city-packs/vancouver"
    ].join("\n")
  );
  process.exit(1);
}

const GRID_CELL_DEGREES = 0.005;
const EARTH_RADIUS_METERS = 6371008.8;

function main() {
  const outDir = path.resolve(root, args.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const addresses = buildAddressEntries(readAddressRows(args.addresses), readJson(args.stations));
  const transit = buildTransitEntries({
    stopRows: readCsv(args.stops),
    stationsGeojson: readJson(args.stations),
    routeRows: args.routes ? readCsv(args.routes) : [],
    tripRows: args.trips ? readCsv(args.trips) : [],
    stopTimesPath: args.stopTimes
  });
  const grid = buildGrid(addresses.entries, transit.stops);
  const manifest = buildManifest({ addresses, transit, grid });

  updateCityPackIndex();
  writeJson(path.join(outDir, "manifest.json"), manifest);
  writeJson(path.join(outDir, "addresses.json"), addresses);
  writeJson(path.join(outDir, "transit.json"), transit);
  writeJson(path.join(outDir, "grid.json"), grid);

  console.log(
    [
      `Wrote ${outDir}`,
      `address/POI entries: ${addresses.entries.length}`,
      `transit stops: ${transit.stops.length}`,
      `grid cells: ${grid.cells.length}`
    ].join("\n")
  );
}

function buildAddressEntries(rawAddresses, stationsGeojson) {
  const entries = [];
  const seen = new Set();

  for (const row of rawAddresses) {
    const address = normalizeAddressRow(row);
    if (!address) continue;

    const { label, searchText, lat, lng } = address;
    if (!label || !searchText || !isValidLatLng({ lat, lng }) || !isInsideBounds({ lat, lng })) continue;

    const search = normalizeSearchText(searchText);
    const key = `${search}|${lat}|${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push([label, search, lat, lng, getCellId({ lat, lng }), "address"]);
  }

  for (const station of normalizeStations(stationsGeojson)) {
    const search = normalizeSearchText(`${station.name} station ${station.lines.join(" ")} ${CITY_LABEL}`);
    entries.push([
      `${station.name} Station`,
      search,
      roundCoordinate(station.lat),
      roundCoordinate(station.lng),
      getCellId(station),
      "station"
    ]);
  }

  entries.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

  return {
    schema: "transit-address-pack",
    version: 1,
    id: CITY_ID,
    name: `${CITY_NAME} Address Lookup`,
    source: args.addressSource || `${CITY_LABEL} address open data plus bundled rapid transit stations`,
    bounds: CITY_BOUNDS,
    fields: ["label", "search", "lat", "lng", "cellId", "kind"],
    entries
  };
}

function buildTransitEntries({ stopRows, stationsGeojson, routeRows, tripRows, stopTimesPath }) {
  const routeGraph = routeRows.length && tripRows.length && stopTimesPath
    ? buildRouteGraph({ routeRows, tripRows, stopTimesPath })
    : null;
  const stopById = new Map(stopRows.map((row) => [String(row.stop_id), row]));
  const selectedStopIds = routeGraph?.stopIds || null;

  let stops = stopRows
    .map((row) => {
      const stopId = String(row.stop_id);
      if (selectedStopIds && !selectedStopIds.has(stopId)) return null;

      const lat = roundCoordinate(row.stop_lat);
      const lng = roundCoordinate(row.stop_lon);
      if (!isValidLatLng({ lat, lng }) || !isInsideBounds({ lat, lng })) return null;
      if (String(row.location_type || "0") !== "0") return null;

      const modes = routeGraph?.stopModes.get(stopId) || new Set(row.zone_id === "BUS ZN" ? ["bus"] : []);
      const mode = modes.has("bus") ? "bus" : modes.has("metro") ? "metro" : null;
      if (!mode) return null;

      return [
        stopId,
        String(row.stop_code || ""),
        cleanStopName(row.stop_name),
        mode,
        lat,
        lng,
        getCellId({ lat, lng }),
        routeGraph ? Array.from(routeGraph.stopRouteNames.get(stopId) || []).sort() : []
      ];
    })
    .filter(Boolean);

  if (!routeGraph) {
    const metroStops = normalizeStations(stationsGeojson).map((station) => [
      `station:${station.id}`,
      "",
      `${station.name} Station`,
      "metro",
      roundCoordinate(station.lat),
      roundCoordinate(station.lng),
      getCellId(station),
      station.lines
    ]);
    stops = [...stops, ...metroStops];
  }

  stops.sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));

  const stopIndexById = new Map(stops.map((stop, index) => [stop[0], index]));
  const routes = routeGraph?.routes || [];
  const routeEdges = routeGraph
    ? routeGraph.routeEdges
        .map((edge) => {
          const fromIndex = stopIndexById.get(edge.fromStopId);
          const toIndex = stopIndexById.get(edge.toStopId);
          if (fromIndex === undefined || toIndex === undefined) return null;
          return [fromIndex, toIndex, edge.minutes, edge.routeIndex];
        })
        .filter(Boolean)
    : [];
  const transferEdges = routeGraph ? buildTransferEdges(stops) : [];

  return {
    schema: "transit-stop-pack",
    version: 1,
    id: CITY_ID,
    name: `${CITY_NAME} Transit Stops`,
    source: args.transitSource || "GTFS Static Data and bundled rapid transit station GeoJSON",
    bounds: CITY_BOUNDS,
    fields: ["id", "code", "name", "mode", "lat", "lng", "cellId", "routes"],
    routeFields: ["id", "label", "name", "mode"],
    routeEdgeFields: ["fromStopIndex", "toStopIndex", "minutes", "routeIndex"],
    transferEdgeFields: ["fromStopIndex", "toStopIndex", "minutes"],
    stops,
    routes,
    routeEdges,
    transferEdges
  };
}

function buildRouteGraph({ routeRows, tripRows, stopTimesPath }) {
  const routeById = new Map();
  const routes = [];
  const routeIndexById = new Map();

  for (const row of routeRows) {
    const mode = getRouteMode(row);
    if (!mode) continue;

    const label = getRouteLabel(row, mode);
    const route = [String(row.route_id), label, row.route_long_name || label, mode];
    routeIndexById.set(route[0], routes.length);
    routeById.set(route[0], { index: routes.length, mode, label });
    routes.push(route);
  }

  const tripRouteById = new Map();
  for (const row of tripRows) {
    const routeId = String(row.route_id);
    if (routeById.has(routeId)) {
      tripRouteById.set(String(row.trip_id), routeId);
    }
  }

  const edgeStats = new Map();
  const stopIds = new Set();
  const stopModes = new Map();
  const stopRouteNames = new Map();

  let currentTripId = null;
  let currentRows = [];

  readCsvRowsByLine(stopTimesPath, (row) => {
    const tripId = String(row.trip_id);
    if (currentTripId !== null && tripId !== currentTripId) {
      processTripStopTimes(currentTripId, currentRows);
      currentRows = [];
    }
    currentTripId = tripId;
    currentRows.push(row);
  });

  if (currentTripId !== null) processTripStopTimes(currentTripId, currentRows);

  function processTripStopTimes(tripId, rows) {
    const routeId = tripRouteById.get(tripId);
    if (!routeId || rows.length < 2) return;

    const route = routeById.get(routeId);
    const routeIndex = routeIndexById.get(routeId);
    rows.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

    for (let index = 1; index < rows.length; index += 1) {
      const from = rows[index - 1];
      const to = rows[index];
      const fromStopId = String(from.stop_id);
      const toStopId = String(to.stop_id);
      if (!fromStopId || !toStopId || fromStopId === toStopId) continue;

      const deltaMinutes = (parseGtfsTime(to.arrival_time) - parseGtfsTime(from.departure_time)) / 60;
      if (!Number.isFinite(deltaMinutes) || deltaMinutes <= 0 || deltaMinutes > 90) continue;

      const key = `${fromStopId}|${toStopId}|${routeIndex}`;
      const stat = edgeStats.get(key) || {
        fromStopId,
        toStopId,
        routeIndex,
        sum: 0,
        count: 0
      };
      stat.sum += deltaMinutes;
      stat.count += 1;
      edgeStats.set(key, stat);

      stopIds.add(fromStopId);
      stopIds.add(toStopId);
      addStopRoute(stopModes, fromStopId, route.mode);
      addStopRoute(stopModes, toStopId, route.mode);
      addStopRoute(stopRouteNames, fromStopId, route.label);
      addStopRoute(stopRouteNames, toStopId, route.label);
    }
  }

  return {
    routes,
    stopIds,
    stopModes,
    stopRouteNames,
    routeEdges: Array.from(edgeStats.values()).map((stat) => ({
      fromStopId: stat.fromStopId,
      toStopId: stat.toStopId,
      routeIndex: stat.routeIndex,
      minutes: Math.max(1, Math.round(stat.sum / stat.count))
    }))
  };
}

function buildTransferEdges(stops) {
  const maxMeters = 140;
  const cells = new Map();
  const transferEdges = [];
  const seen = new Set();

  stops.forEach((stop, index) => {
    const key = getCellId({ lat: stop[4], lng: stop[5] });
    const entries = cells.get(key) || [];
    entries.push(index);
    cells.set(key, entries);
  });

  stops.forEach((stop, index) => {
    const [latCell, lngCell] = stop[6].split(":").map(Number);
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLng = -1; dLng <= 1; dLng += 1) {
        const key = `${latCell + dLat}:${lngCell + dLng}`;
        for (const otherIndex of cells.get(key) || []) {
          if (otherIndex <= index) continue;
          const other = stops[otherIndex];
          const meters = haversineMeters({ lat: stop[4], lng: stop[5] }, { lat: other[4], lng: other[5] });
          if (meters > maxMeters) continue;

          const minutes = Math.max(1, Math.round(meters / 80));
          const edgeKey = `${index}:${otherIndex}`;
          if (seen.has(edgeKey)) continue;
          seen.add(edgeKey);
          transferEdges.push([index, otherIndex, minutes], [otherIndex, index, minutes]);
        }
      }
    }
  });

  return transferEdges;
}

function buildGrid(addressEntries, transitStops) {
  const cells = new Map();

  addressEntries.forEach((entry, index) => {
    const cell = ensureCell(cells, entry[4]);
    cell.addressIds.push(index);
  });

  transitStops.forEach((stop, index) => {
    const cell = ensureCell(cells, stop[6]);
    cell.transitStopIds.push(index);
  });

  return {
    schema: "transit-city-grid",
    version: 1,
    id: CITY_ID,
    cellDegrees: GRID_CELL_DEGREES,
    bounds: CITY_BOUNDS,
    fields: ["id", "addressIds", "transitStopIds"],
    cells: Array.from(cells.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((cell) => [cell.id, cell.addressIds, cell.transitStopIds])
  };
}

function buildManifest({ addresses, transit, grid }) {
  return {
    schema: "transit-city-pack",
    version: 1,
    id: CITY_ID,
    name: CITY_NAME,
    bounds: CITY_BOUNDS,
    grid: {
      type: "fixed-lat-lng",
      cellDegrees: GRID_CELL_DEGREES,
      resource: "grid.json",
      cellCount: grid.cells.length
    },
    resources: {
      addresses: {
        resource: "addresses.json",
        count: addresses.entries.length
      },
      transit: {
        resource: "transit.json",
        count: transit.stops.length
      },
      walking: args.walking
        ? {
            resource: path.relative(path.resolve(root, args.outDir), path.resolve(root, args.walking))
              .split(path.sep)
              .join("/")
          }
        : null
    }
  };
}

function updateCityPackIndex() {
  const indexPath = path.join(root, "data/city-packs/index.json");
  let packs = [];

  if (fs.existsSync(indexPath)) {
    try {
      packs = JSON.parse(fs.readFileSync(indexPath, "utf8")).packs || [];
    } catch (_error) {
      packs = [];
    }
  }

  const resource = path.relative(root, path.join(root, args.outDir, "manifest.json")).split(path.sep).join("/");
  packs = packs.filter((pack) => pack.id !== CITY_ID);
  packs.push({
    id: CITY_ID,
    name: CITY_NAME,
    bounds: CITY_BOUNDS,
    resource
  });
  packs.sort((a, b) => a.id.localeCompare(b.id));

  writeJson(indexPath, {
    version: 1,
    packs
  });
}

function ensureCell(cells, id) {
  const existing = cells.get(id);
  if (existing) return existing;

  const cell = {
    id,
    addressIds: [],
    transitStopIds: []
  };
  cells.set(id, cell);
  return cell;
}

function normalizeStations(stationsGeojson) {
  return (stationsGeojson.features || [])
    .map((feature) => {
      const coordinates = feature.geometry?.coordinates;
      const lat = Number(coordinates?.[1]);
      const lng = Number(coordinates?.[0]);
      if (feature.geometry?.type !== "Point" || !isValidLatLng({ lat, lng })) return null;

      return {
        id: String(feature.properties?.station_id || feature.properties?.station_name),
        name: feature.properties?.station_name || "Station",
        lines: normalizeLines(feature.properties?.line),
        lat,
        lng
      };
    })
    .filter(Boolean);
}

function readCsv(relativePath) {
  const text = fs.readFileSync(path.resolve(root, relativePath), "utf8");
  const rows = parseCsv(text);
  const headers = rows.shift();
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function readAddressRows(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  const text = fs.readFileSync(absolutePath, "utf8");

  if (args.addressFormat === "csv" || args.addressFormat === "toronto-oar" || /\.csv$/i.test(relativePath)) {
    const rows = parseCsv(text);
    const headers = rows.shift();
    return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  }

  return JSON.parse(text);
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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relativePath), "utf8"));
}

function writeJson(absolutePath, value) {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value)}\n`);
}

function getCellId(latLng) {
  const latIndex = Math.floor((Number(latLng.lat) - CITY_BOUNDS.south) / GRID_CELL_DEGREES);
  const lngIndex = Math.floor((Number(latLng.lng) - CITY_BOUNDS.west) / GRID_CELL_DEGREES);
  return `${latIndex}:${lngIndex}`;
}

function normalizeSearchText(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(e|east)\b/g, " east ")
    .replace(/\b(w|west)\b/g, " west ")
    .replace(/\b(n|north)\b/g, " north ")
    .replace(/\b(s|south)\b/g, " south ")
    .replace(/\bjarvis\b/g, " jervis ")
    .replace(/\b(av|ave|avenue)\b/g, " avenue ")
    .replace(/\b(st|street)\b/g, " street ")
    .replace(/\b(rd|road)\b/g, " road ")
    .replace(/\b(dr|drive)\b/g, " drive ")
    .replace(/\b(blvd|boulevard)\b/g, " boulevard ")
    .replace(/\b(cres|crescent)\b/g, " crescent ")
    .replace(/\b(pl|place)\b/g, " place ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAddressRow(row) {
  if (args.addressFormat === "toronto-oar") {
    const label = cleanStopName(row.ADDRESS_FULL || `${row.ADDRESS_NUMBER || ""} ${row.LINEAR_NAME_FULL || ""}`);
    const point = parseGeoJsonPoint(row.geometry);
    const lat = roundCoordinate(point?.lat);
    const lng = roundCoordinate(point?.lng);
    return {
      label: `${label}, ${CITY_LABEL}`,
      searchText: `${label} ${CITY_LABEL}`,
      lat,
      lng
    };
  }

  const civicNumber = normalizeCivicNumber(row.civic_number);
  const street = normalizeStreet(row.std_street);
  const lat = roundCoordinate(row.geo_point_2d?.lat ?? row.geom?.geometry?.coordinates?.[1]);
  const lng = roundCoordinate(row.geo_point_2d?.lon ?? row.geom?.geometry?.coordinates?.[0]);
  if (!civicNumber || !street) return null;

  return {
    label: `${civicNumber} ${titleCaseStreet(street)}, ${CITY_LABEL}`,
    searchText: `${civicNumber} ${street} ${CITY_LABEL}`,
    lat,
    lng
  };
}

function parseGeoJsonPoint(value) {
  if (!value) return null;

  try {
    const geometry = typeof value === "string" ? JSON.parse(value) : value;
    const coordinates = geometry?.coordinates;
    return {
      lng: Number(coordinates?.[0]),
      lat: Number(coordinates?.[1])
    };
  } catch (_error) {
    return null;
  }
}

function normalizeCivicNumber(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function normalizeStreet(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function titleCaseStreet(value) {
  return value
    .toLowerCase()
    .split(" ")
    .map((part) => {
      if (/^\d+(st|nd|rd|th)$/i.test(part)) return part.toUpperCase();
      if (["e", "w", "n", "s"].includes(part)) return part.toUpperCase();
      if (["av", "ave"].includes(part)) return "Ave";
      if (part === "st") return "St";
      if (part === "rd") return "Rd";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function cleanStopName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLines(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return [value];
  return [];
}

function addStopRoute(map, stopId, value) {
  const entries = map.get(stopId) || new Set();
  entries.add(value);
  map.set(stopId, entries);
}

function getRouteMode(row) {
  const routeType = String(row.route_type);
  if (routeType === "1") return "metro";
  if (routeType === "3") return "bus";
  if (routeType === "0") {
    if (/^Line\s+(5|6)\b/i.test(row.route_long_name || "")) return "metro";
    return "bus";
  }
  return null;
}

function getRouteLabel(row, mode) {
  if (mode === "metro") return row.route_long_name || "Train";
  return String(row.route_short_name || row.route_long_name || "Bus").replace(/^0+(\d)/, "$1");
}

function parseGtfsTime(value) {
  const match = String(value || "").trim().match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
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

function isInsideBounds(latLng) {
  return (
    latLng.lng >= CITY_BOUNDS.west &&
    latLng.lng <= CITY_BOUNDS.east &&
    latLng.lat >= CITY_BOUNDS.south &&
    latLng.lat <= CITY_BOUNDS.north
  );
}

function haversineMeters(origin, destination) {
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);
  const deltaLat = toRadians(destination.lat - origin.lat);
  const deltaLng = toRadians(destination.lng - origin.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function roundCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : NaN;
}

function parseBounds(value) {
  if (!value) return null;
  const [west, south, east, north] = String(value).split(",").map(Number);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
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
