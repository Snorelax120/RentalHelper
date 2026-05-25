(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;
  const EARTH_RADIUS_METERS = 6371008.8;

  const commute = {
    started: false,
    frame: 0
  };

  function start() {
    if (commute.started) return;

    commute.started = true;
    createPanel();
    loadStoredState();
    loadCityPacks();
  }

  function createPanel() {
    if (state.transitTime.panelButton || state.transitTime.panel) return;

    const button = document.createElement("button");
    button.id = "transit-commute-toggle";
    button.type = "button";
    button.innerHTML = `<span aria-hidden="true"></span><strong>Commute</strong>`;
    button.hidden = true;
    button.setAttribute("aria-controls", "transit-commute-panel");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      setPanelOpen(!state.transitTime.panelOpen);
    });

    const panel = document.createElement("section");
    panel.id = "transit-commute-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Commute estimate settings");
    panel.innerHTML = `
      <div class="transit-commute-header">
        <div>
          <div class="transit-commute-title">Commute</div>
          <div class="transit-commute-subtitle">Offline estimate from listings</div>
        </div>
        <button type="button" class="transit-commute-close" data-commute-action="close">Close</button>
      </div>
      <label class="transit-commute-label" for="transit-commute-destination">Destination</label>
      <div class="transit-commute-input-row">
        <input id="transit-commute-destination" type="text" autocomplete="off" placeholder="725 Granville St">
      </div>
      <div id="transit-commute-suggestions" role="listbox" hidden></div>
      <div class="transit-commute-mode-title">Transit modes</div>
      <div class="transit-commute-modes" aria-label="Transit modes">
        <label><input type="checkbox" data-commute-mode="metro"><span>SkyTrain</span></label>
        <label><input type="checkbox" data-commute-mode="bus"><span>Bus</span></label>
      </div>
      <div class="transit-commute-actions">
        <button type="button" data-commute-action="clear">Clear destination</button>
      </div>
      <div id="transit-commute-status" aria-live="polite"></div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(panel);

    state.transitTime.panelButton = button;
    state.transitTime.panel = panel;
    state.transitTime.input = panel.querySelector("#transit-commute-destination");
    state.transitTime.suggestions = panel.querySelector("#transit-commute-suggestions");
    state.transitTime.status = panel.querySelector("#transit-commute-status");

    state.transitTime.input.addEventListener("input", handleDestinationInput);
    state.transitTime.input.addEventListener("focus", handleDestinationInput);
    panel.addEventListener("change", handleModeChange);
    panel.addEventListener("click", handlePanelClick);
    syncPanelState();
  }

  async function loadStoredState() {
    if (!chrome?.storage?.local) return;

    const stored = await chrome.storage.local.get([
      config.COMMUTE_DESTINATION_STORAGE_KEY,
      config.COMMUTE_MODES_STORAGE_KEY,
      config.COMMUTE_PANEL_OPEN_STORAGE_KEY
    ]);

    state.transitTime.destination = normalizeDestination(stored[config.COMMUTE_DESTINATION_STORAGE_KEY]);
    state.transitTime.modes = normalizeModes(stored[config.COMMUTE_MODES_STORAGE_KEY]);
    state.transitTime.panelOpen = Boolean(stored[config.COMMUTE_PANEL_OPEN_STORAGE_KEY]);
    syncPanelState();
  }

  async function loadCityPacks() {
    if (state.transitTime.packsLoading || state.transitTime.packsLoaded) return;

    state.transitTime.packsLoading = true;
    state.transitTime.packLoadError = "";
    updateStatus("Loading offline commute data...");

    try {
      const packs = await Promise.all(config.TRANSIT_CITY_PACKS.map(loadCityPack));
      state.transitTime.packs = packs.filter(Boolean);
      state.transitTime.packsLoaded = true;
      updateStatus(getStatusText());
    } catch (error) {
      state.transitTime.packLoadError = error instanceof Error ? error.message : String(error);
      updateStatus("Commute data failed to load.");
      utils.debugLog("Commute city pack load failed", state.transitTime.packLoadError);
    } finally {
      state.transitTime.packsLoading = false;
    }
  }

  async function loadCityPack(entry) {
    const manifest = await fetchJson(entry.resource);
    const basePath = entry.resource.slice(0, entry.resource.lastIndexOf("/") + 1);
    const [addresses, transit, grid] = await Promise.all([
      fetchJson(`${basePath}${manifest.resources.addresses.resource}`),
      fetchJson(`${basePath}${manifest.resources.transit.resource}`),
      fetchJson(`${basePath}${manifest.grid.resource}`)
    ]);

    return normalizeCityPack({ entry, manifest, addresses, transit, grid });
  }

  async function fetchJson(resource) {
    const response = await fetch(chrome.runtime.getURL(resource));
    if (!response.ok) {
      throw new Error(`Failed to load ${resource}: ${response.status}`);
    }
    return response.json();
  }

  function normalizeCityPack({ entry, manifest, addresses, transit, grid }) {
    const normalizedAddresses = (addresses.entries || [])
      .map((entry, index) => ({
        index,
        label: String(entry[0] || ""),
        search: String(entry[1] || ""),
        lat: Number(entry[2]),
        lng: Number(entry[3]),
        cellId: String(entry[4] || ""),
        kind: String(entry[5] || "address")
      }))
      .filter((entry) => entry.label && isValidLatLng(entry));

    const stops = (transit.stops || [])
      .map((stop, index) => ({
        index,
        id: String(stop[0] || index),
        code: String(stop[1] || ""),
        name: String(stop[2] || "Stop"),
        mode: String(stop[3] || ""),
        lat: Number(stop[4]),
        lng: Number(stop[5]),
        cellId: String(stop[6] || ""),
        routes: Array.isArray(stop[7]) ? stop[7] : []
      }))
      .filter((stop) => isValidLatLng(stop) && ["bus", "metro"].includes(stop.mode));

    const routes = (transit.routes || []).map((route, index) => ({
      index,
      id: String(route[0] || index),
      label: String(route[1] || route[2] || "Transit"),
      name: String(route[2] || route[1] || "Transit"),
      mode: String(route[3] || "")
    }));
    const routeEdges = (transit.routeEdges || [])
      .map((edge) => ({
        from: Number(edge[0]),
        to: Number(edge[1]),
        minutes: Number(edge[2]),
        routeIndex: Number(edge[3]),
        transfer: false
      }))
      .filter((edge) => stops[edge.from] && stops[edge.to] && routes[edge.routeIndex] && edge.minutes > 0);
    const transferEdges = (transit.transferEdges || [])
      .map((edge) => ({
        from: Number(edge[0]),
        to: Number(edge[1]),
        minutes: Number(edge[2]),
        routeIndex: null,
        transfer: true
      }))
      .filter((edge) => stops[edge.from] && stops[edge.to] && edge.minutes > 0);
    const gridCells = new Map((grid.cells || []).map((cell) => [String(cell[0]), cell]));
    const adjacency = buildTransitAdjacency([...routeEdges, ...transferEdges]);

    return {
      id: manifest.id || entry.id,
      name: manifest.name || entry.name,
      bounds: normalizeBounds(manifest.bounds),
      addresses: normalizedAddresses,
      stops,
      routes,
      routeEdges,
      transferEdges,
      adjacency,
      gridCells
    };
  }

  function buildTransitAdjacency(edges) {
    const adjacency = new Map();
    for (const edge of edges) {
      const entries = adjacency.get(edge.from) || [];
      entries.push(edge);
      adjacency.set(edge.from, entries);
    }
    return adjacency;
  }

  function handleDestinationInput() {
    if (commute.frame) window.cancelAnimationFrame(commute.frame);
    commute.frame = window.requestAnimationFrame(() => {
      commute.frame = 0;
      renderSuggestions(state.transitTime.input.value);
    });
  }

  function handleModeChange(event) {
    const mode = event.target?.getAttribute?.("data-commute-mode");
    if (!mode) return;

    state.transitTime.modes = normalizeModes({
      ...state.transitTime.modes,
      [mode]: Boolean(event.target.checked)
    });
    persist(config.COMMUTE_MODES_STORAGE_KEY, state.transitTime.modes);
    syncPanelState();
  }

  function handlePanelClick(event) {
    const action = event.target?.getAttribute?.("data-commute-action");
    if (action === "close") {
      setPanelOpen(false);
      return;
    }

    if (action === "clear") {
      setDestination(null);
      state.transitTime.input.value = "";
      hideSuggestions();
      syncPanelState();
      return;
    }

    const suggestionButton = event.target?.closest?.("[data-commute-suggestion]");
    if (!suggestionButton) return;

    const index = Number(suggestionButton.getAttribute("data-commute-suggestion"));
    const suggestion = state.transitTime.lastSuggestions[index];
    if (!suggestion) return;

    setDestination({
      label: suggestion.label,
      lat: suggestion.lat,
      lng: suggestion.lng,
      source: suggestion.source || suggestion.kind || "offline-address-index"
    });
    hideSuggestions();
    syncPanelState();
  }

  function renderSuggestions(query) {
    const suggestions = searchDestinations(query);
    state.transitTime.lastSuggestions = suggestions;

    const suggestionsNode = state.transitTime.suggestions;
    if (!suggestionsNode) return;

    if (!query.trim() || !suggestions.length) {
      hideSuggestions();
      updateStatus(getStatusText());
      return;
    }

    suggestionsNode.innerHTML = suggestions
      .map(
        (suggestion, index) => `
          <button type="button" role="option" data-commute-suggestion="${index}">
            <span>${escapeHtml(suggestion.label)}</span>
            <small>${escapeHtml(getSuggestionMeta(suggestion))}</small>
          </button>
        `
      )
      .join("");
    suggestionsNode.hidden = false;
    updateStatus("");
  }

  function searchDestinations(query) {
    const parsedLatLng = parseLatLngInput(query);
    if (parsedLatLng) {
      return [
        {
          label: `${parsedLatLng.lat.toFixed(5)}, ${parsedLatLng.lng.toFixed(5)}`,
          search: normalizeSearchText(query),
          lat: parsedLatLng.lat,
          lng: parsedLatLng.lng,
          kind: "coordinates",
          source: "coordinates",
          score: 1000
        }
      ];
    }

    const normalized = normalizeSearchText(query);
    if (normalized.length < 2) return [];

    const tokens = normalized.split(" ").filter(Boolean);
    const activeCenter = state.lastView || { lat: config.DEFAULT_CENTER[0], lng: config.DEFAULT_CENTER[1] };
    const matches = [];

    for (const pack of state.transitTime.packs) {
      for (const address of pack.addresses) {
        const score = scoreAddressMatch(address, normalized, tokens, activeCenter);
        if (score <= 0) continue;
        matches.push({
          ...address,
          source: "offline-address-index",
          score
        });
      }
    }

    return matches
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, config.COMMUTE_ADDRESS_RESULT_LIMIT);
  }

  function scoreAddressMatch(address, normalized, tokens, activeCenter) {
    if (!tokens.every((token) => address.search.includes(token))) return 0;

    let score = 40 + tokens.length * 12;
    if (address.search.startsWith(normalized)) score += 80;
    if (address.search.includes(` ${normalized}`)) score += 30;
    if (address.kind === "station") score += 12;

    const distanceKm = haversineMeters(activeCenter, address) / 1000;
    score += Math.max(0, 30 - distanceKm);
    return score;
  }

  function getEstimateForLatLng(latLng) {
    const origin = normalizeLatLng(latLng);
    const destination = state.transitTime.destination;
    const modes = state.transitTime.modes;

    if (!origin || !destination || !hasEnabledMode(modes)) return null;
    if (!state.transitTime.packsLoaded) return null;

    return getRouteGraphEstimate(origin, destination, modes) || getDirectStopEstimate(origin, destination, modes);
  }

  function getRouteGraphEstimate(origin, destination, modes) {
    const candidates = state.transitTime.packs
      .map((pack) => getPackRouteEstimate(pack, origin, destination, modes))
      .filter(Boolean);
    return candidates.sort(compareRouteEstimates)[0] || null;
  }

  function getPackRouteEstimate(pack, origin, destination, modes) {
    if (!pack.adjacency?.size) return null;

    const originStops = getNearestStopsFromPack(pack, origin, modes, config.COMMUTE_RESULT_STOP_LIMIT);
    const destinationStops = getNearestStopsFromPack(pack, destination, modes, config.COMMUTE_RESULT_STOP_LIMIT);
    if (!originStops.length || !destinationStops.length) return null;

    const destinationByIndex = new Map(destinationStops.map((stop) => [stop.index, stop]));
    const queue = new MinQueue();
    const distances = new Map();
    const previous = new Map();
    const maxRouteSegments = Math.max(1, Number(config.COMMUTE_MAX_ROUTE_SEGMENTS) || 2);

    for (const stop of originStops) {
      const key = getRouteStateKey(stop.index, null, 0);
      distances.set(key, stop.walkMinutes);
      previous.set(key, {
        previousKey: null,
        edge: null,
        accessStop: stop,
        stopIndex: stop.index,
        routeIndex: null,
        routeSegments: 0
      });
      queue.push({
        key,
        index: stop.index,
        routeIndex: null,
        routeSegments: 0,
        distance: stop.walkMinutes
      });
    }

    let best = null;

    while (queue.size) {
      const current = queue.pop();
      if (current.distance !== distances.get(current.key)) continue;
      if (best && current.distance >= best.totalMinutes) continue;

      const destinationStop = destinationByIndex.get(current.index);
      if (destinationStop) {
        const totalMinutes = Math.round(current.distance + destinationStop.walkMinutes);
        const estimate = buildRouteEstimate(pack, current.key, destinationStop, totalMinutes, previous);
        if (isReadableRouteEstimate(estimate) && (!best || compareRouteEstimates(estimate, best) < 0)) {
          best = estimate;
        }
      }

      for (const edge of pack.adjacency.get(current.index) || []) {
        const nextState = getNextRouteState(edge, current, pack, modes, maxRouteSegments);
        if (!nextState) continue;

        const nextDistance = current.distance + getEdgeCostMinutes(edge, pack) + nextState.extraMinutes;
        if (nextDistance > config.TRANSIT_MAX_RESULT_MINUTES) continue;
        if (distances.has(nextState.key) && distances.get(nextState.key) <= nextDistance) continue;

        distances.set(nextState.key, nextDistance);
        previous.set(nextState.key, {
          previousKey: current.key,
          edge,
          stopIndex: edge.to,
          routeIndex: nextState.routeIndex,
          routeSegments: nextState.routeSegments
        });
        queue.push({
          key: nextState.key,
          index: edge.to,
          routeIndex: nextState.routeIndex,
          routeSegments: nextState.routeSegments,
          distance: nextDistance
        });
      }
    }

    return best;
  }

  function getRouteStateKey(stopIndex, routeIndex, routeSegments) {
    return `${stopIndex}|${routeIndex === null || routeIndex === undefined ? "none" : routeIndex}|${routeSegments}`;
  }

  function getNextRouteState(edge, current, pack, modes, maxRouteSegments) {
    if (edge.transfer) {
      return {
        key: getRouteStateKey(edge.to, null, current.routeSegments),
        routeIndex: null,
        routeSegments: current.routeSegments,
        extraMinutes: 0
      };
    }

    const route = pack.routes[edge.routeIndex];
    if (!route || !modes[route.mode]) return null;

    const isNewRouteSegment = current.routeIndex !== edge.routeIndex;
    const routeSegments = current.routeSegments + (isNewRouteSegment ? 1 : 0);
    if (routeSegments > maxRouteSegments) return null;

    return {
      key: getRouteStateKey(edge.to, edge.routeIndex, routeSegments),
      routeIndex: edge.routeIndex,
      routeSegments,
      extraMinutes:
        current.routeSegments > 0 && isNewRouteSegment
          ? config.COMMUTE_ROUTE_CHANGE_PENALTY_MINUTES
          : 0
    };
  }

  function buildRouteEstimate(pack, destinationStateKey, destinationStop, totalMinutes, previous) {
    const pathEdges = [];
    let cursor = destinationStateKey;
    let accessStop = null;

    while (previous.has(cursor)) {
      const entry = previous.get(cursor);
      if (entry.accessStop) accessStop = entry.accessStop;
      if (entry.edge) pathEdges.push(entry.edge);
      if (entry.previousKey === null || entry.previousKey === undefined) break;
      cursor = entry.previousKey;
    }

    pathEdges.reverse();
    if (!accessStop) return null;

    const routeSegments = summarizeRouteSegments(pathEdges, pack);
    if (!routeSegments.length) return null;

    const transitMinutes = routeSegments.reduce((sum, segment) => sum + segment.minutes, 0);
    const transferWalkMinutes = pathEdges
      .filter((edge) => edge.transfer)
      .reduce((sum, edge) => sum + getEdgeCostMinutes(edge, pack), 0) +
      Math.max(0, routeSegments.length - 1) * config.COMMUTE_ROUTE_CHANGE_PENALTY_MINUTES;
    const routeLabels = routeSegments.map((segment) => segment.label);
    const modeLabels = Array.from(new Set(routeSegments.map((segment) => segment.mode === "metro" ? "SkyTrain" : "Bus")));
    const correctedTotalMinutes = Math.round(
      accessStop.walkMinutes + transitMinutes + transferWalkMinutes + destinationStop.walkMinutes
    );

    return {
      mode: routeSegments.some((segment) => segment.mode === "bus") ? "bus" : "metro",
      label: routeLabels.length ? routeLabels.join(" + ") : modeLabels.join(" + "),
      confidence: "static-gtfs",
      destinationLabel: state.transitTime.destination?.label || "destination",
      totalMinutes: Math.max(totalMinutes, correctedTotalMinutes),
      totalMeters: 0,
      accessWalkMinutes: accessStop.walkMinutes,
      egressWalkMinutes: destinationStop.walkMinutes,
      transferWalkMinutes,
      transitMinutes: Math.max(1, Math.round(transitMinutes)),
      originStop: accessStop,
      destinationStop,
      routeSegments,
      routeLabels
    };
  }

  function summarizeRouteSegments(pathEdges, pack) {
    const segments = [];
    let lastWasTransfer = false;

    for (const edge of pathEdges) {
      if (edge.transfer) {
        lastWasTransfer = true;
        continue;
      }
      const route = pack.routes[edge.routeIndex];
      if (!route) continue;

      const current = segments[segments.length - 1];
      if (current && current.routeIndex === edge.routeIndex && !lastWasTransfer) {
        current.minutes += getEdgeCostMinutes(edge, pack);
        current.toStop = pack.stops[edge.to];
        lastWasTransfer = false;
        continue;
      }

      segments.push({
        routeIndex: edge.routeIndex,
        label: route.label,
        name: route.name,
        mode: route.mode,
        minutes: getEdgeCostMinutes(edge, pack),
        fromStop: pack.stops[edge.from],
        toStop: pack.stops[edge.to]
      });
      lastWasTransfer = false;
    }

    return segments;
  }

  function isReadableRouteEstimate(estimate) {
    if (!estimate?.routeSegments?.length) return false;
    const maxRouteSegments = Math.max(1, Number(config.COMMUTE_MAX_ROUTE_SEGMENTS) || 2);
    return estimate.routeSegments.length <= maxRouteSegments;
  }

  function compareRouteEstimates(a, b) {
    const aSegments = a.routeSegments?.length || 99;
    const bSegments = b.routeSegments?.length || 99;
    const timeDelta = a.totalMinutes - b.totalMinutes;

    if (aSegments !== bSegments && Math.abs(timeDelta) <= 8) {
      return aSegments - bSegments;
    }

    return (
      timeDelta ||
      aSegments - bSegments ||
      a.transferWalkMinutes - b.transferWalkMinutes ||
      a.transitMinutes - b.transitMinutes
    );
  }

  function getEdgeCostMinutes(edge, pack) {
    if (edge.transfer) {
      return edge.minutes + config.COMMUTE_TRANSFER_PENALTY_MINUTES;
    }

    const route = pack.routes[edge.routeIndex];
    const multiplier = route?.mode === "bus"
      ? config.COMMUTE_BUS_TIME_MULTIPLIER
      : config.COMMUTE_METRO_TIME_MULTIPLIER;
    return Math.max(1, edge.minutes * multiplier);
  }

  function getDirectStopEstimate(origin, destination, modes) {
    const candidates = [];
    if (modes.metro) candidates.push(getDirectModeEstimate(origin, destination, "metro"));
    if (modes.bus) candidates.push(getDirectModeEstimate(origin, destination, "bus"));

    return candidates
      .filter(Boolean)
      .sort((a, b) => a.totalMinutes - b.totalMinutes || a.totalMeters - b.totalMeters)[0] || null;
  }

  function getDirectModeEstimate(origin, destination, mode) {
    const originStops = getNearestStops(origin, { [mode]: true }, config.COMMUTE_RESULT_STOP_LIMIT);
    const destinationStops = getNearestStops(destination, { [mode]: true }, config.COMMUTE_RESULT_STOP_LIMIT);
    if (!originStops.length || !destinationStops.length) return null;

    let best = null;
    for (const originStop of originStops) {
      for (const destinationStop of destinationStops) {
        if (originStop.id === destinationStop.id) continue;

        const accessMeters = originStop.walkMeters;
        const egressMeters = destinationStop.walkMeters;
        const transitMeters = haversineMeters(originStop, destinationStop) * config.COMMUTE_TRANSIT_CIRCUITY_FACTOR;
        const transitMinutes = transitMeters / getModeSpeedMetersPerMinute(mode);
        const totalMinutes = Math.max(
          1,
          Math.round(
            accessMeters / config.WALKING_SPEED_METERS_PER_MINUTE +
              transitMinutes +
              egressMeters / config.WALKING_SPEED_METERS_PER_MINUTE
          )
        );

        const estimate = {
          mode,
          label: mode === "metro" ? "SkyTrain" : "Bus",
          confidence: "rough-direct",
          destinationLabel: destination.label,
          totalMinutes,
          totalMeters: accessMeters + transitMeters + egressMeters,
          accessWalkMinutes: Math.max(1, Math.round(accessMeters / config.WALKING_SPEED_METERS_PER_MINUTE)),
          egressWalkMinutes: Math.max(1, Math.round(egressMeters / config.WALKING_SPEED_METERS_PER_MINUTE)),
          transferWalkMinutes: 0,
          transitMinutes: Math.max(1, Math.round(transitMinutes)),
          originStop,
          destinationStop,
          routeSegments: [],
          routeLabels: []
        };

        if (!best || estimate.totalMinutes < best.totalMinutes || estimate.totalMeters < best.totalMeters) {
          best = estimate;
        }
      }
    }

    return best;
  }

  function getNearestStops(latLng, modes = state.transitTime.modes, limit = config.COMMUTE_RESULT_STOP_LIMIT) {
    const origin = normalizeLatLng(latLng);
    if (!origin) return [];

    const enabledModes = new Set(Object.entries(modes).filter(([, enabled]) => enabled).map(([mode]) => mode));
    if (!enabledModes.size) return [];

    return state.transitTime.packs
      .flatMap((pack) => pack.stops)
      .filter((stop) => enabledModes.has(stop.mode))
      .map((stop) => {
        const straightMeters = haversineMeters(origin, stop);
        const walkMeters = straightMeters * config.WALKING_CIRCUITY_FACTOR;
        return {
          ...stop,
          straightMeters: Math.round(straightMeters),
          walkMeters: Math.round(walkMeters),
          walkMinutes: Math.max(1, Math.round(walkMeters / config.WALKING_SPEED_METERS_PER_MINUTE))
        };
      })
      .sort((a, b) => a.walkMeters - b.walkMeters || a.name.localeCompare(b.name))
      .slice(0, Math.max(1, limit));
  }

  function getNearestStopsFromPack(pack, latLng, modes = state.transitTime.modes, limit = config.COMMUTE_RESULT_STOP_LIMIT) {
    const origin = normalizeLatLng(latLng);
    if (!origin) return [];

    const enabledModes = new Set(Object.entries(modes).filter(([, enabled]) => enabled).map(([mode]) => mode));
    if (!enabledModes.size) return [];

    return pack.stops
      .filter((stop) => enabledModes.has(stop.mode))
      .map((stop) => {
        const straightMeters = haversineMeters(origin, stop);
        const walkMeters = straightMeters * config.WALKING_CIRCUITY_FACTOR;
        return {
          ...stop,
          straightMeters: Math.round(straightMeters),
          walkMeters: Math.round(walkMeters),
          walkMinutes: Math.max(1, Math.round(walkMeters / config.WALKING_SPEED_METERS_PER_MINUTE))
        };
      })
      .sort((a, b) => a.walkMeters - b.walkMeters || a.name.localeCompare(b.name))
      .slice(0, Math.max(1, limit));
  }

  function renderTooltipEstimate(estimate) {
    if (!estimate) return "";
    const transitModeText = getTransitBreakdownLabel(estimate);

    return `
      <div class="transit-walking-time-row transit-commute-estimate">
        <div class="transit-walking-time-main">
          <span class="transit-walking-time-name">To ${escapeHtml(shortDestinationLabel(estimate.destinationLabel))}</span>
          <span class="transit-walking-time-minutes">about ${estimate.totalMinutes} min</span>
        </div>
        ${renderRouteSteps(estimate)}
        <div class="transit-commute-breakdown">
          <span>${estimate.accessWalkMinutes}m walk</span>
          <span>${estimate.transitMinutes}m ${escapeHtml(transitModeText)}</span>
          ${estimate.transferWalkMinutes ? `<span>${estimate.transferWalkMinutes}m transfer</span>` : ""}
          <span>${estimate.egressWalkMinutes}m walk</span>
        </div>
      </div>
    `;
  }

  function renderRouteSteps(estimate) {
    const steps = [];

    if (estimate.accessWalkMinutes && estimate.originStop?.name) {
      steps.push({
        kind: "walk",
        badge: `${estimate.accessWalkMinutes}m`,
        title: "Walk to stop",
        detail: `to ${cleanStopName(estimate.originStop.name)}`
      });
    }

    if (estimate.routeSegments?.length) {
      estimate.routeSegments.forEach((segment, index) => {
        steps.push({
          kind: segment.mode,
          badge: formatStepMinutes(segment.minutes),
          title: `${index === 0 ? "Take" : "Transfer to"} ${formatSegmentLabel(segment)}`,
          detail: getSegmentDetail(segment, index)
        });
      });
    } else if (estimate.originStop?.name) {
      steps.push({
        kind: estimate.mode,
        badge: formatStepMinutes(estimate.transitMinutes),
        title: estimate.label,
        detail: `near ${cleanStopName(estimate.originStop.name)}`
      });
    }

    if (estimate.egressWalkMinutes && estimate.destinationStop?.name) {
      steps.push({
        kind: "walk",
        badge: `${estimate.egressWalkMinutes}m`,
        title: "Walk to destination",
        detail: `from ${cleanStopName(estimate.destinationStop.name)}`
      });
    }

    return `
      <div class="transit-commute-steps">
        ${steps.map(renderRouteStep).join("")}
      </div>
    `;
  }

  function renderRouteStep(step) {
    return `
      <div class="transit-commute-step" data-kind="${escapeHtml(step.kind)}">
        <span class="transit-commute-step-badge">${escapeHtml(step.badge)}</span>
        <span class="transit-commute-step-text">
          <strong>${escapeHtml(step.title)}</strong>
          <small>${escapeHtml(step.detail)}</small>
        </span>
      </div>
    `;
  }

  function formatStepMinutes(minutes) {
    const value = Math.max(1, Math.round(Number(minutes) || 1));
    return `${value}m`;
  }

  function getSegmentDetail(segment, index) {
    const fromStop = cleanStopName(segment.fromStop?.name);
    const toStop = cleanStopName(segment.toStop?.name);

    if (index === 0) {
      return fromStop ? `board at ${fromStop}` : "";
    }

    if (fromStop) return `change at ${fromStop}`;
    if (toStop) return `toward ${toStop}`;
    return "";
  }

  function getTransitBreakdownLabel(estimate) {
    const modes = new Set((estimate.routeSegments || []).map((segment) => segment.mode));
    if (modes.has("bus") && modes.has("metro")) return "transit";
    if (estimate.mode === "bus") return "bus";
    if (estimate.mode === "metro") return "SkyTrain";
    return "transit";
  }

  function formatSegmentLabel(segment) {
    if (segment.mode === "bus") return `Bus ${segment.label}`;
    if (segment.mode === "metro") return segment.label;
    return segment.label;
  }

  function cleanStopName(name) {
    return String(name || "stop").replace(/\s*@\s*/g, " at ");
  }

  function positionPanel(rect) {
    if (!state.transitTime.panelButton || !state.transitTime.panel) return;

    if (!rect || !state.overlayEnabled || !state.hasValidMapState) {
      state.transitTime.panelButton.hidden = true;
      state.transitTime.panel.hidden = true;
      return;
    }

    const buttonTop = Math.max(8, rect.top + 54);
    const buttonLeft = Math.max(8, rect.right - 104);
    const panelWidth = Math.min(320, window.innerWidth - 24);
    Object.assign(state.transitTime.panelButton.style, {
      top: `${buttonTop}px`,
      left: `${buttonLeft}px`
    });
    state.transitTime.panelButton.hidden = false;

    Object.assign(state.transitTime.panel.style, {
      top: `${Math.max(8, buttonTop + 44)}px`,
      left: `${Math.max(8, Math.min(rect.right - panelWidth, buttonLeft - panelWidth + 104))}px`
    });
    state.transitTime.panel.hidden = !state.transitTime.panelOpen;
  }

  function setPanelOpen(open) {
    state.transitTime.panelOpen = Boolean(open);
    persist(config.COMMUTE_PANEL_OPEN_STORAGE_KEY, state.transitTime.panelOpen);
    syncPanelState();
    if (state.mapElement) positionPanel(T.map.getVisibleRect(state.mapElement));
  }

  function setDestination(destination) {
    state.transitTime.destination = normalizeDestination(destination);
    persist(config.COMMUTE_DESTINATION_STORAGE_KEY, state.transitTime.destination);
  }

  function syncPanelState() {
    const panel = state.transitTime.panel;
    if (!panel) return;

    const destination = state.transitTime.destination;
    if (state.transitTime.input && destination) {
      state.transitTime.input.value = destination.label;
    }

    for (const input of panel.querySelectorAll("[data-commute-mode]")) {
      const mode = input.getAttribute("data-commute-mode");
      input.checked = Boolean(state.transitTime.modes[mode]);
    }

    if (state.transitTime.panelButton) {
      state.transitTime.panelButton.dataset.open = String(state.transitTime.panelOpen);
      state.transitTime.panelButton.setAttribute("aria-expanded", String(state.transitTime.panelOpen));
    }
    panel.hidden = !state.transitTime.panelOpen;
    updateStatus(getStatusText());
  }

  function getStatusText() {
    if (state.transitTime.packLoadError) return "Offline commute data failed to load.";
    if (state.transitTime.packsLoading) return "Loading offline commute data...";
    if (!state.transitTime.packsLoaded) return "Offline commute data not loaded.";
    if (!state.transitTime.destination) return "Choose a destination to show commute estimates.";
    if (!hasEnabledMode(state.transitTime.modes)) return "Enable Bus or SkyTrain.";
    const enabled = [
      state.transitTime.modes.metro ? "SkyTrain" : "",
      state.transitTime.modes.bus ? "Bus" : ""
    ].filter(Boolean).join(" + ");
    return `${enabled} estimates enabled.`;
  }

  function updateStatus(text) {
    if (state.transitTime.status) {
      state.transitTime.status.textContent = text || "";
    }
  }

  function hideSuggestions() {
    if (!state.transitTime.suggestions) return;
    state.transitTime.suggestions.hidden = true;
    state.transitTime.suggestions.innerHTML = "";
    state.transitTime.lastSuggestions = [];
  }

  function getSuggestionMeta(suggestion) {
    if (suggestion.kind === "coordinates") return "Coordinates";
    if (suggestion.kind === "station") return "SkyTrain station";
    return "Offline address";
  }

  function normalizeDestination(value) {
    const lat = Number(value?.lat);
    const lng = Number(value?.lng);
    if (!value || !isValidLatLng({ lat, lng })) return null;
    return {
      label: String(value.label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
      lat,
      lng,
      source: String(value.source || "manual")
    };
  }

  function normalizeModes(value) {
    return {
      metro: value?.metro !== false,
      bus: Boolean(value?.bus)
    };
  }

  function hasEnabledMode(modes) {
    return Boolean(modes?.metro || modes?.bus);
  }

  function normalizeLatLng(value) {
    if (!value) return null;
    const lat = Number(value.lat ?? value[0]);
    const lng = Number(value.lng ?? value.lon ?? value[1]);
    return isValidLatLng({ lat, lng }) ? { lat, lng } : null;
  }

  function normalizeBounds(bounds) {
    if (!bounds) return null;
    return {
      west: Number(bounds.west),
      south: Number(bounds.south),
      east: Number(bounds.east),
      north: Number(bounds.north)
    };
  }

  function parseLatLngInput(query) {
    const match = String(query || "").match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (utils.isValidLatitude(first) && utils.isValidLongitude(second)) return { lat: first, lng: second };
    if (utils.isValidLongitude(first) && utils.isValidLatitude(second)) return { lat: second, lng: first };
    return null;
  }

  function getModeSpeedMetersPerMinute(mode) {
    const kmh = mode === "metro" ? config.COMMUTE_METRO_AVERAGE_SPEED_KMPH : config.COMMUTE_BUS_AVERAGE_SPEED_KMPH;
    return (kmh * 1000) / 60;
  }

  function shortDestinationLabel(label) {
    return String(label || "destination").replace(/,\s*Vancouver.*/i, "");
  }

  function persist(key, value) {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [key]: value });
    }
  }

  function isValidLatLng(latLng) {
    return utils.isValidLatitude(Number(latLng.lat)) && utils.isValidLongitude(Number(latLng.lng));
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

  function normalizeSearchText(value) {
    return String(value || "")
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
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
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

  class MinQueue {
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
      if (this.items.length === 1) return this.items.pop();

      const top = this.items[0];
      this.items[0] = this.items.pop();
      this.bubbleDown(0);
      return top;
    }

    bubbleUp(index) {
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.items[parent].distance <= this.items[index].distance) break;
        [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
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
        if (smallest === index) break;

        [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
        index = smallest;
      }
    }
  }

  function getDebugState() {
    return {
      loaded: state.transitTime.packsLoaded,
      loading: state.transitTime.packsLoading,
      error: state.transitTime.packLoadError,
      destination: state.transitTime.destination,
      modes: state.transitTime.modes,
      packs: state.transitTime.packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        addressCount: pack.addresses.length,
        stopCount: pack.stops.length,
        routeCount: pack.routes.length,
        routeEdgeCount: pack.routeEdges.length,
        transferEdgeCount: pack.transferEdges.length,
        gridCellCount: pack.gridCells.size
      }))
    };
  }

  T.transitTime = {
    start,
    positionPanel,
    getEstimateForLatLng,
    getNearestStops,
    searchDestinations,
    renderTooltipEstimate,
    getDebugState
  };
})();
