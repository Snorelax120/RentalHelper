(() => {
  const T = window.TransitOverlay;
  const { state } = T;
  const cityPacks = T.walkingTimeCityPacks;
  const candidates = T.walkingTimeCandidates;
  const tooltip = T.walkingTimeTooltip;

  const walking = {
    started: false,
    frame: 0,
    lastPointer: null
  };

  function start() {
    if (walking.started) return;

    walking.started = true;
    tooltip.create();
    cityPacks.loadCityPacks();
    document.addEventListener("pointermove", handlePointerMove, { passive: true, capture: true });
    document.addEventListener("pointerdown", () => clear("pointer down"), { passive: true, capture: true });
    window.addEventListener("blur", () => clear("window blur"), { passive: true });
    window.addEventListener("scroll", () => clear("window scroll"), { passive: true });
  }

  function clear(reason = "manual") {
    candidates.clearCache(reason);

    if (walking.frame) {
      window.cancelAnimationFrame(walking.frame);
      walking.frame = 0;
    }

    walking.lastPointer = null;
    tooltip.clear();
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
    if (!canShowTooltip() || !candidates.isInsideMap(x, y)) {
      clear("outside map or disabled");
      return;
    }

    const candidate = candidates.findHoveredCandidate(x, y);
    if (!candidate || !candidate.nearestStations?.length) {
      clear("no listing marker");
      return;
    }

    T.stationHover?.clear();
    tooltip.show(candidate, x, y);
  }

  function canShowTooltip() {
    return Boolean(
      state.overlayEnabled &&
        state.hasValidMapState &&
        !state.zoomSync?.pending &&
        !state.panSmoothing?.active &&
        state.leafletMap &&
        state.mapElement &&
        tooltip.hasTooltip()
    );
  }

  T.walkingTime = {
    start,
    clear,
    getCityPacks: cityPacks.getCityPacks,
    getNearestStations: cityPacks.getNearestStations,
    getListingMarkerCandidates: candidates.getListingMarkerCandidates
  };
})();
