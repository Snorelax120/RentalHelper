#!/usr/bin/env node

const fs = require("fs");

const EARTH_RADIUS_METERS = 6371008.8;
const DEFAULT_STATION_COUNT = 2;
const DEFAULT_MAX_DISTANCE_METERS = 4000;
const DEFAULT_STATION_SNAP_METERS = 500;

const args = parseArgs(process.argv.slice(2));

if ((!args.osm && !args.geojson) || !args.stations || !args.out || !args.id) {
  console.error(
    [
      "Usage:",
      "node scripts/build-walking-pack.js \\",
      "  --id vancouver \\",
      "  --name \"Metro Vancouver\" \\",
      "  --osm path/to/overpass.json \\",
      "  # or --geojson path/to/pedestrian-network.geojson \\",
      "  --stations data/vancouver-stations.geojson \\",
      "  --out data/vancouver-walking-pack.json",
      "",
      "The OSM input should be Overpass JSON containing walkable highway ways and their nodes.",
      "The GeoJSON input should contain LineString or MultiLineString pedestrian network features."
    ].join("\n")
  );
  process.exit(1);
}

function main() {
  const stationCount = Number(args.stationCount || DEFAULT_STATION_COUNT);
  const maxDistanceMeters = Number(args.maxDistanceMeters || DEFAULT_MAX_DISTANCE_METERS);
  const stationSnapMeters = Number(args.stationSnapMeters || DEFAULT_STATION_SNAP_METERS);
  const network = readJson(args.osm || args.geojson);
  const stationsGeojson = readJson(args.stations);
  const stations = normalizeStations(stationsGeojson);
  const graph = args.geojson ? buildGraphFromGeoJson(network) : buildGraph(network);
  if (!graph.nodes.length || !graph.edges.length) {
    console.error("No walkable graph nodes/edges were found in the OSM input.");
    process.exit(1);
  }

  const stationSources = snapStationsToGraph(stations, graph.nodes, stationSnapMeters);
  if (!stationSources.length) {
    console.error("No stations snapped to the walking graph. Increase --stationSnapMeters or check the OSM extract.");
    process.exit(1);
  }

  const nodeDistances = buildNodeStationDistances(graph, stationSources, stationCount, maxDistanceMeters);
  const pack = buildPack({
    id: args.id,
    name: args.name || args.id,
    stations,
    graph,
    nodeDistances,
    stationSources,
    maxDistanceMeters,
    stationCount,
    stationSnapMeters
  });

  fs.writeFileSync(args.out, `${JSON.stringify(pack)}\n`);
  console.log(
    [
      `Wrote ${args.out}`,
      `nodes: ${pack.routing.nodes.length}`,
      `edges: ${pack.routing.edges.length}`,
      `stations: ${pack.routing.stations.length}`,
      `snapped stations: ${stationSources.length}/${stations.length}`
    ].join("\n")
  );
}

function buildGraphFromGeoJson(geojson) {
  const nodesById = new Map();
  const rawEdges = [];
  const seenEdges = new Set();

  for (const feature of geojson.features || []) {
    for (const line of getFeatureLines(feature)) {
      for (let index = 1; index < line.length; index += 1) {
        const from = normalizeGeoJsonCoordinate(line[index - 1]);
        const to = normalizeGeoJsonCoordinate(line[index]);
        if (!from || !to) continue;

        nodesById.set(from.id, from);
        nodesById.set(to.id, to);

        const edgeKey = [from.id, to.id].sort().join("|");
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        const meters = haversineMeters(from, to);
        if (!Number.isFinite(meters) || meters <= 0) continue;
        rawEdges.push([from.id, to.id, Math.round(meters)]);
      }
    }
  }

  const nodes = Array.from(nodesById.values());
  const adjacency = new Map(nodes.map((node) => [node.id, []]));

  for (const [fromId, toId, meters] of rawEdges) {
    adjacency.get(fromId).push({ toId, meters });
    adjacency.get(toId).push({ toId: fromId, meters });
  }

  return {
    nodes,
    nodeById: nodesById,
    edges: rawEdges,
    adjacency
  };
}

function getFeatureLines(feature) {
  const geometry = feature.geometry || {};
  if (geometry.type === "LineString") return [geometry.coordinates || []];
  if (geometry.type === "MultiLineString") return geometry.coordinates || [];
  return [];
}

