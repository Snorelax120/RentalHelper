(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;
  const W = T.walkingTimeUtils;
  const cityPacks = T.walkingTimeCityPacks;

  function getListingMarkerCandidates(options = {}) {
    const now = performance.now();
    const useCache =
      !options.force &&
      state.walkingTime.candidateCache &&
      now - state.walkingTime.candidateCacheAt < config.WALKING_MARKER_SCAN_MS;

    if (useCache) return state.walkingTime.candidateCache;

    const projectionStatus = getProjectionStatus();
    const rawCandidates = collectListingMarkerCandidates();
    const candidates = rawCandidates.slice(0, config.WALKING_MARKER_MAX_RESULTS).map((candidate) =>
      toDiagnosticCandidate(candidate, projectionStatus)
    );

    const result = {
      count: candidates.length,
      canProject: projectionStatus.ok,
      disabledReason: projectionStatus.ok ? "" : projectionStatus.reason,
      candidates
    };

    state.walkingTime.candidateCache = result;
    state.walkingTime.candidateCacheAt = now;
    return result;
  }

  function clearCache(reason = "manual") {
    state.walkingTime.candidateCache = null;
    state.walkingTime.candidateCacheAt = 0;
    state.walkingTime.lastClearReason = reason;
  }

  function findHoveredCandidate(clientX, clientY) {
    const diagnostics = getListingMarkerCandidates();
    if (!diagnostics.canProject) return null;

    return diagnostics.candidates
      .map((candidate) => {
        const rectDistance = W.getRectDistance(candidate.rect, clientX, clientY);
        const anchorDistance = Math.hypot(clientX - candidate.anchor.x, clientY - candidate.anchor.y);
        const hit = rectDistance <= config.WALKING_HOVER_RADIUS_PX || anchorDistance <= config.WALKING_HOVER_RADIUS_PX;

        return hit
          ? {
              ...candidate,
              hoverDistance: Math.min(rectDistance, anchorDistance)
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.hoverDistance - b.hoverDistance || b.score - a.score)[0] || null;
  }

  function toDiagnosticCandidate(candidate, projectionStatus) {
    const anchor = getAnchor(candidate);
    const projected = projectionStatus.ok ? projectAnchor(anchor) : null;
    const nearestStations = projected ? cityPacks.getNearestStations(projected, config.WALKING_RESULT_COUNT) : [];

    return {
      element: utils.describeElement(candidate.element),
      text: candidate.text,
      rect: utils.formatRect(candidate.rect),
      visibleRatio: W.round(candidate.visibleRatio, 3),
      anchor: {
        type: anchor.type,
        x: Math.round(anchor.x),
        y: Math.round(anchor.y),
        containerX: projected?.containerX ?? null,
        containerY: projected?.containerY ?? null
      },
      latLng: projected
        ? {
            lat: projected.lat,
            lng: projected.lng
          }
        : null,
      nearestStations,
      score: candidate.score,
      reasons: candidate.reasons
    };
  }

  function collectListingMarkerCandidates() {
    if (!state.mapElement?.isConnected) return [];

    const mapRect = state.mapElement.getBoundingClientRect();
    if (!W.hasArea(mapRect)) return [];

    const elements = Array.from(
      state.mapElement.querySelectorAll("button, [role='button'], a, [aria-label], span, div")
    ).slice(0, W.MAX_SCANNED_ELEMENTS);

    const candidates = elements
      .map((element) => evaluateCandidateElement(element, mapRect))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || W.getArea(a.rect) - W.getArea(b.rect));

    return dedupeCandidates(candidates);
  }

  function evaluateCandidateElement(element, mapRect) {
    if (!(element instanceof Element)) return null;
    if (W.isExtensionElement(element) || W.isMapControlElement(element)) return null;

    const text = W.getCandidateText(element);
    if (!W.PRICE_PATTERN.test(text)) return null;

    const rect = element.getBoundingClientRect();
    if (!W.isMarkerLikeRect(rect, text)) return null;

    const visibleArea = W.getIntersectionArea(mapRect, rect);
    if (visibleArea <= 0) return null;

    const styles = window.getComputedStyle(element);
    if (styles.display === "none" || styles.visibility === "hidden" || Number(styles.opacity) === 0) return null;

    const visibleRatio = visibleArea / W.getArea(rect);
    if (visibleRatio < 0.45) return null;

    const reasons = ["price-like text", "marker-sized", "inside map"];
    const score = scoreCandidate(element, rect, text, styles, reasons);

    return {
      element,
      rect,
      text,
      visibleRatio,
      score,
      reasons
    };
  }

  function scoreCandidate(element, rect, text, styles, reasons) {
    let score = 40;
    const width = rect.width;
    const height = rect.height;

    if (width >= 30 && width <= 120 && height >= 18 && height <= 48) {
      score += 20;
      reasons.push("price bubble proportions");
    }

    if (element.matches("button, a, [role='button']")) {
      score += 12;
      reasons.push("interactive marker shell");
    }

    if (text.length <= 24) {
      score += 8;
      reasons.push("compact label");
    }

    if (W.hasVisiblePaint(styles)) {
      score += 6;
      reasons.push("visible marker styling");
    }

    if (Math.abs(width - height) <= 8 && width <= 48) {
      score += 4;
      reasons.push("circular marker proportions");
    }

    const childPriceCount = Array.from(element.children || []).filter((child) =>
      W.PRICE_PATTERN.test(W.getCandidateText(child))
    ).length;
    if (childPriceCount > 1) {
      score -= 25;
      reasons.push("multiple price children");
    }

    return score;
  }

  function dedupeCandidates(candidates) {
    const deduped = [];

    for (const candidate of candidates) {
      const duplicate = deduped.some((existing) => {
        if (candidate.text !== existing.text) return false;
        return W.getRectOverlapRatio(candidate.rect, existing.rect) > 0.72;
      });

      if (!duplicate) deduped.push(candidate);
    }

    return deduped;
  }

  function getAnchor(candidate) {
    const { rect } = candidate;
    const isCircular = Math.abs(rect.width - rect.height) <= 8 && rect.width <= 48;
    const type = isCircular ? "center" : "bottom-center";

    if (type === "center") {
      return {
        type,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }

    return {
      type,
      x: rect.left + rect.width / 2,
      y: rect.bottom
    };
  }

  function projectAnchor(anchor) {
    const overlayRect = state.leafletNode.getBoundingClientRect();
    const containerX = anchor.x - overlayRect.left;
    const containerY = anchor.y - overlayRect.top;
    const latLng = state.leafletMap.containerPointToLatLng([containerX, containerY]);

    return {
      lat: W.roundCoordinate(latLng.lat),
      lng: W.roundCoordinate(latLng.lng),
      containerX: Math.round(containerX),
      containerY: Math.round(containerY)
    };
  }

  function getProjectionStatus() {
    if (!state.overlayEnabled) return { ok: false, reason: "overlay disabled" };
    if (!state.hasValidMapState) return { ok: false, reason: "invalid map state" };
    if (state.zoomSync?.pending) return { ok: false, reason: "zoom settling" };
    if (state.panSmoothing?.active) return { ok: false, reason: "pan smoothing active" };
    if (!state.mapElement?.isConnected) return { ok: false, reason: "map element unavailable" };
    if (!state.overlay || state.overlay.hidden || state.overlay.style.visibility === "hidden") {
      return { ok: false, reason: "overlay hidden" };
    }
    if (!state.leafletNode || !state.leafletMap) return { ok: false, reason: "leaflet map unavailable" };

    return { ok: true, reason: "" };
  }

  function isInsideMap(x, y) {
    if (!state.mapElement) return false;
    const rect = state.mapElement.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  T.walkingTimeCandidates = {
    getListingMarkerCandidates,
    clearCache,
    findHoveredCandidate,
    isInsideMap
  };
})();
