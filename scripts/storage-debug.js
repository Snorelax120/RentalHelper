(() => {
  const T = window.TransitOverlay;
  const { config, state } = T;

  function getStoredSettings() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve({
          overlayEnabled: true,
          calibration: { ...config.DEFAULT_CALIBRATION }
        });
        return;
      }

      chrome.storage.local.get(
        {
          [config.STORAGE_KEY]: true,
          [config.CALIBRATION_STORAGE_KEY]: config.DEFAULT_CALIBRATION
        },
        (result) => {
          resolve({
            overlayEnabled: Boolean(result[config.STORAGE_KEY]),
            calibration: normalizeCalibration(result[config.CALIBRATION_STORAGE_KEY])
          });
        }
      );
    });
  }

  function normalizeCalibration(value) {
    if (value?.version !== config.CALIBRATION_VERSION) {
      return { ...config.DEFAULT_CALIBRATION };
    }

    return {
      version: config.CALIBRATION_VERSION,
      latOffset: parseCalibrationNumber(value?.latOffset, config.DEFAULT_CALIBRATION.latOffset),
      lngOffset: parseCalibrationNumber(value?.lngOffset, config.DEFAULT_CALIBRATION.lngOffset),
      zoomOffset: parseCalibrationNumber(value?.zoomOffset, config.DEFAULT_CALIBRATION.zoomOffset)
    };
  }

  function parseCalibrationNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function persistCalibration() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set({ [config.CALIBRATION_STORAGE_KEY]: state.calibration });
  }

  function resetCalibration() {
    state.calibration = { ...config.DEFAULT_CALIBRATION };
    persistCalibration();
    forceResync();
  }

  function adjustCalibration(delta) {
    state.calibration = {
      version: config.CALIBRATION_VERSION,
      latOffset: state.calibration.latOffset + (delta.latOffset || 0),
      lngOffset: state.calibration.lngOffset + (delta.lngOffset || 0),
      zoomOffset: state.calibration.zoomOffset + (delta.zoomOffset || 0)
    };
    persistCalibration();
    forceResync();
  }

  function forceResync() {
    state.lastView = null;
    T.sync.schedule();
    updateDebugPanel();
  }

  function moveDotsByPixels(deltaX, deltaY) {
    if (!state.leafletMap) return;

    const zoom = state.leafletMap.getZoom();
    const center = state.leafletMap.getCenter();
    const centerPoint = state.leafletMap.project(center, zoom);
    const adjustedPoint = centerPoint.subtract([deltaX, deltaY]);
    const adjustedCenter = state.leafletMap.unproject(adjustedPoint, zoom);

    adjustCalibration({
      latOffset: adjustedCenter.lat - center.lat,
      lngOffset: adjustedCenter.lng - center.lng
    });
  }

  function createDebugPanel() {
    if (!config.DEBUG || state.debugPanel) return;

    const panel = document.createElement("div");
    panel.id = config.DEBUG_PANEL_ID;
    panel.innerHTML = `
      <div class="transit-debug-title">Transit debug</div>
      <div class="transit-debug-readout" data-role="readout">Waiting for map state</div>
      <div class="transit-debug-grid">
        <button type="button" data-action="move-up">Dots up</button>
        <button type="button" data-action="zoom-in">Zoom +</button>
        <button type="button" data-action="move-left">Dots left</button>
        <button type="button" data-action="move-right">Dots right</button>
        <button type="button" data-action="move-down">Dots down</button>
        <button type="button" data-action="zoom-out">Zoom -</button>
      </div>
      <button type="button" class="transit-debug-reset" data-action="reset">Reset calibration</button>
    `;

    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      if (action === "move-up") moveDotsByPixels(0, -48);
      if (action === "move-down") moveDotsByPixels(0, 48);
      if (action === "move-left") moveDotsByPixels(-48, 0);
      if (action === "move-right") moveDotsByPixels(48, 0);
      if (action === "zoom-in") adjustCalibration({ zoomOffset: 0.25 });
      if (action === "zoom-out") adjustCalibration({ zoomOffset: -0.25 });
      if (action === "reset") resetCalibration();
    });

    document.body.appendChild(panel);
    state.debugPanel = panel;
  }

  function updateDebugPanel() {
    if (!state.debugPanel) return;

    const readout = state.debugPanel.querySelector('[data-role="readout"]');
    if (!readout) return;

    const view = state.lastView;
    const parsedView = state.lastParsedView;
    const calibration = state.calibration;
    const hostZoom = state.lastHostTileZoom?.zoom;
    readout.textContent = view
      ? `applied z ${view.zoom.toFixed(2)} raw z ${parsedView?.zoom.toFixed(2) ?? "?"} host z ${hostZoom ?? "?"} | ${view.lat.toFixed(5)}, ${view.lng.toFixed(5)} | ${state.lastViewSource} | cal z ${calibration.zoomOffset.toFixed(2)} lat ${calibration.latOffset.toFixed(5)} lng ${calibration.lngOffset.toFixed(5)}`
      : `No parsed map state | cal z ${calibration.zoomOffset.toFixed(2)} lat ${calibration.latOffset.toFixed(5)} lng ${calibration.lngOffset.toFixed(5)}`;
  }

  function positionDebugPanel(rect) {
    if (!state.debugPanel) return;

    Object.assign(state.debugPanel.style, {
      top: `${Math.max(8, rect.top + 54)}px`,
      left: `${Math.max(8, rect.right - 202)}px`
    });
  }

  T.debug = {
    getStoredSettings,
    createDebugPanel,
    updateDebugPanel,
    positionDebugPanel
  };
})();