function normalizeGeoJsonCoordinate(coordinate) {
  const lng = Number(coordinate?.[0]);
  const lat = Number(coordinate?.[1]);
  if (!isValidLatLng({ lat, lng })) return null;

  const id = `${roundCoordinate(lat)}:${roundCoordinate(lng)}`;
  return { id, lat, lng };
}

function buildGraph(osmData) {
  const osmNodes = new Map();
  const usedNodeIds = new Set();
  const rawEdges = [];

  for (const element of osmData.elements || []) {
    if (element.type === "node" && isValidLatLng(element)) {
      osmNodes.set(String(element.id), {
        id: String(element.id),
        lat: Number(element.lat),
        lng: Number(element.lon)
      });
    }
  }

  for (const element of osmData.elements || []) {
    if (element.type !== "way" || !isWalkableWay(element.tags || {}) || !Array.isArray(element.nodes)) continue;

    const wayNodeIds = element.nodes.map(String);
    for (let index = 1; index < wayNodeIds.length; index += 1) {
      const fromId = wayNodeIds[index - 1];
      const toId = wayNodeIds[index];
      const from = osmNodes.get(fromId);
      const to = osmNodes.get(toId);
      if (!from || !to) continue;

      const meters = haversineMeters(from, to) * getWayPenalty(element.tags || {});
      if (!Number.isFinite(meters) || meters <= 0) continue;

      usedNodeIds.add(fromId);
      usedNodeIds.add(toId);
      rawEdges.push([fromId, toId, Math.round(meters)]);
    }
  }

  const nodes = Array.from(usedNodeIds)
    .map((id) => osmNodes.get(id))
    .filter(Boolean);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = rawEdges.filter(([fromId, toId]) => nodeById.has(fromId) && nodeById.has(toId));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));

  for (const [fromId, toId, meters] of edges) {
    adjacency.get(fromId).push({ toId, meters });
    adjacency.get(toId).push({ toId: fromId, meters });
  }

  return { nodes, nodeById, edges, adjacency };
}

function isWalkableWay(tags) {
  const highway = tags.highway;
  if (!highway) return false;
  if (["motorway", "motorway_link", "construction", "proposed", "raceway"].includes(highway)) return false;
  if (["no", "private"].includes(tags.access)) return false;
  if (["no", "private"].includes(tags.foot)) return false;
  if (tags.area === "yes") return false;

  return true;
}

function getWayPenalty(tags) {
  if (tags.highway === "steps") return 1.25;
  if (tags.surface && /gravel|dirt|unpaved|ground|grass/i.test(tags.surface)) return 1.08;
  return 1;
}

function snapStationsToGraph(stations, nodes, maxMeters) {
  return stations
    .map((station) => {
      let nearest = null;

      for (const node of nodes) {
        const meters = haversineMeters(station, node);
        if (!nearest || meters < nearest.meters) {
          nearest = { nodeId: node.id, meters };
        }
      }

      if (!nearest || nearest.meters > maxMeters) return null;
      return {
        stationId: station.id,
        nodeId: nearest.nodeId,
        snapMeters: Math.round(nearest.meters)
      };
    })
    .filter(Boolean);
}

function buildNodeStationDistances(graph, stationSources, stationCount, maxDistanceMeters) {
  const perNode = new Map(graph.nodes.map((node) => [node.id, []]));

  for (const source of stationSources) {
    const distances = dijkstra(graph.adjacency, source.nodeId, maxDistanceMeters);

    for (const [nodeId, meters] of distances) {
      const entries = perNode.get(nodeId);
      if (!entries) continue;

      entries.push([source.stationId, Math.round(meters + source.snapMeters)]);
    }
  }

  for (const [nodeId, entries] of perNode) {
    entries.sort((a, b) => a[1] - b[1]);
    perNode.set(nodeId, entries.slice(0, stationCount));
  }

  return perNode;
}

function dijkstra(adjacency, sourceNodeId, maxDistanceMeters) {
  const distances = new Map([[sourceNodeId, 0]]);
  const queue = new MinHeap();
  queue.push({ nodeId: sourceNodeId, distance: 0 });

  while (queue.size) {
    const current = queue.pop();
    if (current.distance !== distances.get(current.nodeId)) continue;
    if (current.distance > maxDistanceMeters) continue;

    for (const edge of adjacency.get(current.nodeId) || []) {
      const nextDistance = current.distance + edge.meters;
      if (nextDistance > maxDistanceMeters) continue;
      if (distances.has(edge.toId) && distances.get(edge.toId) <= nextDistance) continue;

      distances.set(edge.toId, nextDistance);
      queue.push({ nodeId: edge.toId, distance: nextDistance });
    }
  }

  return distances;
}

