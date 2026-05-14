(() => {
  const T = window.TransitOverlay;
  const { config, state } = T;

  const smoothing = {
    started: false,
    tracking: false,
    active: false,
    pointerId: null,
    startPointer: null,
    lastPointer: null,
    hostPane: null,
    startHostTransform: null,
    frame: 0,
    clearTimer: 0,
    lastSignature: ""
  };

  function start() {
    if (smoothing.started) return;

    smoothing.started = true;
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerCancel, true);
    document.addEventListener("wheel", handleWheel, { passive: true, capture: true });
    document.addEventListener("click", handleClick, true);
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (isExtensionControl(event.target)) return;
    if (isZoomControl(event.target) && isZoomIntentAllowed(event.clientX, event.clientY)) {
      T.sync.beginZoomSettle("zoom control");
      return;
    }
    if (!state.overlayEnabled || !state.hasValidMapState || !state.mapElement || !state.leafletNode) return;
    if (!isInsideMap(event.clientX, event.clientY)) return;

    window.clearTimeout(smoothing.clearTimer);
    smoothing.clearTimer = 0;
    clearVisualState("new pointer", { keepTracking: false, updateDebug: false });

    smoothing.tracking = true;
    smoothing.pointerId = event.pointerId;
    smoothing.startPointer = {
      x: event.clientX,
      y: event.clientY
    };
    smoothing.lastPointer = { ...smoothing.startPointer };
    smoothing.hostPane = findHostMapPane();
    smoothing.startHostTransform = readElementTranslate(smoothing.hostPane);
    updatePublicState(false, "none", 0, 0, "tracking");
  }

  function handleWheel(event) {
    if (!isZoomIntentAllowed(event.clientX, event.clientY)) return;
    T.sync.beginZoomSettle("wheel zoom");
  }

  function handleClick(event) {
    if (!isZoomIntentAllowed(event.clientX, event.clientY)) return;
    if (!isZoomControl(event.target)) return;
    T.sync.beginZoomSettle("zoom control");
  }

  function handlePointerMove(event) {
    if (!smoothing.tracking || event.pointerId !== smoothing.pointerId) return;

    smoothing.lastPointer = {
      x: event.clientX,
      y: event.clientY
    };

    const pointerDelta = getPointerDelta();
    if (!smoothing.active && getDistance(pointerDelta) < config.PAN_SMOOTHING_THRESHOLD_PX) return;

    if (!smoothing.active) {
      smoothing.active = true;
      updatePublicState(true, "pending", 0, 0, "drag started");
    }

    scheduleFrame();
  }

  function handlePointerUp(event) {
    if (!smoothing.tracking || event.pointerId !== smoothing.pointerId) return;

    smoothing.tracking = false;
    smoothing.pointerId = null;

    if (!smoothing.active) {
      clear("click");
      return;
    }

    scheduleFrame();
    smoothing.clearTimer = window.setTimeout(() => {
      clear("settle timeout");
    }, config.PAN_SMOOTHING_SETTLE_MS);
  }

  function handlePointerCancel(event) {
    if (!smoothing.tracking || event.pointerId !== smoothing.pointerId) return;
    clear("pointer cancel");
  }

  function scheduleFrame() {
    if (smoothing.frame || !smoothing.active) return;

    smoothing.frame = window.requestAnimationFrame(() => {
      smoothing.frame = 0;
      updateVisualOffset();

      if (smoothing.active && (smoothing.tracking || smoothing.clearTimer)) {
        scheduleFrame();
      }
    });
  }

  function updateVisualOffset() {
    if (!state.leafletNode || !smoothing.active || state.zoomSync?.pending) return;

    const hostDelta = getHostTransformDelta();
    const pointerDelta = getPointerDelta();
    const useHostDelta = hostDelta && getDistance(hostDelta) >= 0.5;
    const next = useHostDelta ? hostDelta : pointerDelta;
    const source = useHostDelta ? "host-transform" : "pointer-delta";

    applyVisualOffset(next.dx, next.dy, source);
  }

  function applyVisualOffset(dx, dy, source) {
    const roundedDx = Math.round(dx * 100) / 100;
    const roundedDy = Math.round(dy * 100) / 100;
    const signature = `${source}|${roundedDx}|${roundedDy}`;

    if (signature === smoothing.lastSignature) return;

    smoothing.lastSignature = signature;
    state.leafletNode.style.transform = `translate3d(${roundedDx}px, ${roundedDy}px, 0)`;
    state.leafletNode.style.transformOrigin = "0 0";
    state.leafletNode.style.willChange = "transform";
    updatePublicState(true, source, roundedDx, roundedDy, "active");
    T.debug.updateDebugPanel();
  }

  function handleAuthoritativeSync(previousView, nextView) {
    if (!smoothing.active && !smoothing.tracking) return;

    const keepTracking =
      smoothing.tracking &&
      smoothing.lastPointer &&
      previousView &&
      nextView &&
      previousView.zoom === nextView.zoom &&
      isInsideMap(smoothing.lastPointer.x, smoothing.lastPointer.y);

    clearVisualState("authoritative sync", {
      keepTracking,
      updateDebug: true
    });

    if (!keepTracking) return;

    smoothing.tracking = true;
    smoothing.active = false;
    smoothing.startPointer = { ...smoothing.lastPointer };
    smoothing.hostPane = findHostMapPane();
    smoothing.startHostTransform = readElementTranslate(smoothing.hostPane);
    updatePublicState(false, "none", 0, 0, "rebased after sync");
  }

  function clear(reason = "manual") {
    clearVisualState(reason, {
      keepTracking: false,
      updateDebug: true
    });
  }

  function clearVisualState(reason, options = {}) {
    const { keepTracking = false, updateDebug = true } = options;

    if (smoothing.frame) {
      window.cancelAnimationFrame(smoothing.frame);
      smoothing.frame = 0;
    }

    window.clearTimeout(smoothing.clearTimer);
    smoothing.clearTimer = 0;
    smoothing.active = false;
    smoothing.lastSignature = "";

    if (!keepTracking) {
      smoothing.tracking = false;
      smoothing.pointerId = null;
      smoothing.startPointer = null;
      smoothing.lastPointer = null;
      smoothing.hostPane = null;
      smoothing.startHostTransform = null;
    }

    if (state.leafletNode) {
      state.leafletNode.style.transform = "";
      state.leafletNode.style.willChange = "";
    }

    updatePublicState(false, "none", 0, 0, reason);
    if (updateDebug) T.debug.updateDebugPanel();
  }

  function getHostTransformDelta() {
    const current = readElementTranslate(getHostPane());
    if (!current || !smoothing.startHostTransform) return null;

    return {
      dx: current.x - smoothing.startHostTransform.x,
      dy: current.y - smoothing.startHostTransform.y
    };
  }

  function getPointerDelta() {
    if (!smoothing.startPointer || !smoothing.lastPointer) return { dx: 0, dy: 0 };

    return {
      dx: smoothing.lastPointer.x - smoothing.startPointer.x,
      dy: smoothing.lastPointer.y - smoothing.startPointer.y
    };
  }

  function getDistance(delta) {
    return Math.hypot(delta.dx || 0, delta.dy || 0);
  }

  function getHostPane() {
    if (smoothing.hostPane?.isConnected) return smoothing.hostPane;
    smoothing.hostPane = findHostMapPane();
    return smoothing.hostPane;
  }

  function findHostMapPane() {
    return state.mapElement?.querySelector(".leaflet-map-pane") || null;
  }

  function readElementTranslate(element) {
    if (!element) return null;

    const transform = window.getComputedStyle(element).transform;
    if (!transform || transform === "none") return { x: 0, y: 0 };

    if (typeof DOMMatrixReadOnly === "function") {
      try {
        const matrix = new DOMMatrixReadOnly(transform);
        return { x: matrix.m41, y: matrix.m42 };
      } catch (_error) {
        // Fall through to string parsing.
      }
    }

    const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
    if (matrix3d) {
      const values = matrix3d[1].split(",").map((value) => Number(value.trim()));
      return values.length === 16 ? { x: values[12], y: values[13] } : null;
    }

    const matrix = transform.match(/^matrix\((.+)\)$/);
    if (matrix) {
      const values = matrix[1].split(",").map((value) => Number(value.trim()));
      return values.length === 6 ? { x: values[4], y: values[5] } : null;
    }

    return null;
  }

  function isInsideMap(x, y) {
    if (!state.mapElement) return false;
    const rect = state.mapElement.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function isExtensionControl(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(`#${config.TOGGLE_ID}, #${config.DEBUG_PANEL_ID}`));
  }

  function isZoomControl(target) {
    return target instanceof Element && Boolean(target.closest('[aria-label*="Zoom" i]'));
  }

  function isZoomIntentAllowed(x, y) {
    return Boolean(
      state.overlayEnabled &&
        state.hasValidMapState &&
        state.mapElement &&
        state.leafletNode &&
        isInsideMap(x, y)
    );
  }

  function updatePublicState(active, source, dx, dy, reason) {
    state.panSmoothing = {
      active,
      source,
      dx,
      dy,
      reason
    };
  }

  T.panSmoothing = {
    start,
    handleAuthoritativeSync,
    clear
  };
})();
