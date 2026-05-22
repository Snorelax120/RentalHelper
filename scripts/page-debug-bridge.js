(() => {
  const API_NAME = "__transitOverlayDebug";
  const REQUEST_EVENT = "transit-overlay-debug-request";
  const RESPONSE_EVENT = "transit-overlay-debug-response";
  const VERSION = 1;

  if (window[API_NAME]?.__pageBridgeVersion >= VERSION) return;

  let nextId = 0;
  const pending = new Map();

  window.addEventListener(RESPONSE_EVENT, (event) => {
    const detail = event.detail || {};
    const entry = pending.get(detail.id);
    if (!entry) return;

    pending.delete(detail.id);

    if (detail.ok) {
      entry.resolve(detail.result);
    } else {
      entry.reject(new Error(detail.error || "Transit overlay debug request failed"));
    }
  });

  function request(method, args = []) {
    const id = `transit-debug-${Date.now()}-${nextId += 1}`;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("Transit overlay debug request timed out"));
      }, 5000);

      pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });

      window.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          detail: { id, method, args }
        })
      );
    });
  }

  window[API_NAME] = {
    __pageBridgeVersion: VERSION,
    ping: () => request("ping"),
    startDiagnostics: () => request("startDiagnostics"),
    stopDiagnostics: () => request("stopDiagnostics"),
    getDiagnosticsSummary: () => request("getDiagnosticsSummary"),
    snapshotMapState: () => request("snapshotMapState"),
    getListingMarkerCandidates: (options) => request("getListingMarkerCandidates", [options]),
    getNearestStations: (latLng, count) => request("getNearestStations", [latLng, count]),
    getWalkingCityPacks: () => request("getWalkingCityPacks"),
    searchCommuteDestinations: (query) => request("searchCommuteDestinations", [query]),
    getNearestTransitStops: (latLng, modes, limit) => request("getNearestTransitStops", [latLng, modes, limit]),
    getCommuteDebugState: () => request("getCommuteDebugState")
  };
})();