function buildPack({
  id,
  name,
  stations,
  graph,
  nodeDistances,
  stationSources,
  maxDistanceMeters,
  stationCount,
  stationSnapMeters
}) {
  const retainedNodes = graph.nodes.filter((node) => (nodeDistances.get(node.id) || []).length > 0);
  if (!retainedNodes.length) {
    console.error("No graph nodes have station-distance results. Increase --maxDistanceMeters.");
    process.exit(1);
  }

  const nodeIdMap = new Map(retainedNodes.map((node, index) => [node.id, index]));
  const retainedEdges = graph.edges
    .filter(([fromId, toId]) => nodeIdMap.has(fromId) && nodeIdMap.has(toId))
    .map(([fromId, toId, meters]) => [nodeIdMap.get(fromId), nodeIdMap.get(toId), meters]);
  const bounds = getBounds(retainedNodes);

  return {
    schema: "transit-walking-city-pack",
    version: 1,
    id,
    name,
    bounds,
    routing: {
      mode: "precomputed-node-station-distances-v1",
      status: "generated-from-osm-walking-graph",
      stationCount,
      maxDistanceMeters,
      stationSnapMeters,
      originalNodeCount: graph.nodes.length,
      originalEdgeCount: graph.edges.length,
      stations: stations.map((station) => ({
        id: station.id,
        name: station.name,
        fullName: station.fullName,
        lines: station.lines,
        lat: roundCoordinate(station.lat),
        lng: roundCoordinate(station.lng)
      })),
      stationSources: stationSources.map((source) => ({
        stationId: source.stationId,
        nodeId: nodeIdMap.get(source.nodeId) ?? source.nodeId,
        snapMeters: source.snapMeters
      })),
      nodes: retainedNodes.map((node) => [
        nodeIdMap.get(node.id),
        roundCoordinate(node.lat),
        roundCoordinate(node.lng),
        nodeDistances.get(node.id) || []
      ]),
      edges: retainedEdges
    }
  };
}

function normalizeStations(geojson) {
  return (geojson.features || [])
    .map((feature) => {
      const coordinates = feature.geometry?.coordinates;
      if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates) || coordinates.length < 2) {
        return null;
      }

      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;

      return {
        id: String(feature.properties?.station_id || feature.properties?.station_name || `${lat},${lng}`),
        name: feature.properties?.station_name || "Station",
        fullName: feature.properties?.full_station_name || feature.properties?.station_name || "Station",
        lines: normalizeLines(feature.properties?.line),
        lat,
        lng
      };
    })
    .filter(Boolean);
}

function getBounds(nodes) {
  const bounds = nodes.reduce(
    (current, node) => ({
      west: Math.min(current.west, node.lng),
      south: Math.min(current.south, node.lat),
      east: Math.max(current.east, node.lng),
      north: Math.max(current.north, node.lat)
    }),
    {
      west: Infinity,
      south: Infinity,
      east: -Infinity,
      north: -Infinity
    }
  );

  return {
    west: roundCoordinate(bounds.west),
    south: roundCoordinate(bounds.south),
    east: roundCoordinate(bounds.east),
    north: roundCoordinate(bounds.north)
  };
}

function normalizeLines(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return [value];
  return [];
}

function isValidLatLng(value) {
  return isValidLatitude(Number(value.lat)) && isValidLongitude(Number(value.lng ?? value.lon));
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function haversineMeters(origin, destination) {
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);
  const deltaLat = toRadians(destination.lat - origin.lat);
  const deltaLng = toRadians((destination.lng ?? destination.lon) - (origin.lng ?? origin.lon));
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
  return Math.round(value * 100000) / 100000;
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    const root = this.items[0];
    const last = this.items.pop();

    if (this.items.length && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return root;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].distance <= this.items[index].distance) return;

      this.swap(parent, index);
      index = parent;
    }
  }

  bubbleDown(index) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.items.length && this.items[left].distance < this.items[smallest].distance) {
        smallest = left;
      }

      if (right < this.items.length && this.items[right].distance < this.items[smallest].distance) {
        smallest = right;
      }

      if (smallest === index) return;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  swap(a, b) {
    const item = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = item;
  }
}

main();
