(() => {
  const T = window.TransitOverlay;
  const { config, state } = T;

  if (config.DEBUG) {
    window.__transitOverlayDebug = {
      state,
      findMarketplaceMap: T.map.findMarketplaceMap,
      parseMapViewFromUrl: T.sync.parseMapViewFromUrl,
      snapshotMapState: T.diagnostics.snapshotMapState,
      startDiagnostics: T.diagnostics.start,
      stopDiagnostics: T.diagnostics.stop,
      getDiagnosticsSummary: T.diagnostics.getSummary
    };
  }

  init();

  async function init() {
    const storedSettings = await T.debug.getStoredSettings();
    state.overlayEnabled = storedSettings.overlayEnabled;
    state.calibration = storedSettings.calibration;

    T.sync.installHistoryHooks();
    T.overlay.createOverlay();
    T.overlay.createToggle();
    T.debug.createDebugPanel();
    T.map.start();
    T.sync.startUrlPolling();

    window.addEventListener("resize", T.overlay.scheduleAlign, { passive: true });
    window.addEventListener("scroll", T.overlay.scheduleAlign, { passive: true });
    window.addEventListener("popstate", T.sync.schedule);
    window.addEventListener("transit-overlay-locationchange", () => {
      T.map.scheduleMapHunt();
      T.sync.schedule();
    });
    setInterval(T.overlay.scheduleAlign, config.ALIGN_INTERVAL_MS);
  }
})();
