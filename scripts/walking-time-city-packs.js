(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;
  const W = T.walkingTimeUtils;

  function getNearestStations(latLng, count = config.WALKING_RESULT_COUNT) {
    const origin = W.normalizeLatLng(latLng);
    if (!origin) return [];

    const limit = W.normalizeResultCount(count);
    const cityPackResult = getNearestStationsFromCityPack(origin, limit);
    if (cityPackResult.length) return cityPackResult;

    return getNearestStationsByDirectEstimate(origin, limit, getActiveCityPack(origin));
  }

  function getCityPacks() {
    return {
      loading: state.walkingTime.cityPacksLoading,
      loaded: state.walkingTime.cityPacksLoaded,
      error: state.walkingTime.cityPackLoadError,
      packs: state.walkingTime.cityPacks.map((pack) => ({
        id: pack.id,
        name: pack.name,
        routingMode: pack.routingMode,
        routingStatus: pack.routingStatus,
        bounds: pack.bounds,
        nodeCount: pack.nodes.length,
        edgeCount: pack.edges.length,
        edgeIndexCellCount: pack.edgeIndex.size
      }))
    };
  }

  async function loadCityPacks() {
    if (state.walkingTime.cityPacksLoading || state.walkingTime.cityPacksLoaded) return;

    state.walkingTime.cityPacksLoading = true;
    state.walkingTime.cityPackLoadError = "";

    try {
      const packs = await Promise.all(
        config.WALKING_CITY_PACKS.map(async (entry) => {
          const response = await fetch(chrome.runtime.getURL(entry.resource));
          if (!response.ok) {
            throw new Error(`Failed to load walking pack ${entry.id}: ${response.status}`);
          }

          return normalizeCityPack(await response.json(), entry);
        })
      );

      state.walkingTime.cityPacks = packs.filter(Boolean);
      state.walkingTime.cityPacksLoaded = true;
    } catch (error) {
      state.walkingTime.cityPackLoadError = error instanceof Error ? error.message : String(error);
      utils.debugLog("Walking city pack load failed", state.walkingTime.cityPackLoadError);
    } finally {
      state.walkingTime.cityPacksLoading = false;
    }
  }

  function getNearestStationsFromCityPack(origin, limit) {
    const cityPack = getActiveCityPack(origin);
    if (!cityPack || cityPack.routingMode !== "precomputed-node-station-distances-v1") return [];
    if (!cityPack.nodes.length || !cityPack.edges.length) return [];

    const snap = snapToCityPackEdge(origin, cityPack);
    if (!snap) return [];

    const byStation = new Map();
    addEndpointStationDistances(byStation, snap.fromNode, snap.distanceToFromMeters, cityPack);
    addEndpointStationDistances(byStation, snap.toNode, snap.distanceToToMeters, cityPack);

    return Array.from(byStation.values())
      .map((result) => ({
        ...result,
        estimatedWalkMinutes: Math.max(
          config.WALKING_MIN_MINUTES,
          Math.round(result.estimatedWalkMeters / config.WALKING_SPEED_METERS_PER_MINUTE)
        ),
        estimatedWalkMeters: Math.round(result.estimatedWalkMeters),
        straightLineMeters: Math.round(W.haversineMeters(origin, result)),
        snapDistanceMeters: Math.round(snap.snapDistanceMeters),
        estimationSource: "precomputed-graph",
        cityPackId: cityPack.id,
        cityPackMode: cityPack.routingMode
      }))
      .sort(
        (a, b) =>
          a.estimatedWalkMinutes - b.estimatedWalkMinutes ||
          a.estimatedWalkMeters - b.estimatedWalkMeters ||
          a.stationName.localeCompare(b.stationName)
      )
      .slice(0, limit);
  }

  function addEndpointStationDistances(byStation, node, endpointWalkMeters, cityPack) {
    for (const stationDistance of node.stationDistances) {
      const station = getPackStation(cityPack, stationDistance.stationId);
      if (!station) continue;

      const estimatedWalkMeters = endpointWalkMeters + stationDistance.meters;
      const current = byStation.get(station.stationId);
      if (current && current.estimatedWalkMeters <= estimatedWalkMeters) continue;

      byStation.set(station.stationId, {
        stationId: station.stationId,
        stationName: station.stationName,
        fullStationName: station.fullStationName,
        lines: station.lines,
        lat: station.lat,
        lng: station.lng,
        estimatedWalkMeters
      });
    }
  }

  function getNearestStationsByDirectEstimate(origin, limit, cityPack = null) {
    const stations = getStationIndex();
    if (!stations.length) return [];

    return stations
      .map((station) => {
        const straightLineMeters = W.haversineMeters(origin, station);
        const estimatedWalkMeters = straightLineMeters * config.WALKING_CIRCUITY_FACTOR;
        const estimatedWalkMinutes = Math.max(
          config.WALKING_MIN_MINUTES,
          Math.round(estimatedWalkMeters / config.WALKING_SPEED_METERS_PER_MINUTE)
        );

        return {
          stationId: station.stationId,
          stationName: station.stationName,
          fullStationName: station.fullStationName,
          lines: station.lines,
          lat: station.lat,
          lng: station.lng,
          straightLineMeters: Math.round(straightLineMeters),
          estimatedWalkMeters: Math.round(estimatedWalkMeters),
          estimatedWalkMinutes,
          estimationSource: "direct-estimate",
          cityPackId: cityPack?.id || null,
          cityPackMode: cityPack?.routingMode || null
        };
      })
      .sort(
        (a, b) =>
          a.estimatedWalkMinutes - b.estimatedWalkMinutes ||
          a.straightLineMeters - b.straightLineMeters ||
          a.stationName.localeCompare(b.stationName)
      )
      .slice(0, limit);
  }

  function getActiveCityPack(origin) {
    return state.walkingTime.cityPacks.find((pack) => W.isInsideBounds(origin, pack.bounds)) || null;
  }

  function normalizeCityPack(rawPack, entry) {
    const routing = rawPack.routing || {};
    const bounds = normalizeBounds(rawPack.bounds);
    if (!bounds) return null;

    const stations = normalizePackStations(rawPack.stations || routing.stations || []);
    const stationById = new Map(stations.map((station) => [station.stationId, station]));
    const nodes = normalizePackNodes(rawPack.nodes || routing.nodes || []);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges = normalizePackEdges(rawPack.edges || routing.edges || [], nodeById);
    const edgeIndex = buildEdgeIndex(edges, nodeById);

    return {
      id: rawPack.id || entry.id,
      name: rawPack.name || entry.name || rawPack.id || entry.id,
      version: rawPack.version || 1,
      bounds,
      routingMode: routing.mode || rawPack.mode || "direct-estimate",
      routingStatus: routing.status || "unknown",
      snapMaxMeters: Number(routing.snapMaxMeters) || config.WALKING_SNAP_MAX_METERS,
      stations,
      stationById,
      nodes,
      nodeById,
      edges,
      edgeIndex
    };
  }

  function normalizeBounds(bounds) {
    if (!bounds) return null;

    const west = Number(bounds.west ?? bounds[0]);
    const south = Number(bounds.south ?? bounds[1]);
    const east = Number(bounds.east ?? bounds[2]);
    const north = Number(bounds.north ?? bounds[3]);

    if (
      !utils.isValidLongitude(west) ||
      !utils.isValidLongitude(east) ||
      !utils.isValidLatitude(south) ||
      !utils.isValidLatitude(north) ||
      west >= east ||
      south >= north
    ) {
      return null;
    }

    return { west, south, east, north };
  }

  function normalizePackStations(stations) {
    return stations
      .map((station, index) => {
        const stationId = String(station.id ?? station.stationId ?? station.station_id ?? index);
        const lat = Number(station.lat);
        const lng = Number(station.lng ?? station.lon);
        if (!utils.isValidLatitude(lat) || !utils.isValidLongitude(lng)) return null;

        return {
          stationId,
          stationName: station.name || station.stationName || station.station_name || "Station",
          fullStationName:
            station.fullName || station.fullStationName || station.full_station_name || station.name || "Station",
          lines: W.normalizeLines(station.lines || station.line),
          lat,
          lng
        };
      })
      .filter(Boolean);
  }

  function normalizePackNodes(nodes) {
    return nodes
      .map((node, index) => {
        const source = Array.isArray(node) ? node : null;
        const id = String(source ? source[0] : node.id ?? index);
        const lat = Number(source ? source[1] : node.lat);
        const lng = Number(source ? source[2] : node.lng ?? node.lon);
        const rawStationDistances = source ? source[3] : node.stationDistances || node.stations || [];

        if (!utils.isValidLatitude(lat) || !utils.isValidLongitude(lng)) return null;

        return {
          id,
          lat,
          lng,
          stationDistances: normalizeStationDistances(rawStationDistances)
        };
      })
      .filter(Boolean);
  }

  function normalizeStationDistances(stationDistances) {
    if (!Array.isArray(stationDistances)) return [];

    return stationDistances
      .map((entry) => {
        const stationId = String(Array.isArray(entry) ? entry[0] : entry.stationId ?? entry.id);
        const meters = Number(Array.isArray(entry) ? entry[1] : entry.meters);
        return stationId && Number.isFinite(meters) && meters >= 0 ? { stationId, meters } : null;
      })
      .filter(Boolean);
  }

  function normalizePackEdges(edges, nodeById) {
    return edges
      .map((edge) => {
        const fromId = String(Array.isArray(edge) ? edge[0] : edge.from ?? edge.fromId);
        const toId = String(Array.isArray(edge) ? edge[1] : edge.to ?? edge.toId);
        if (!nodeById.has(fromId) || !nodeById.has(toId)) return null;

        const configuredMeters = Number(Array.isArray(edge) ? edge[2] : edge.meters);
        const meters = Number.isFinite(configuredMeters) && configuredMeters > 0
          ? configuredMeters
          : W.haversineMeters(nodeById.get(fromId), nodeById.get(toId));

        return [fromId, toId, meters];
      })
      .filter(Boolean);
  }

  function buildEdgeIndex(edges, nodeById) {
    const edgeIndex = new Map();
    const cellSize = config.WALKING_EDGE_INDEX_CELL_DEGREES;

    edges.forEach((edge, index) => {
      const fromNode = nodeById.get(edge[0]);
      const toNode = nodeById.get(edge[1]);
      if (!fromNode || !toNode) return;

      const minLatCell = Math.floor(Math.min(fromNode.lat, toNode.lat) / cellSize);
      const maxLatCell = Math.floor(Math.max(fromNode.lat, toNode.lat) / cellSize);
      const minLngCell = Math.floor(Math.min(fromNode.lng, toNode.lng) / cellSize);
      const maxLngCell = Math.floor(Math.max(fromNode.lng, toNode.lng) / cellSize);

      for (let latCell = minLatCell; latCell <= maxLatCell; latCell += 1) {
        for (let lngCell = minLngCell; lngCell <= maxLngCell; lngCell += 1) {
          const key = getEdgeCellKey(latCell, lngCell);
          const entries = edgeIndex.get(key) || [];
          entries.push(index);
          edgeIndex.set(key, entries);
        }
      }
    });

    return edgeIndex;
  }

  function snapToCityPackEdge(origin, cityPack) {
    let nearest = null;
    const candidateEdgeIndexes = getCandidateEdgeIndexes(origin, cityPack);

    for (const edgeIndex of candidateEdgeIndexes) {
      const snap = getEdgeSnap(origin, cityPack.edges[edgeIndex], cityPack);
      if (!nearest || snap.snapDistanceMeters < nearest.snapDistanceMeters) {
        nearest = snap;
      }
    }

    if (!nearest || nearest.snapDistanceMeters > cityPack.snapMaxMeters) return null;
    return nearest;
  }

  function getCandidateEdgeIndexes(origin, cityPack) {
    const cellSize = config.WALKING_EDGE_INDEX_CELL_DEGREES;
    const latRadius = cityPack.snapMaxMeters / 111320;
    const lngRadius = cityPack.snapMaxMeters / Math.max(1, 111320 * Math.cos(W.toRadians(origin.lat)));
    const minLatCell = Math.floor((origin.lat - latRadius) / cellSize);
    const maxLatCell = Math.floor((origin.lat + latRadius) / cellSize);
    const minLngCell = Math.floor((origin.lng - lngRadius) / cellSize);
    const maxLngCell = Math.floor((origin.lng + lngRadius) / cellSize);
    const indexes = new Set();

    for (let latCell = minLatCell; latCell <= maxLatCell; latCell += 1) {
      for (let lngCell = minLngCell; lngCell <= maxLngCell; lngCell += 1) {
        for (const edgeIndex of cityPack.edgeIndex.get(getEdgeCellKey(latCell, lngCell)) || []) {
          indexes.add(edgeIndex);
        }
      }
    }

    return indexes;
  }

  function getEdgeSnap(origin, edge, cityPack) {
    const fromNode = cityPack.nodeById.get(edge[0]);
    const toNode = cityPack.nodeById.get(edge[1]);
    if (!fromNode || !toNode) {
      return {
        fromNode: null,
        toNode: null,
        snapDistanceMeters: Infinity,
        distanceToFromMeters: Infinity,
        distanceToToMeters: Infinity
      };
    }

    const base = origin;
    const a = W.toLocalPoint(base, fromNode);
    const b = W.toLocalPoint(base, toNode);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSquared = abx * abx + aby * aby;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(a.x * abx + a.y * aby) / lengthSquared)) : 0;
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    const snapDistanceMeters = Math.hypot(x, y);
    const distanceFromStartMeters = edge[2] * t;

    return {
      edge,
      fromNode,
      toNode,
      snapDistanceMeters,
      distanceToFromMeters: snapDistanceMeters + distanceFromStartMeters,
      distanceToToMeters: snapDistanceMeters + edge[2] - distanceFromStartMeters
    };
  }

  function getEdgeCellKey(latCell, lngCell) {
    return `${latCell}:${lngCell}`;
  }

  function getPackStation(cityPack, stationId) {
    return cityPack.stationById.get(stationId) || getStationIndex().find((station) => station.stationId === stationId);
  }

  function getStationIndex() {
    if (
      state.walkingTime.stationIndex &&
      state.walkingTime.stationIndexSource === state.stationsGeojson
    ) {
      return state.walkingTime.stationIndex;
    }

    const features = state.stationsGeojson?.features || [];
    state.walkingTime.stationIndex = features
      .map((feature) => {
        const coordinates = feature.geometry?.coordinates;
        if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates) || coordinates.length < 2) {
          return null;
        }

        const lng = Number(coordinates[0]);
        const lat = Number(coordinates[1]);
        if (!utils.isValidLatitude(lat) || !utils.isValidLongitude(lng)) return null;

        return {
          stationId: String(feature.properties?.station_id || feature.properties?.station_name || W.latLngKey({ lat, lng })),
          stationName: feature.properties?.station_name || "Station",
          fullStationName: feature.properties?.full_station_name || feature.properties?.station_name || "Station",
          lines: W.normalizeLines(feature.properties?.line),
          lat,
          lng
        };
      })
      .filter(Boolean);
    state.walkingTime.stationIndexSource = state.stationsGeojson;

    return state.walkingTime.stationIndex;
  }

  T.walkingTimeCityPacks = {
    loadCityPacks,
    getCityPacks,
    getNearestStations,
    getActiveCityPack
  };
})();
