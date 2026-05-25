(() => {
  const T = window.TransitOverlay;
  const { config, state } = T;

  const hover = {
    started: false,
    tooltip: null,
    activeStationName: ""
  };

  function start() {
    if (hover.started) return;

    hover.started = true;
    createTooltip();
    document.addEventListener("pointermove", handlePointerMove, { passive: true, capture: true });
    document.addEventListener("pointerdown", clear, { passive: true, capture: true });
    window.addEventListener("blur", clear, { passive: true });
    window.addEventListener("scroll", clear, { passive: true });
  }

  function createTooltip() {
    if (hover.tooltip) return;

    const tooltip = document.createElement("div");
    tooltip.id = "transit-station-hover";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    hover.tooltip = tooltip;
  }

  function handlePointerMove(event) {
    if (!canShowHover() || !isInsideMap(event.clientX, event.clientY)) {
      clear();
      return;
    }

    const match = findNearestStation(event.clientX, event.clientY);
    if (!match) {
      clear();
      return;
    }

    showTooltip(match.feature, event.clientX, event.clientY);
  }

  function canShowHover() {
    return Boolean(
        state.overlayEnabled &&
        state.hasValidMapState &&
        !state.zoomSync?.pending &&
        state.leafletMap &&
        state.stationsGeojson?.features?.length &&
        hover.tooltip
    );
  }

  function findNearestStation(clientX, clientY) {
    const overlayRect = state.leafletNode.getBoundingClientRect();
    const pan = state.panSmoothing?.active ? state.panSmoothing : { dx: 0, dy: 0 };
    let nearest = null;

    for (const feature of state.stationsGeojson.features) {
      if (!isStationVisible(feature)) continue;

      const coordinates = feature.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;

      const point = state.leafletMap.latLngToContainerPoint([coordinates[1], coordinates[0]]);
      const x = overlayRect.left + point.x + pan.dx;
      const y = overlayRect.top + point.y + pan.dy;
      const distance = Math.hypot(clientX - x, clientY - y);

      if (distance > config.STATION_HOVER_RADIUS_PX) continue;
      if (!nearest || distance < nearest.distance) {
        nearest = { feature, distance };
      }
    }

    return nearest;
  }

  function showTooltip(feature, clientX, clientY) {
    const stationName = feature.properties?.station_name || "Station";
    const lines = normalizeLines(feature.properties?.line);

    if (hover.activeStationName !== stationName) {
      hover.tooltip.innerHTML = `
        <div class="transit-station-hover-name">${escapeHtml(stationName)}</div>
        <div class="transit-station-hover-lines">
          ${lines.map((line) => `<span data-line="${escapeHtml(line)}">${escapeHtml(line)}</span>`).join("")}
        </div>
      `;
      hover.activeStationName = stationName;
    }

    const offset = config.STATION_TOOLTIP_OFFSET_PX;
    hover.tooltip.hidden = false;
    const tooltipRect = hover.tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tooltipRect.width - 8, clientX + offset);
    const top = Math.min(window.innerHeight - tooltipRect.height - 8, clientY + offset);

    hover.tooltip.style.left = `${Math.max(8, left)}px`;
    hover.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function clear() {
    if (!hover.tooltip) return;

    hover.tooltip.hidden = true;
    hover.activeStationName = "";
  }

  function isInsideMap(x, y) {
    if (!state.mapElement) return false;
    const rect = state.mapElement.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function isStationVisible(feature) {
    return normalizeLines(feature.properties?.line).some((line) => state.visibleLines?.[line] !== false);
  }

  function normalizeLines(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return [];
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

  T.stationHover = {
    start,
    clear
  };
})();
