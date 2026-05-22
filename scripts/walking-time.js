(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;
  const EARTH_RADIUS_METERS = 6371008.8;
  const PRICE_PATTERN = /(?:CA\$|C\$|\$)\s?\d[\d,.]*(?:\s?[KkMm])?/;
  const MAX_SCANNED_ELEMENTS = 1500;

  const walking = {
    started: false,
    tooltip: null,
    frame: 0,
    lastPointer: null,
    activeSignature: ""
  };

  function start() {
    if (walking.started) return;

    walking.started = true;
    createTooltip();
    loadCityPacks();
    document.addEventListener("pointermove", handlePointerMove, { passive: true, capture: true });
    document.addEventListener("pointerdown", () => clear("pointer down"), { passive: true, capture: true });
    window.addEventListener("blur", () => clear("window blur"), { passive: true });
    window.addEventListener("scroll", () => clear("window scroll"), { passive: true });
  }

  function getNearestStations(latLng, count = config.WALKING_RESULT_COUNT) {
    const origin = normalizeLatLng(latLng);
    if (!origin) return [];

    const limit = normalizeResultCount(count);
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
        straightLineMeters: Math.round(haversineMeters(origin, result)),
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
        const straightLineMeters = haversineMeters(origin, station);
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

  function getListingMarkerCandidates(options = {}) {
    const now = performance.now();
    const useCache =
      !options.force &&
      state.walkingTime.candidateCache &&
      now - state.walkingTime.candidateCacheAt < config.WALKING_MARKER_SCAN_MS;

    if (useCache) return state.walkingTime.candidateCache;

    const projectionStatus = getProjectionStatus();
    const rawCandidates = collectListingMarkerCandidates();
    const candidates = rawCandidates.slice(0, config.WALKING_MARKER_MAX_RESULTS).map((candidate) =>
      toDiagnosticCandidate(candidate, projectionStatus)
    );

    const result = {
      count: candidates.length,
      canProject: projectionStatus.ok,
      disabledReason: projectionStatus.ok ? "" : projectionStatus.reason,
      candidates
    };

    state.walkingTime.candidateCache = result;
    state.walkingTime.candidateCacheAt = now;
    return result;
  }

  function clear(reason = "manual") {
    state.walkingTime.candidateCache = null;
    state.walkingTime.candidateCacheAt = 0;
    state.walkingTime.lastClearReason = reason;

    if (walking.frame) {
      window.cancelAnimationFrame(walking.frame);
      walking.frame = 0;
    }

    walking.lastPointer = null;
    walking.activeSignature = "";

    if (walking.tooltip) {
      walking.tooltip.hidden = true;
    }
  }

  function createTooltip() {
    if (walking.tooltip) return;

    const tooltip = document.createElement("div");
    tooltip.id = "transit-walking-time";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    walking.tooltip = tooltip;
  }

  function handlePointerMove(event) {
    walking.lastPointer = {
      x: event.clientX,
      y: event.clientY
    };

    if (walking.frame) return;

    walking.frame = window.requestAnimationFrame(() => {
      walking.frame = 0;
      updateHover();
    });
  }

  function updateHover() {
    if (!walking.lastPointer) {
      clear("missing pointer");
      return;
    }

    const { x, y } = walking.lastPointer;
    if (!canShowTooltip() || !isInsideMap(x, y)) {
      clear("outside map or disabled");
      return;
    }

    const candidate = findHoveredCandidate(x, y);
    if (!candidate || !candidate.nearestStations?.length) {
      clear("no listing marker");
      return;
    }

    T.stationHover?.clear();
    showTooltip(candidate, x, y);
  }

  function canShowTooltip() {
    return Boolean(
      state.overlayEnabled &&
        state.hasValidMapState &&
        !state.zoomSync?.pending &&
        !state.panSmoothing?.active &&
        state.leafletMap &&
        state.mapElement &&
        walking.tooltip
    );
  }

  function findHoveredCandidate(clientX, clientY) {
    const diagnostics = getListingMarkerCandidates();
    if (!diagnostics.canProject) return null;

    return diagnostics.candidates
      .map((candidate) => {
        const rectDistance = getRectDistance(candidate.rect, clientX, clientY);
        const anchorDistance = Math.hypot(clientX - candidate.anchor.x, clientY - candidate.anchor.y);
        const hit = rectDistance <= config.WALKING_HOVER_RADIUS_PX || anchorDistance <= config.WALKING_HOVER_RADIUS_PX;

        return hit
          ? {
              ...candidate,
              hoverDistance: Math.min(rectDistance, anchorDistance)
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.hoverDistance - b.hoverDistance || b.score - a.score)[0] || null;
  }

  function showTooltip(candidate, clientX, clientY) {
    const commuteEstimate = T.transitTime?.getEstimateForLatLng(candidate.latLng);
    const signature = [
      candidate.text,
      candidate.latLng?.lat,
      candidate.latLng?.lng,
      candidate.nearestStations.map((station) => `${station.stationName}:${station.estimatedWalkMinutes}`).join("|"),
      commuteEstimate
        ? `${commuteEstimate.mode}:${commuteEstimate.label}:${commuteEstimate.totalMinutes}:${commuteEstimate.destinationLabel}`
        : ""
    ].join("|");

    if (walking.activeSignature !== signature) {
      walking.tooltip.innerHTML = [
        candidate.nearestStations.map(renderStationEstimate).join(""),
        T.transitTime?.renderTooltipEstimate(commuteEstimate) || ""
      ].join("");
      walking.activeSignature = signature;
    }

    const offset = config.WALKING_TOOLTIP_OFFSET_PX;
    walking.tooltip.hidden = false;
    const tooltipRect = walking.tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tooltipRect.width - 8, clientX + offset);
    const top = Math.min(window.innerHeight - tooltipRect.height - 8, clientY + offset);

    walking.tooltip.style.left = `${Math.max(8, left)}px`;
    walking.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function renderStationEstimate(station) {
    const lines = station.lines.map(renderLineBadge).join("");
    const minutesText = station.estimationSource === "precomputed-graph"
      ? `~${station.estimatedWalkMinutes} min walk`
      : `est. ${station.estimatedWalkMinutes} min walk`;

    return `
      <div class="transit-walking-time-row">
        <div class="transit-walking-time-main">
          <span class="transit-walking-time-name">${escapeHtml(station.stationName)}</span>
          <span class="transit-walking-time-minutes">${escapeHtml(minutesText)}</span>
        </div>
        <div class="transit-walking-time-lines">${lines}</div>
      </div>
    `;
  }

  function renderLineBadge(line) {
    return `<span class="transit-walking-time-line" data-line="${escapeHtml(line)}">${escapeHtml(line)}</span>`;
  }

  function toDiagnosticCandidate(candidate, projectionStatus) {
    const anchor = getAnchor(candidate);
    const projected = projectionStatus.ok ? projectAnchor(anchor) : null;
    const nearestStations = projected ? getNearestStations(projected, config.WALKING_RESULT_COUNT) : [];

    return {
      element: utils.describeElement(candidate.element),
      text: candidate.text,
      rect: utils.formatRect(candidate.rect),
      visibleRatio: round(candidate.visibleRatio, 3),
      anchor: {
        type: anchor.type,
        x: Math.round(anchor.x),
        y: Math.round(anchor.y),
        containerX: projected?.containerX ?? null,
        containerY: projected?.containerY ?? null
      },
      latLng: projected
        ? {
            lat: projected.lat,
            lng: projected.lng
          }
        : null,
      nearestStations,
      score: candidate.score,
      reasons: candidate.reasons
    };
  }

  function collectListingMarkerCandidates() {
    if (!state.mapElement?.isConnected) return [];

    const mapRect = state.mapElement.getBoundingClientRect();
    if (!hasArea(mapRect)) return [];

    const elements = Array.from(
      state.mapElement.querySelectorAll("button, [role='button'], a, [aria-label], span, div")
    ).slice(0, MAX_SCANNED_ELEMENTS);

    const candidates = elements
      .map((element) => evaluateCandidateElement(element, mapRect))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || getArea(a.rect) - getArea(b.rect));

    return dedupeCandidates(candidates);
  }

  function evaluateCandidateElement(element, mapRect) {
    if (!(element instanceof Element)) return null;
    if (isExtensionElement(element) || isMapControlElement(element)) return null;

    const text = getCandidateText(element);
    if (!PRICE_PATTERN.test(text)) return null;

    const rect = element.getBoundingClientRect();
    if (!isMarkerLikeRect(rect, text)) return null;

    const visibleArea = getIntersectionArea(mapRect, rect);
    if (visibleArea <= 0) return null;

    const styles = window.getComputedStyle(element);
    if (styles.display === "none" || styles.visibility === "hidden" || Number(styles.opacity) === 0) return null;

    const visibleRatio = visibleArea / getArea(rect);
    if (visibleRatio < 0.45) return null;

    const reasons = ["price-like text", "marker-sized", "inside map"];
    const score = scoreCandidate(element, rect, text, styles, reasons);

    return {
      element,
      rect,
      text,
      visibleRatio,
      score,
      reasons
    };
  }

  function scoreCandidate(element, rect, text, styles, reasons) {
    let score = 40;
    const width = rect.width;
    const height = rect.height;

    if (width >= 30 && width <= 120 && height >= 18 && height <= 48) {
      score += 20;
      reasons.push("price bubble proportions");
    }

    if (element.matches("button, a, [role='button']")) {
      score += 12;
      reasons.push("interactive marker shell");
    }

    if (text.length <= 24) {
      score += 8;
      reasons.push("compact label");
    }

    if (hasVisiblePaint(styles)) {
      score += 6;
      reasons.push("visible marker styling");
    }

    if (Math.abs(width - height) <= 8 && width <= 48) {
      score += 4;
      reasons.push("circular marker proportions");
    }

    const childPriceCount = Array.from(element.children || []).filter((child) =>
      PRICE_PATTERN.test(getCandidateText(child))
    ).length;
    if (childPriceCount > 1) {
      score -= 25;
      reasons.push("multiple price children");
    }

    return score;
  }

  function dedupeCandidates(candidates) {
    const deduped = [];

    for (const candidate of candidates) {
      const duplicate = deduped.some((existing) => {
        if (candidate.text !== existing.text) return false;
        return getRectOverlapRatio(candidate.rect, existing.rect) > 0.72;
      });

      if (!duplicate) deduped.push(candidate);
    }

    return deduped;
  }

  function getAnchor(candidate) {
    const { rect } = candidate;
    const isCircular = Math.abs(rect.width - rect.height) <= 8 && rect.width <= 48;
    const type = isCircular ? "center" : "bottom-center";

    if (type === "center") {
      return {
        type,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }

    return {
      type,
      x: rect.left + rect.width / 2,
      y: rect.bottom
    };
  }

  function projectAnchor(anchor) {
    const overlayRect = state.leafletNode.getBoundingClientRect();
    const containerX = anchor.x - overlayRect.left;
    const containerY = anchor.y - overlayRect.top;
    const latLng = state.leafletMap.containerPointToLatLng([containerX, containerY]);

    return {
      lat: roundCoordinate(latLng.lat),
      lng: roundCoordinate(latLng.lng),
      containerX: Math.round(containerX),
      containerY: Math.round(containerY)
    };
  }

  function getProjectionStatus() {
    if (!state.overlayEnabled) return { ok: false, reason: "overlay disabled" };
    if (!state.hasValidMapState) return { ok: false, reason: "invalid map state" };
    if (state.zoomSync?.pending) return { ok: false, reason: "zoom settling" };
    if (state.panSmoothing?.active) return { ok: false, reason: "pan smoothing active" };
    if (!state.mapElement?.isConnected) return { ok: false, reason: "map element unavailable" };
    if (!state.overlay || state.overlay.hidden || state.overlay.style.visibility === "hidden") {
      return { ok: false, reason: "overlay hidden" };
    }
    if (!state.leafletNode || !state.leafletMap) return { ok: false, reason: "leaflet map unavailable" };

    return { ok: true, reason: "" };
  }

  function isInsideMap(x, y) {
    if (!state.mapElement) return false;
    const rect = state.mapElement.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function getActiveCityPack(origin) {
    return state.walkingTime.cityPacks.find((pack) => isInsideBounds(origin, pack.bounds)) || null;
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
          lines: normalizeLines(station.lines || station.line),
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
          : haversineMeters(nodeById.get(fromId), nodeById.get(toId));

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
    const lngRadius = cityPack.snapMaxMeters / Math.max(1, 111320 * Math.cos(toRadians(origin.lat)));
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
    const a = toLocalPoint(base, fromNode);
    const b = toLocalPoint(base, toNode);
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
          stationId: String(feature.properties?.station_id || feature.properties?.station_name || latLngKey({ lat, lng })),
          stationName: feature.properties?.station_name || "Station",
          fullStationName: feature.properties?.full_station_name || feature.properties?.station_name || "Station",
          lines: normalizeLines(feature.properties?.line),
          lat,
          lng
        };
      })
      .filter(Boolean);
    state.walkingTime.stationIndexSource = state.stationsGeojson;

    return state.walkingTime.stationIndex;
  }

  function normalizeLatLng(value) {
    if (!value) return null;

    const lat = Array.isArray(value) ? Number(value[0]) : Number(value.lat);
    const lng = Array.isArray(value) ? Number(value[1]) : Number(value.lng ?? value.lon);

    if (!utils.isValidLatitude(lat) || !utils.isValidLongitude(lng)) return null;
    return { lat, lng };
  }

  function normalizeResultCount(count) {
    const parsed = Math.round(Number(count));
    if (!Number.isFinite(parsed)) return config.WALKING_RESULT_COUNT;
    return Math.min(10, Math.max(1, parsed));
  }

  function normalizeLines(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") return [value];
    return [];
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

  function toLocalPoint(base, latLng) {
    const latRadians = toRadians(base.lat);
    return {
      x: toRadians(latLng.lng - base.lng) * Math.cos(latRadians) * EARTH_RADIUS_METERS,
      y: toRadians(latLng.lat - base.lat) * EARTH_RADIUS_METERS
    };
  }

  function isInsideBounds(latLng, bounds) {
    return Boolean(
      bounds &&
        latLng.lng >= bounds.west &&
        latLng.lng <= bounds.east &&
        latLng.lat >= bounds.south &&
        latLng.lat <= bounds.north
    );
  }

  function latLngKey(latLng) {
    return `${roundCoordinate(latLng.lat)},${roundCoordinate(latLng.lng)}`;
  }

  function isMarkerLikeRect(rect, text) {
    if (!hasArea(rect)) return false;

    const width = rect.width;
    const height = rect.height;
    const area = getArea(rect);

    return (
      text.length <= 60 &&
      width >= 16 &&
      width <= 180 &&
      height >= 14 &&
      height <= 80 &&
      area <= 10000
    );
  }

  function getCandidateText(element) {
    return [
      element.textContent || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || ""
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function isExtensionElement(element) {
    return Boolean(
      element.closest(
        `#${config.OVERLAY_ID}, #${config.TOGGLE_ID}, #${config.DEBUG_PANEL_ID}, #transit-station-hover, #transit-walking-time`
      )
    );
  }

  function isMapControlElement(element) {
    return Boolean(
      element.closest(
        [
          '[aria-label*="Zoom" i]',
          '[aria-label*="Map" i][role="button"]',
          '[aria-label*="Keyboard" i]',
          '[aria-label*="Directions" i]',
          '[aria-label*="Current location" i]',
          '[aria-label*="Locate" i]'
        ].join(",")
      )
    );
  }

  function hasVisiblePaint(styles) {
    return (
      styles.backgroundColor !== "rgba(0, 0, 0, 0)" ||
      styles.borderTopColor !== "rgba(0, 0, 0, 0)" ||
      styles.boxShadow !== "none"
    );
  }

  function hasArea(rect) {
    return rect.width > 0 && rect.height > 0;
  }

  function getArea(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function getIntersectionArea(a, b) {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function getRectOverlapRatio(a, b) {
    const overlap = getIntersectionArea(a, b);
    const smallerArea = Math.min(getArea(a), getArea(b));
    return smallerArea ? overlap / smallerArea : 0;
  }

  function getRectDistance(rect, x, y) {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.hypot(dx, dy);
  }

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function round(value, places) {
    const multiplier = 10 ** places;
    return Math.round(value * multiplier) / multiplier;
  }

  function roundCoordinate(value) {
    return round(value, 6);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      const replacements = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      };
      return replacements[character];
    });
  }

  T.walkingTime = {
    start,
    clear,
    getCityPacks,
    getNearestStations,
    getListingMarkerCandidates
  };
})();
