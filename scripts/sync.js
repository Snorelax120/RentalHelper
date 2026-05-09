(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;

  function startUrlPolling() {
    state.lastHref = window.location.href;
    schedule();

    setInterval(() => {
      if (window.location.href !== state.lastHref) {
        state.lastHref = window.location.href;
        window.dispatchEvent(new Event("transit-overlay-locationchange"));
        return;
      }

      schedule();
    }, config.URL_POLL_INTERVAL_MS);
  }

  function installHistoryHooks() {
    const dispatch = () => {
      window.dispatchEvent(new Event("transit-overlay-locationchange"));
    };

    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        dispatch();
        return result;
      };
    }
  }

  function schedule() {
    if (state.syncFrame) return;

    state.syncFrame = window.requestAnimationFrame(() => {
      state.syncFrame = 0;
      syncFromUrl();
    });
  }

  function syncFromUrl() {
    if (!state.leafletMap) return;

    const view = parseMapViewFromUrl(window.location.href);

    if (!view) {
      if (state.hasValidMapState || state.lastViewSource !== "none") {
        utils.debugLog("No valid map center/zoom found in URL", {
          href: window.location.href
        });
      }
      state.lastViewSource = "none";
      state.lastParsedView = null;
      state.lastView = null;
      state.hasValidMapState = false;
      T.overlay.updateOverlayVisibility();
      T.debug.updateDebugPanel();
      return;
    }

    const resolvedView = applyHostTileZoom(view);
    const adjustedZoom = resolvedView.zoom + state.calibration.zoomOffset;
    const nextView = {
      lat: resolvedView.lat + state.calibration.latOffset,
      lng: resolvedView.lng + state.calibration.lngOffset,
      zoom: adjustedZoom
    };

    if (
      state.lastView &&
      state.lastView.lat === nextView.lat &&
      state.lastView.lng === nextView.lng &&
      state.lastView.zoom === nextView.zoom &&
      state.lastViewSource === resolvedView.source
    ) {
      return;
    }

    state.lastView = nextView;
    state.lastParsedView = resolvedView;
    state.lastViewSource = resolvedView.source;
    state.hasValidMapState = true;
    state.leafletMap.setView([nextView.lat, nextView.lng], nextView.zoom, {
      animate: false
    });
    utils.debugLog("Leaflet view synced", {
      source: resolvedView.source,
      parsedView: resolvedView,
      appliedView: nextView,
      hostTileZoom: state.lastHostTileZoom,
      calibration: state.calibration,
      leafletCenter: state.leafletMap.getCenter(),
      leafletZoom: state.leafletMap.getZoom()
    });
    T.overlay.updateOverlayVisibility();
    T.debug.updateDebugPanel();
  }

  function applyHostTileZoom(view) {
    const hostTileZoom = getHostTileZoom();
    state.lastHostTileZoom = hostTileZoom;

    if (!hostTileZoom) return view;

    return {
      ...view,
      zoom: hostTileZoom.zoom,
      source: `${view.source}, ${hostTileZoom.source}`,
      usedDefaultZoom: false,
      hostTileZoom
    };
  }

  function getHostTileZoom() {
    return getHostTileZoomFromDom() || getHostTileZoomFromRecentResources();
  }

  function getHostTileZoomFromDom() {
    if (!state.mapElement) return null;

    const mapRect = state.mapElement.getBoundingClientRect();
    const samples = Array.from(state.mapElement.querySelectorAll("img[src]"))
      .map((image) => {
        const zoom = parseFacebookMapTileZoom(image.currentSrc || image.src || image.getAttribute("src"));
        if (!utils.isValidZoom(zoom)) return null;

        const rect = image.getBoundingClientRect();
        const visibleArea = getIntersectionArea(mapRect, rect);
        return {
          zoom,
          weight: Math.max(1, visibleArea),
          src: image.currentSrc || image.src || image.getAttribute("src")
        };
      })
      .filter(Boolean);

    return chooseDominantZoom(samples, "host tile zoom from visible DOM");
  }

  function getHostTileZoomFromRecentResources() {
    const resources = performance.getEntriesByType?.("resource") || [];
    const samples = resources
      .slice(-120)
      .map((entry) => {
        const zoom = parseFacebookMapTileZoom(entry.name);
        return utils.isValidZoom(zoom)
          ? {
              zoom,
              weight: 1,
              src: entry.name
            }
          : null;
      })
      .filter(Boolean);

    return chooseDominantZoom(samples, "host tile zoom from resource timing");
  }

  function parseFacebookMapTileZoom(src) {
    if (!src || typeof src !== "string") return null;

    let url;
    try {
      url = new URL(src, window.location.href);
    } catch (_error) {
      return null;
    }

    const isFacebookMapTile =
      url.pathname.includes("map_tile.php") ||
      url.searchParams.get("_nc_client_caller") === "CometRasterMap" ||
      url.searchParams.get("_nc_client_id") === "marketplace_rentals_map_comet";

    if (!isFacebookMapTile) return null;

    const zoom = Number(url.searchParams.get("z"));
    return utils.isValidZoom(zoom) ? zoom : null;
  }

  function chooseDominantZoom(samples, source) {
    if (!samples.length) return null;

    const buckets = new Map();
    for (const sample of samples) {
      const bucket = buckets.get(sample.zoom) || {
        zoom: sample.zoom,
        weight: 0,
        count: 0,
        examples: []
      };
      bucket.weight += sample.weight;
      bucket.count += 1;
      if (bucket.examples.length < 3) bucket.examples.push(sample.src);
      buckets.set(sample.zoom, bucket);
    }

    const best = Array.from(buckets.values()).sort((a, b) => b.weight - a.weight || b.zoom - a.zoom)[0];
    return {
      zoom: best.zoom,
      source,
      count: best.count,
      weight: Math.round(best.weight),
      examples: best.examples
    };
  }

  function getIntersectionArea(a, b) {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function parseMapViewFromUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch (_error) {
      return null;
    }

    const entries = getUrlParamEntries(url);
    const candidates = [];
    const zoom = readNumberParam(entries, config.zoomNames);

    addDirectViewCandidate(candidates, entries, config.mapLatNames, config.mapLngNames, zoom, "map params", 10);
    addCenterPairCandidates(candidates, entries, zoom);
    addBoundsCandidate(candidates, entries, zoom);
    addNestedValueCandidates(candidates, entries, zoom);
    addPathCoordinateCandidates(candidates, url, zoom);
    addDirectViewCandidate(
      candidates,
      entries,
      config.genericLatNames,
      config.genericLngNames,
      zoom,
      "generic lat/lng params",
      90
    );

    return chooseBestViewCandidate(candidates);
  }

  function getUrlParamEntries(url) {
    const entries = Array.from(url.searchParams.entries());
    const hash = url.hash.replace(/^#/, "");

    if (!hash) return entries;

    const hashParts = new Set([hash]);
    const queryIndex = hash.indexOf("?");
    if (queryIndex >= 0) hashParts.add(hash.slice(queryIndex + 1));

    for (const part of hashParts) {
      const queryText = part.startsWith("?") ? part.slice(1) : part;
      try {
        for (const [name, value] of new URLSearchParams(queryText).entries()) {
          entries.push([name, value]);
        }
      } catch (_error) {
        // Ignore malformed hash fragments; Facebook often keeps internal state here.
      }
    }

    return entries;
  }

  function addDirectViewCandidate(candidates, entries, latNames, lngNames, zoom, source, priority) {
    const latResult = readNumberParam(entries, latNames);
    const lngResult = readNumberParam(entries, lngNames);
    if (!latResult || !lngResult) return;

    candidates.push({
      lat: latResult.value,
      lng: lngResult.value,
      zoom: zoom?.value ?? config.DEFAULT_ZOOM,
      source: `${source}: ${latResult.name}/${lngResult.name}${zoom?.source ? `, ${zoom.source}` : ""}`,
      priority,
      usedDefaultZoom: !zoom
    });
  }

  function addCenterPairCandidates(candidates, entries, zoom) {
    for (const name of config.centerPairNames) {
      const result = readStringParam(entries, [name]);
      if (!result) continue;

      const pair = parseCoordinatePair(result.value);
      if (!pair) continue;

      candidates.push({
        ...pair,
        zoom: zoom?.value ?? config.DEFAULT_ZOOM,
        source: `center pair: ${result.name}${zoom?.source ? `, ${zoom.source}` : ""}`,
        priority: 20,
        usedDefaultZoom: !zoom
      });
    }
  }

  function addBoundsCandidate(candidates, entries, zoom) {
    const north = readNumberParam(entries, config.boundsNames.north);
    const south = readNumberParam(entries, config.boundsNames.south);
    const east = readNumberParam(entries, config.boundsNames.east);
    const west = readNumberParam(entries, config.boundsNames.west);

    if (!north || !south || !east || !west) return;

    candidates.push({
      lat: (north.value + south.value) / 2,
      lng: (east.value + west.value) / 2,
      zoom: zoom?.value ?? config.DEFAULT_ZOOM,
      source: `bounds center params${zoom?.source ? `, ${zoom.source}` : ""}`,
      priority: 30,
      usedDefaultZoom: !zoom
    });
  }

  function addPathCoordinateCandidates(candidates, url, zoom) {
    for (const decoded of utils.getDecodedVariants(`${url.pathname}${url.hash}`)) {
      const atMatch = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/i);
      if (atMatch) {
        candidates.push({
          lat: Number(atMatch[1]),
          lng: Number(atMatch[2]),
          zoom: Number(atMatch[3]),
          source: "path @lat,lng,zoom",
          priority: 15,
          usedDefaultZoom: false
        });
      }

      const centerMatch = decoded.match(
        /(?:center|mapCenter|ll)[=/](-?\d+(?:\.\d+)?)[,\s|~]+(-?\d+(?:\.\d+)?)/i
      );
      if (!centerMatch) continue;

      const pair = parseCoordinatePair(`${centerMatch[1]},${centerMatch[2]}`);
      if (!pair) continue;

      candidates.push({
        ...pair,
        zoom: zoom?.value ?? config.DEFAULT_ZOOM,
        source: `path center pair${zoom?.source ? `, ${zoom.source}` : ""}`,
        priority: 35,
        usedDefaultZoom: !zoom
      });
    }
  }

  function addNestedValueCandidates(candidates, entries, fallbackZoom) {
    for (const [name, value] of entries) {
      const lowerName = name.toLowerCase();
      if (!lowerName.includes("map") && !lowerName.includes("center") && !lowerName.includes("location")) continue;

      for (const decoded of utils.getDecodedVariants(value)) {
        const pair = parseCoordinatePair(decoded);
        if (pair) {
          candidates.push({
            ...pair,
            zoom: fallbackZoom?.value ?? config.DEFAULT_ZOOM,
            source: `encoded center pair: ${name}${fallbackZoom?.source ? `, ${fallbackZoom.source}` : ""}`,
            priority: 40,
            usedDefaultZoom: !fallbackZoom
          });
        }

        const parsed = parseJsonLike(decoded);
        if (!parsed) continue;

        const objectView = parseViewFromObject(parsed, fallbackZoom?.value);
        if (objectView) {
          candidates.push({
            ...objectView,
            source: `encoded object: ${name}`,
            priority: 45,
            usedDefaultZoom: objectView.usedDefaultZoom
          });
        }
      }
    }
  }

  function chooseBestViewCandidate(candidates) {
    const validCandidates = candidates
      .filter((candidate) => utils.isValidLatitude(candidate.lat) && utils.isValidLongitude(candidate.lng))
      .map((candidate) => ({
        ...candidate,
        zoom: utils.isValidZoom(candidate.zoom) ? candidate.zoom : config.DEFAULT_ZOOM
      }))
      .sort((a, b) => a.priority - b.priority);

    return validCandidates[0] || null;
  }

  function parseViewFromObject(value, fallbackZoom) {
    const queue = [value];
    const visited = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || visited.has(current)) continue;
      visited.add(current);

      const objectEntries = Object.entries(current);
      const lat = readNumberParam(objectEntries, [...config.mapLatNames, ...config.genericLatNames]);
      const lng = readNumberParam(objectEntries, [...config.mapLngNames, ...config.genericLngNames]);
      const zoom = readNumberParam(objectEntries, config.zoomNames);

      if (lat && lng) {
        return {
          lat: lat.value,
          lng: lng.value,
          zoom: zoom?.value ?? fallbackZoom ?? config.DEFAULT_ZOOM,
          usedDefaultZoom: !zoom && !fallbackZoom
        };
      }

      for (const [, nested] of objectEntries) {
        if (nested && typeof nested === "object") queue.push(nested);
      }
    }

    return null;
  }

  function readStringParam(entries, names) {
    const namesSet = new Set(names.map((name) => name.toLowerCase()));
    for (const [name, value] of entries) {
      if (namesSet.has(name.toLowerCase())) return { name, value };
    }

    return null;
  }

  function readNumberParam(entries, names) {
    const result = readStringParam(entries, names);
    if (!result) return null;

    const value = parseFiniteNumber(result.value);
    if (!Number.isFinite(value)) return null;

    return {
      name: result.name,
      value
    };
  }

  function parseFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;

    const direct = Number(value.trim());
    if (Number.isFinite(direct)) return direct;

    const match = value.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function parseCoordinatePair(value) {
    if (typeof value !== "string") return null;

    const match = value.match(/(-?\d+(?:\.\d+)?)[,\s|~]+(-?\d+(?:\.\d+)?)/);
    if (!match) return null;

    const first = Number(match[1]);
    const second = Number(match[2]);

    if (utils.isValidLatitude(first) && utils.isValidLongitude(second)) return { lat: first, lng: second };
    if (utils.isValidLongitude(first) && utils.isValidLatitude(second)) return { lat: second, lng: first };

    return null;
  }

  function parseJsonLike(value) {
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      return null;
    }
  }

  T.sync = {
    installHistoryHooks,
    startUrlPolling,
    schedule,
    parseMapViewFromUrl,
    getHostTileZoom
  };
})();
