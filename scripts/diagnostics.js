(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;

  const diagnostics = {
    running: false,
    observer: null,
    transformTimer: 0,
    pointer: {
      active: false,
      start: null,
      last: null,
      samples: []
    },
    resources: new Map(),
    transforms: new Map(),
    boundsHits: [],
    snapshots: []
  };

  function start() {
    if (!config.DEBUG || diagnostics.running) return getSummary();

    diagnostics.running = true;
    startResourceObserver();
    startTransformSampling();
    startPointerProbe();
    scanBoundsSignals();
    utils.debugLog("Diagnostics started", getSummary());
    return getSummary();
  }

  function stop() {
    if (!diagnostics.running) return getSummary();

    diagnostics.running = false;
    diagnostics.observer?.disconnect();
    diagnostics.observer = null;
    window.clearInterval(diagnostics.transformTimer);
    diagnostics.transformTimer = 0;
    stopPointerProbe();
    utils.debugLog("Diagnostics stopped", getSummary());
    return getSummary();
  }

  function getSummary() {
    return {
      running: diagnostics.running,
      resources: summarizeResources(),
      transforms: summarizeTransforms(),
      pointer: {
        samples: diagnostics.pointer.samples.slice(-12),
        last: diagnostics.pointer.last
      },
      boundsHits: diagnostics.boundsHits.slice(-20),
      snapshots: diagnostics.snapshots.slice(-5)
    };
  }

  function snapshotMapState() {
    const mapElement = state.mapElement;
    const snapshot = {
      at: new Date().toISOString(),
      href: window.location.href,
      selectedMap: mapElement
        ? {
            element: utils.describeElement(mapElement),
            rect: utils.formatRect(mapElement.getBoundingClientRect()),
            descendants: collectMapDescendants(mapElement),
            controls: collectVisibleControls(mapElement),
            boundsSignals: findBoundsSignals(mapElement)
          }
        : null,
      lastParsedView: state.lastParsedView,
      lastView: state.lastView,
      lastViewSource: state.lastViewSource,
      lastHostTileZoom: state.lastHostTileZoom,
      panSmoothing: state.panSmoothing,
      zoomSync: state.zoomSync,
      visibleLines: state.visibleLines,
      currentHostTileZoom: T.sync.getHostTileZoom(),
      calibration: state.calibration
    };

    diagnostics.snapshots.push(snapshot);
    if (diagnostics.snapshots.length > 20) diagnostics.snapshots.shift();
    utils.debugLog("Map state snapshot", snapshot);
    return snapshot;
  }

  function startResourceObserver() {
    if (!("PerformanceObserver" in window)) {
      utils.debugLog("PerformanceObserver unavailable");
      return;
    }

    diagnostics.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordResource(entry.name);
      }
    });

    try {
      diagnostics.observer.observe({ type: "resource", buffered: true });
    } catch (_error) {
      diagnostics.observer.observe({ entryTypes: ["resource"] });
    }

    for (const entry of performance.getEntriesByType("resource")) {
      recordResource(entry.name);
    }
  }

  function recordResource(urlText) {
    const candidate = parseMapResource(urlText);
    if (!candidate) return;

    const key = [candidate.host, candidate.pattern, candidate.zoom ?? "none"].join("|");
    const current = diagnostics.resources.get(key) || {
      ...candidate,
      count: 0,
      examples: []
    };

    current.count += 1;
    if (current.examples.length < 3) current.examples.push(urlText);
    diagnostics.resources.set(key, current);
  }

  function parseMapResource(urlText) {
    let url;
    try {
      url = new URL(urlText);
    } catch (_error) {
      return null;
    }

    const text = decodeUrl(urlText);
    const looksMapLike =
      /map|maps|tile|tiles|vector|vt|mvt|style|satellite|street|geo|gstatic|mapbox|here|osm/i.test(text) ||
      /\/\d{1,2}\/\d+\/\d+/.test(text);

    if (!looksMapLike) return null;

    const zoom = extractZoomFromText(text);
    const tile = extractTileFromText(text);
    const bounds = extractBoundsFromText(text);

    return {
      host: url.host,
      pattern: classifyResourcePattern(text),
      zoom,
      tile,
      bounds
    };
  }

  function classifyResourcePattern(text) {
    if (/\/\d{1,2}\/\d+\/\d+/.test(text)) return "z/x/y path";
    if (/[?&](z|zoom)=/.test(text)) return "zoom query";
    if (/bbox|bounds|viewport|north|south|east|west|ne|sw/i.test(text)) return "bounds-like";
    if (/vector|mvt|vt/i.test(text)) return "vector";
    if (/map|tile|tiles/i.test(text)) return "map/tile";
    return "other map-like";
  }

  function extractZoomFromText(text) {
    const patterns = [
      /[?&](?:z|zoom|mapZoom)=(\d+(?:\.\d+)?)/i,
      /[!/](?:1i|z)(\d{1,2})(?:[!/]|$)/i,
      /(?:^|[/=])(\d{1,2})[/]\d+[/]\d+(?:[@.][a-z0-9]+)?(?:[?&)]|$)/i,
      /(?:^|[/=])(\d{1,2})[/]\d+[/]\d+[/](?:\d+)(?:[?&.)]|$)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const zoom = Number(match[1]);
      if (utils.isValidZoom(zoom)) return zoom;
    }

    return null;
  }

  function extractTileFromText(text) {
    const match = text.match(/(?:^|[/=])(\d{1,2})[/](\d+)[/](\d+)(?:[@.][a-z0-9]+)?(?:[?&)]|$)/i);
    if (!match) return null;

    return {
      z: Number(match[1]),
      x: Number(match[2]),
      y: Number(match[3])
    };
  }

  function extractBoundsFromText(text) {
    const bbox = text.match(/(?:bbox|bounds|viewport)=(-?\d+(?:\.\d+)?)[,%2C|]+(-?\d+(?:\.\d+)?)[,%2C|]+(-?\d+(?:\.\d+)?)[,%2C|]+(-?\d+(?:\.\d+)?)/i);
    if (!bbox) return null;

    return bbox.slice(1, 5).map(Number);
  }

  function startTransformSampling() {
    window.clearInterval(diagnostics.transformTimer);
    diagnostics.transformTimer = window.setInterval(sampleTransforms, 150);
    sampleTransforms();
  }

  function sampleTransforms() {
    if (!diagnostics.running || !state.mapElement) return;

    const samples = collectTransformSamples(state.mapElement);
    const signature = JSON.stringify(samples.map((sample) => sample.signature));
    const current = diagnostics.transforms.get(signature) || {
      count: 0,
      firstAt: Date.now(),
      lastAt: Date.now(),
      samples
    };

    current.count += 1;
    current.lastAt = Date.now();
    current.samples = samples;
    diagnostics.transforms.set(signature, current);

    if (diagnostics.transforms.size > 50) {
      const firstKey = diagnostics.transforms.keys().next().value;
      diagnostics.transforms.delete(firstKey);
    }
  }

  function collectTransformSamples(root) {
    const elements = Array.from(root.querySelectorAll("*")).slice(0, 300);
    const samples = [];

    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const transform = style.transform;
      const hasTransform = transform && transform !== "none";
      const hasLargeOffset = Math.abs(rect.left) > window.innerWidth || Math.abs(rect.top) > window.innerHeight;

      if (!hasTransform && !hasLargeOffset) continue;

      samples.push({
        element: utils.describeElement(element),
        rect: utils.formatRect(rect),
        transform,
        transition: style.transition,
        signature: `${utils.describeElement(element)}|${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}|${Math.round(rect.height)}|${transform}`
      });

      if (samples.length >= 20) break;
    }

    return samples;
  }

  function startPointerProbe() {
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerUp, true);
  }

  function stopPointerProbe() {
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("pointermove", handlePointerMove, true);
    document.removeEventListener("pointerup", handlePointerUp, true);
    document.removeEventListener("pointercancel", handlePointerUp, true);
    diagnostics.pointer.active = false;
  }

  function handlePointerDown(event) {
    if (!diagnostics.running || !isInsideMap(event.clientX, event.clientY)) return;

    diagnostics.pointer.active = true;
    diagnostics.pointer.start = {
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
      transforms: collectTransformSamples(state.mapElement)
    };
    diagnostics.pointer.last = diagnostics.pointer.start;
  }

  function handlePointerMove(event) {
    if (!diagnostics.pointer.active) return;

    const sample = {
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - diagnostics.pointer.start.x,
      dy: event.clientY - diagnostics.pointer.start.y,
      at: Date.now(),
      transforms: collectTransformSamples(state.mapElement)
    };

    diagnostics.pointer.last = sample;
    diagnostics.pointer.samples.push(sample);
    if (diagnostics.pointer.samples.length > 50) diagnostics.pointer.samples.shift();
  }

  function handlePointerUp(event) {
    if (!diagnostics.pointer.active) return;

    diagnostics.pointer.active = false;
    diagnostics.pointer.last = {
      ...diagnostics.pointer.last,
      endX: event.clientX,
      endY: event.clientY,
      endedAt: Date.now()
    };
  }

  function isInsideMap(x, y) {
    if (!state.mapElement) return false;
    const rect = state.mapElement.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function scanBoundsSignals() {
    diagnostics.boundsHits = findBoundsSignals(state.mapElement).slice(0, 50);
  }

  function findBoundsSignals(root) {
    const hits = [];
    const urlText = window.location.href;
    pushBoundsHit(hits, "url", urlText);

    if (root) {
      const elements = [root, ...Array.from(root.querySelectorAll("*")).slice(0, 400)];
      for (const element of elements) {
        for (const attr of element.getAttributeNames?.() || []) {
          const value = element.getAttribute(attr);
          if (!value) continue;
          pushBoundsHit(hits, `${utils.describeElement(element)}@${attr}`, value);
          if (hits.length >= 50) return hits;
        }
      }
    }

    for (const script of Array.from(document.scripts).slice(-20)) {
      const text = script.textContent || "";
      if (!text) continue;
      pushBoundsHit(hits, "script", text.slice(0, 4000));
      if (hits.length >= 50) break;
    }

    return hits;
  }

  function pushBoundsHit(hits, source, text) {
    if (!/bbox|bounds|viewport|north|south|east|west|northEast|southWest|neLat|swLat/i.test(text)) return;

    hits.push({
      source,
      excerpt: text.slice(0, 500),
      numbers: extractNearbyNumbers(text)
    });
  }

  function extractNearbyNumbers(text) {
    return Array.from(text.matchAll(/-?\d+(?:\.\d+)?/g))
      .slice(0, 12)
      .map((match) => Number(match[0]));
  }

  function collectMapDescendants(root) {
    return Array.from(root.querySelectorAll("canvas, img, source, [style], [aria-label], button"))
      .slice(0, 80)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          element: utils.describeElement(element),
          rect: utils.formatRect(rect),
          transform: style.transform,
          src: element.getAttribute("src") || element.getAttribute("srcset") || "",
          ariaLabel: element.getAttribute("aria-label") || "",
          text: (element.textContent || "").trim().slice(0, 80)
        };
      });
  }

  function collectVisibleControls(root) {
    return Array.from(root.querySelectorAll("button, [role='button'], [aria-label]"))
      .slice(0, 60)
      .map((element) => ({
        element: utils.describeElement(element),
        rect: utils.formatRect(element.getBoundingClientRect()),
        ariaLabel: element.getAttribute("aria-label") || "",
        text: (element.textContent || "").trim().slice(0, 80)
      }));
  }

  function summarizeResources() {
    return Array.from(diagnostics.resources.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
      .map(({ host, pattern, zoom, tile, bounds, count, examples }) => ({
        host,
        pattern,
        zoom,
        tile,
        bounds,
        count,
        examples
      }));
  }

  function summarizeTransforms() {
    return Array.from(diagnostics.transforms.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map(({ count, firstAt, lastAt, samples }) => ({
        count,
        durationMs: lastAt - firstAt,
        samples
      }));
  }

  function decodeUrl(value) {
    let current = value;
    for (let index = 0; index < 2; index += 1) {
      try {
        const decoded = decodeURIComponent(current);
        if (decoded === current) break;
        current = decoded;
      } catch (_error) {
        break;
      }
    }
    return current;
  }

  T.diagnostics = {
    start,
    stop,
    getSummary,
    snapshotMapState
  };

  if (config.DEBUG) {
    window.__transitOverlayDebug = {
      ...(window.__transitOverlayDebug || {}),
      state,
      snapshotMapState,
      startDiagnostics: start,
      stopDiagnostics: stop,
      getDiagnosticsSummary: getSummary
    };
  }
})();
