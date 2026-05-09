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

    await loadStations();
  }

  async function loadStations() {
    if (state.stationsLayer) return;

    const url = chrome.runtime.getURL("data/vancouver-stations.geojson");
    const response = await fetch(url);
    const geojson = await response.json();

    state.stationsLayer = L.geoJSON(geojson, {
      pointToLayer(feature, latlng) {
        const lines = normalizeLines(feature.properties?.line);
        const color = getStationColor(lines);
        return L.circleMarker(latlng, {
          radius: 6,
          weight: 2,
          color,
          fillColor: "#ffffff",
          fillOpacity: 0.92,
          opacity: 0.95,
          interactive: false,
          className: "transit-station-marker"
        });
      }
    }).addTo(state.leafletMap);
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

  function scheduleAlign() {
    if (state.alignFrame) return;

    state.alignFrame = window.requestAnimationFrame(() => {
      state.alignFrame = 0;
      alignOverlay();
    });
  }

  function alignOverlay() {
    if (!state.mapElement || !state.overlay || !state.toggle) return;

    const rect = T.map.getVisibleRect(state.mapElement);

    if (!rect) {
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
    state.overlay.hidden = !(state.overlayEnabled && state.hasValidMapState);
  }

  T.overlay = {
    createOverlay,
    createToggle,
    initializeLeaflet,
    scheduleAlign,
    updateOverlayVisibility
  };
})();
