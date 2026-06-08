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
    COMMUTE_DESTINATION_STORAGE_KEY: "vancouverTransitCommuteDestination",
    COMMUTE_MODES_STORAGE_KEY: "vancouverTransitCommuteModes",
    COMMUTE_PANEL_OPEN_STORAGE_KEY: "vancouverTransitCommutePanelOpen",
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
    WALKING_SPEED_KMPH: 4.8,
    WALKING_SPEED_METERS_PER_MINUTE: 80,
    WALKING_CIRCUITY_FACTOR: 1.25,
    WALKING_MIN_MINUTES: 1,
    WALKING_RESULT_COUNT: 2,
    WALKING_MARKER_SCAN_MS: 500,
    WALKING_HOVER_RADIUS_PX: 14,
    WALKING_TOOLTIP_OFFSET_PX: 14,
    WALKING_MARKER_MAX_RESULTS: 80,
    WALKING_SNAP_MAX_METERS: 90,
    WALKING_EDGE_INDEX_CELL_DEGREES: 0.005,
    WALKING_CITY_PACKS: [
      {
        id: "vancouver",
        name: "Metro Vancouver",
        resource: "data/vancouver-walking-pack.json"
      },
      {
        id: "toronto",
        name: "Toronto",
        resource: "data/toronto-walking-pack.json"
      }
    ],
    TRANSIT_CITY_PACKS: [
      {
        id: "vancouver",
        name: "Metro Vancouver",
        resource: "data/city-packs/vancouver/manifest.json"
      },
      {
        id: "toronto",
        name: "Toronto",
        resource: "data/city-packs/toronto/manifest.json"
      }
    ],
    OVERLAY_CITY_DATASETS: [
      {
        id: "vancouver",
        stations: "data/vancouver-stations.geojson",
        lines: "data/vancouver-lines.geojson"
      },
      {
        id: "toronto",
        stations: "data/toronto-stations.geojson",
        lines: "data/toronto-lines.geojson"
      }
    ],
    COMMUTE_RESULT_STOP_LIMIT: 8,
    COMMUTE_ADDRESS_RESULT_LIMIT: 6,
    COMMUTE_BUS_AVERAGE_SPEED_KMPH: 18,
    COMMUTE_METRO_AVERAGE_SPEED_KMPH: 35,
    COMMUTE_TRANSIT_CIRCUITY_FACTOR: 1.35,
    COMMUTE_BUS_TIME_MULTIPLIER: 1.7,
    COMMUTE_METRO_TIME_MULTIPLIER: 1,
    COMMUTE_TRANSFER_PENALTY_MINUTES: 3,
    COMMUTE_ROUTE_CHANGE_PENALTY_MINUTES: 3,
    COMMUTE_MAX_ROUTE_SEGMENTS: 3,
    COMMUTE_MAX_BUS_ROUTE_SEGMENTS: 2,
    COMMUTE_MODE_LABELS: {
      metro: "Train",
      bus: "Bus"
    },
    TRANSIT_MAX_RESULT_MINUTES: 120,
    MIN_MAP_WIDTH: 320,
    MIN_MAP_HEIGHT: 280,
    lineColors: {
      Expo: "#005596",
      Millennium: "#FFCD00",
      Canada: "#00A7E1",
      "Line 1": "#D5C82B",
      "Line 2": "#008000",
      "Line 4": "#B300B3",
      "Line 5": "#FF8000",
      "Line 6": "#808080"
    },
    lineNames: ["Expo", "Millennium", "Canada", "Line 1", "Line 2", "Line 4", "Line 5", "Line 6"],
    DEFAULT_VISIBLE_LINES: {
      Expo: true,
      Millennium: true,
      Canada: true,
      "Line 1": true,
      "Line 2": true,
      "Line 4": true,
      "Line 5": true,
      "Line 6": true
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
    walkingTime: {
      stationIndex: null,
      stationIndexSource: null,
      cityPacks: [],
      cityPacksLoading: false,
      cityPacksLoaded: false,
      cityPackLoadError: "",
      candidateCache: null,
      candidateCacheAt: 0,
      lastClearReason: ""
    },
    transitTime: {
      panelOpen: false,
      destination: null,
      modes: {
        metro: true,
        bus: false
      },
      packs: [],
      packsLoading: false,
      packsLoaded: false,
      packLoadError: "",
      panelButton: null,
      panel: null,
      input: null,
      suggestions: null,
      status: null,
      lastQuery: "",
      lastSuggestions: []
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
