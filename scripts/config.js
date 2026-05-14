(() => {
  const config = {
    DEBUG: false,
    LOG_PREFIX: "[Transit Overlay]",
    OVERLAY_ID: "transit-overlay-container",
    TOGGLE_ID: "transit-overlay-toggle",
    DEBUG_PANEL_ID: "transit-debug-panel",
    STORAGE_KEY: "vancouverTransitOverlayEnabled",
    CALIBRATION_STORAGE_KEY: "vancouverTransitOverlayCalibration",
    LINE_VISIBILITY_STORAGE_KEY: "vancouverTransitVisibleLines",
    DEFAULT_CENTER: [49.2827, -123.1207],
    DEFAULT_ZOOM: 13,
    CALIBRATION_VERSION: 5,
    DEFAULT_CALIBRATION: {
      version: 5,
      latOffset: 0,
      lngOffset: 0,
      zoomOffset: 0
    },
    ALIGN_INTERVAL_MS: 500,
    URL_POLL_INTERVAL_MS: 250,
    PAN_SMOOTHING_THRESHOLD_PX: 3,
    PAN_SMOOTHING_SETTLE_MS: 1000,
    ZOOM_SYNC_SETTLE_MS: 180,
    ZOOM_SYNC_STABLE_MS: 180,
    ZOOM_SYNC_MAX_MS: 1400,
    ZOOM_INTENT_CLEAR_MS: 700,
    STATION_HOVER_RADIUS_PX: 12,
    STATION_TOOLTIP_OFFSET_PX: 12,
    MIN_MAP_WIDTH: 320,
    MIN_MAP_HEIGHT: 280,
    lineColors: {
      Expo: "#005596",
      Millennium: "#FFCD00",
      Canada: "#00A7E1"
    },
    lineNames: ["Expo", "Millennium", "Canada"],
    DEFAULT_VISIBLE_LINES: {
      Expo: true,
      Millennium: true,
      Canada: true
    },
    mapLatNames: ["mapLatitude", "mapLat", "map_latitude", "map_lat", "centerLatitude", "centerLat"],
    mapLngNames: [
      "mapLongitude",
      "mapLng",
      "mapLon",
      "map_longitude",
      "map_lng",
      "centerLongitude",
      "centerLng",
      "centerLon"
    ],
    genericLatNames: ["latitude", "lat"],
    genericLngNames: ["longitude", "lng", "lon"],
    zoomNames: ["mapZoom", "map_zoom", "zoomLevel", "zoom", "z"],
    centerPairNames: ["mapCenter", "map_center", "center", "ll", "latlng"],
    boundsNames: {
      north: ["north", "mapNorth", "northLat", "neLat", "northEastLatitude"],
      south: ["south", "mapSouth", "southLat", "swLat", "southWestLatitude"],
      east: ["east", "mapEast", "eastLng", "neLng", "northEastLongitude"],
      west: ["west", "mapWest", "westLng", "swLng", "southWestLongitude"]
    }
  };

  const state = {
    mapElement: null,
    selectedCandidate: null,
    overlay: null,
    leafletNode: null,
    toggle: null,
    debugPanel: null,
    leafletMap: null,
    stationsLayer: null,
    linesLayer: null,
    stationsGeojson: null,
    linesGeojson: null,
    resizeObserver: null,
    mutationObserver: null,
    overlayEnabled: true,
    visibleLines: { ...config.DEFAULT_VISIBLE_LINES },
    calibration: { ...config.DEFAULT_CALIBRATION },
    hasValidMapState: false,
    lastHref: "",
    lastParsedView: null,
    lastView: null,
    lastViewSource: "",
    lastHostTileZoom: null,
    panSmoothing: {
      active: false,
      source: "none",
      dx: 0,
      dy: 0,
      reason: ""
    },
    zoomSync: {
      pending: false,
      reason: "",
      overlayRect: null,
      toggleRect: null
    },
    lastCandidateSignature: "",
    lastTopCandidatesSignature: "",
    lastOverlaySignature: "",
    interactionTimeout: 0,
    mapHuntFrame: 0,
    alignFrame: 0,
    syncFrame: 0
  };

  function debugLog(message, data) {
    if (!config.DEBUG) return;
    console.info(config.LOG_PREFIX, message, data ?? "");
  }

  function formatRect(rect) {
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom)
    };
  }

  function describeElement(element) {
    if (!element) return "none";

    const tag = element.tagName?.toLowerCase() || "element";
    const id = element.id ? `#${element.id}` : "";
    const role = element.getAttribute("role") ? `[role="${element.getAttribute("role")}"]` : "";
    const label = element.getAttribute("aria-label") ? `[aria-label="${element.getAttribute("aria-label")}"]` : "";
    const classes = Array.from(element.classList || []).slice(0, 3).join(".");
    const classText = classes ? `.${classes}` : "";

    return `${tag}${id}${classText}${role}${label}`;
  }

  function isValidLatitude(value) {
    return Number.isFinite(value) && value >= -90 && value <= 90;
  }

  function isValidLongitude(value) {
    return Number.isFinite(value) && value >= -180 && value <= 180;
  }

  function isValidZoom(value) {
    return Number.isFinite(value) && value >= 1 && value <= 22;
  }

  function getDecodedVariants(value) {
    const variants = new Set([value]);
    let current = value;

    for (let index = 0; index < 3; index += 1) {
      try {
        const decoded = decodeURIComponent(current);
        if (decoded === current) break;
        variants.add(decoded);
        current = decoded;
      } catch (_error) {
        break;
      }
    }

    return Array.from(variants);
  }

  window.TransitOverlay = {
    config,
    state,
    utils: {
      debugLog,
      formatRect,
      describeElement,
      isValidLatitude,
      isValidLongitude,
      isValidZoom,
      getDecodedVariants
    }
  };
})();
