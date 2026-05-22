(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;
  const REQUEST_EVENT = "transit-overlay-debug-request";
  const RESPONSE_EVENT = "transit-overlay-debug-response";
  const PAGE_BRIDGE_PATH = "scripts/page-debug-bridge.js";

  const methods = {
    ping: () => ({
      ok: true,
      debug: config.DEBUG,
      hasDiagnostics: Boolean(T.diagnostics),
      hasWalkingTime: Boolean(T.walkingTime),
      hasMapElement: Boolean(state.mapElement),
      href: window.location.href,
      selectedMap: state.mapElement ? utils.describeElement(state.mapElement) : null,
      lastParsedView: state.lastParsedView,
      lastView: state.lastView,
      lastHostTileZoom: state.lastHostTileZoom,
      panSmoothing: state.panSmoothing,
      zoomSync: state.zoomSync,
      walkingCityPacks: T.walkingTime.getCityPacks(),
      commute: T.transitTime.getDebugState(),
      visibleLines: state.visibleLines,
      currentHostTileZoom: T.sync.getHostTileZoom(),
      calibration: state.calibration
    }),
    startDiagnostics: () => T.diagnostics.start(),
    stopDiagnostics: () => T.diagnostics.stop(),
    getDiagnosticsSummary: () => T.diagnostics.getSummary(),
    snapshotMapState: () => T.diagnostics.snapshotMapState(),
    getListingMarkerCandidates: (options) => T.walkingTime.getListingMarkerCandidates(options),
    getNearestStations: (latLng, count) => T.walkingTime.getNearestStations(latLng, count),
    getWalkingCityPacks: () => T.walkingTime.getCityPacks(),
    searchCommuteDestinations: (query) => T.transitTime.searchDestinations(query),
    getNearestTransitStops: (latLng, modes, limit) => T.transitTime.getNearestStops(latLng, modes, limit),
    getCommuteDebugState: () => T.transitTime.getDebugState()
  };

  function installRequestListener() {
    window.addEventListener(REQUEST_EVENT, (event) => {
      const detail = event.detail || {};
      const id = detail.id;
      const method = detail.method;
      const args = Array.isArray(detail.args) ? detail.args : [];

      if (!id) return;

      try {
        if (!Object.hasOwn(methods, method)) {
          throw new Error(`Unknown transit overlay debug method: ${method}`);
        }

        const result = methods[method](...args);
        dispatchResponse({ id, ok: true, result: makeCloneable(result) });
      } catch (error) {
        dispatchResponse({
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  function dispatchResponse(detail) {
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: makeCloneable(detail)
      })
    );
  }

  function makeCloneable(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return {
        serializationError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function injectPageBridge() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(PAGE_BRIDGE_PATH);
    script.async = false;
    script.dataset.transitOverlayDebugBridge = "true";
    script.addEventListener("load", () => script.remove());
    script.addEventListener("error", () => {
      utils.debugLog("Failed to inject page debug bridge", script.src);
      script.remove();
    });

    (document.head || document.documentElement).appendChild(script);
  }

  installRequestListener();
  injectPageBridge();
})();
