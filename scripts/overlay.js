(() => {
  const T = window.TransitOverlay;
  const { config, state } = T;

  function createOverlay() {
    if (state.overlay) return;

    const overlay = document.createElement("div");
    overlay.id = config.OVERLAY_ID;
    overlay.hidden = true;
    overlay.dataset.debug = String(config.DEBUG);

    const leafletNode = document.createElement("div");
    leafletNode.id = "transit-leaflet-map";
    leafletNode.setAttribute("aria-hidden", "true");
    overlay.appendChild(leafletNode);

    document.body.appendChild(overlay);
    state.overlay = overlay;
    state.leafletNode = leafletNode;
  }

  function createToggle() {
    if (state.toggle) return;

    const toggle = document.createElement("button");
    toggle.id = config.TOGGLE_ID;
    toggle.type = "button";
    toggle.textContent = "Transit";
    toggle.hidden = true;
    toggle.setAttribute("aria-pressed", String(state.overlayEnabled));
    toggle.dataset.enabled = String(state.overlayEnabled);
    toggle.addEventListener("click", () => {
      state.overlayEnabled = !state.overlayEnabled;
      toggle.setAttribute("aria-pressed", String(state.overlayEnabled));
      toggle.dataset.enabled = String(state.overlayEnabled);
      chrome.storage.local.set({ [config.STORAGE_KEY]: state.overlayEnabled });
      updateOverlayVisibility();
    });

    document.body.appendChild(toggle);
    state.toggle = toggle;
  }

  async function initializeLeaflet() {
    if (state.leafletMap || !window.L) return;

    state.leafletMap = L.map(state.leafletNode, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
      dragging: false,
      keyboard: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      inertia: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false
    }).setView(config.DEFAULT_CENTER, config.DEFAULT_ZOOM);

    ensurePanes();
    await loadTransitData();
    refreshTransitLayers();
  }

  function ensurePanes() {
    state.leafletMap.createPane("transit-lines");
    state.leafletMap.createPane("transit-stations");

    const linesPane = state.leafletMap.getPane("transit-lines");
    const stationsPane = state.leafletMap.getPane("transit-stations");
    linesPane.style.zIndex = "350";
    linesPane.style.pointerEvents = "none";
    stationsPane.style.zIndex = "450";
    stationsPane.style.pointerEvents = "none";
  }

  async function loadTransitData() {
    if (state.stationsGeojson && state.linesGeojson) return;

    const [stations, lines] = await Promise.all([
      fetch(chrome.runtime.getURL("data/vancouver-stations.geojson")).then((response) => response.json()),
      fetch(chrome.runtime.getURL("data/vancouver-lines.geojson")).then((response) => response.json())
    ]);

    state.stationsGeojson = stations;
    state.linesGeojson = lines;
  }

  function refreshTransitLayers() {
    if (!state.leafletMap || !state.stationsGeojson || !state.linesGeojson) return;

    if (state.linesLayer) {
      state.linesLayer.remove();
      state.linesLayer = null;
    }

    if (state.stationsLayer) {
      state.stationsLayer.remove();
      state.stationsLayer = null;
    }

    state.linesLayer = L.geoJSON(state.linesGeojson, {
      pane: "transit-lines",
      interactive: false,
      filter: isLineFeatureVisible,
      style(feature) {
        const line = feature.properties?.line;
        return {
          color: config.lineColors[line] || "#102033",
          weight: 4,
          opacity: line === "Millennium" ? 0.82 : 0.72,
          lineCap: "round",
          lineJoin: "round",
          className: "transit-route-line"
        };
      }
    }).addTo(state.leafletMap);

    state.stationsLayer = L.geoJSON(state.stationsGeojson, {
      filter: isStationFeatureVisible,
      pointToLayer(feature, latlng) {
        const lines = normalizeLines(feature.properties?.line);
        const color = getStationColor(lines);
        const shared = lines.length > 1;
        return L.circleMarker(latlng, {
          pane: "transit-stations",
          radius: shared ? 6.5 : 5.5,
          weight: shared ? 2.5 : 2,
          color: shared ? "#102033" : "#ffffff",
          fillColor: shared ? "#ffffff" : color,
          fillOpacity: 0.96,
          opacity: 1,
          interactive: false,
          className: `transit-station-marker${shared ? " transit-station-marker-shared" : ""}`
        });
      }
    }).addTo(state.leafletMap);

    T.stationHover?.clear();
  }

  function normalizeLines(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return [];
  }

  function getStationColor(lines) {
    if (lines.length === 1) return config.lineColors[lines[0]] || "#102033";
    return "#102033";
  }

  function isLineFeatureVisible(feature) {
    const line = feature.properties?.line;
    return state.visibleLines?.[line] !== false;
  }

  function isStationFeatureVisible(feature) {
    const lines = normalizeLines(feature.properties?.line);
    return lines.some((line) => state.visibleLines?.[line] !== false);
  }

  function setVisibleLines(nextVisibleLines) {
    state.visibleLines = T.debug.normalizeVisibleLines({
      ...state.visibleLines,
      ...nextVisibleLines
    });

    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [config.LINE_VISIBILITY_STORAGE_KEY]: state.visibleLines });
    }

    refreshTransitLayers();
  }

  function scheduleAlign() {
    if (state.alignFrame) return;

    state.alignFrame = window.requestAnimationFrame(() => {
      state.alignFrame = 0;
      alignOverlay();
    });
  }

  function alignOverlay() {
    if (!state.mapElement || !state.overlay || !state.toggle) return;
    if (state.zoomSync?.pending) return;

    const rect = T.map.getVisibleRect(state.mapElement);

    if (!rect) {
      T.panSmoothing?.clear("map rect unavailable");
      T.stationHover?.clear();
      state.overlay.hidden = true;
      state.toggle.hidden = true;
      if (state.debugPanel) state.debugPanel.hidden = true;
      return;
    }

    Object.assign(state.overlay.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });

    Object.assign(state.toggle.style, {
      top: `${Math.max(8, rect.top + 12)}px`,
      left: `${Math.max(8, rect.right - 88)}px`
    });
    T.debug.positionDebugPanel(rect);

    const overlaySignature = [
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height)
    ].join("|");

    if (overlaySignature !== state.lastOverlaySignature) {
      state.lastOverlaySignature = overlaySignature;
      T.utils.debugLog("Overlay aligned", {
        rect: T.utils.formatRect(rect),
        element: state.mapElement
      });
    }

    state.toggle.hidden = false;
    if (state.debugPanel) state.debugPanel.hidden = false;
    state.leafletMap?.invalidateSize(false);
    updateOverlayVisibility();
    T.debug.updateDebugPanel();
  }

  function updateOverlayVisibility() {
    if (!state.overlay) return;
    const hidden = !(state.overlayEnabled && state.hasValidMapState);
    if (hidden) {
      T.panSmoothing?.clear("overlay hidden");
      T.stationHover?.clear();
    }
    state.overlay.hidden = hidden;
  }

  T.overlay = {
    createOverlay,
    createToggle,
    initializeLeaflet,
    refreshTransitLayers,
    setVisibleLines,
    scheduleAlign,
    updateOverlayVisibility
  };
})();
