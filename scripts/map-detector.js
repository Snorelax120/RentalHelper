(() => {
  const T = window.TransitOverlay;
  const { config, state, utils } = T;

  function start() {
    scheduleMapHunt();

    state.mutationObserver = new MutationObserver(() => {
      scheduleMapHunt();
    });

    state.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "role", "style", "class", "src"]
    });
  }

  function scheduleMapHunt() {
    if (state.mapHuntFrame) return;

    state.mapHuntFrame = window.requestAnimationFrame(() => {
      state.mapHuntFrame = 0;

      const candidate = findMarketplaceMap();
      if (!candidate) {
        T.overlay.scheduleAlign();
        return;
      }

      const signature = getCandidateSignature(candidate);
      if (signature !== state.lastCandidateSignature) {
        state.lastCandidateSignature = signature;
        utils.debugLog("Selected map surface", {
          element: candidate.element,
          rect: utils.formatRect(candidate.rect),
          score: candidate.score,
          reasons: candidate.reasons
        });
      }

      if (candidate.element !== state.mapElement) {
        state.mapElement = candidate.element;
        observeMapSize(candidate.element);
      }

      state.selectedCandidate = candidate;
      T.overlay.initializeLeaflet();
      T.overlay.scheduleAlign();
      T.sync.schedule();
    });
  }

  function findMarketplaceMap() {
    const candidates = collectMapCandidates();
    if (!candidates.length) {
      utils.debugLog("No viable map candidates found");
      return null;
    }

    const hasRightSideMap = candidates.some(
      (candidate) =>
        candidate.rect.left >= getSidebarGuardWidth() &&
        candidate.rect.width >= config.MIN_MAP_WIDTH &&
        candidate.hasSurface
    );

    const filtered = hasRightSideMap
      ? candidates.filter(
          (candidate) =>
            !(
              candidate.rect.left < 120 &&
              candidate.rect.width > window.innerWidth * 0.65 &&
              !candidate.isExactMapExplorer
            )
        )
      : candidates;

    const scored = filtered
      .map(scoreMapCandidate)
      .filter((candidate) => candidate.score > -100)
      .sort((a, b) => b.score - a.score);

    if (config.DEBUG && scored.length) {
      const topThree = scored.slice(0, 3).map((candidate) => ({
        rect: utils.formatRect(candidate.rect),
        score: candidate.score,
        reasons: candidate.reasons,
        element: utils.describeElement(candidate.element)
      }));
      const topSignature = JSON.stringify(topThree.map(({ rect, score, element }) => ({ rect, score, element })));
      if (topSignature !== state.lastTopCandidatesSignature) {
        state.lastTopCandidatesSignature = topSignature;
        utils.debugLog("Top map candidates", topThree);
      }
    }

    return scored[0] || null;
  }

  function collectMapCandidates() {
    const candidateMap = new Map();
    const selectors = [
      '[aria-label="Map Explorer"]',
      '[aria-label*="Map" i]',
      '[role="application"]',
      "canvas",
      'img[src*="map" i]',
      'img[src*="maps" i]',
      'img[src*="google" i]',
      'img[src*="gstatic" i]',
      '[aria-label*="Zoom" i]'
    ];

    for (const selector of selectors) {
      for (const seed of document.querySelectorAll(selector)) {
        addCandidate(candidateMap, seed, selector);

        let ancestor = seed.parentElement;
        let distance = 0;
        while (ancestor && ancestor !== document.body && distance < 8) {
          addCandidate(candidateMap, ancestor, `${selector} ancestor ${distance + 1}`);
          ancestor = ancestor.parentElement;
          distance += 1;
        }
      }
    }

    return Array.from(candidateMap.values());
  }

  function addCandidate(candidateMap, element, reason) {
    if (!element || element.id === config.OVERLAY_ID || element.id === config.TOGGLE_ID) return;
    if (element === document.documentElement || element === document.body) return;

    const rect = getVisibleRect(element);
    if (!rect) return;

    const existing = candidateMap.get(element);
    if (existing) {
      existing.reasons.push(reason);
      return;
    }

    const hasCanvas = element.matches("canvas") || Boolean(element.querySelector("canvas"));
    const hasMapImage =
      element.matches('img[src*="map" i], img[src*="maps" i], img[src*="google" i], img[src*="gstatic" i]') ||
      Boolean(
        element.querySelector(
          'img[src*="map" i], img[src*="maps" i], img[src*="google" i], img[src*="gstatic" i]'
        )
      );
    const hasZoomControl = Boolean(element.querySelector('[aria-label*="Zoom" i]'));
    const isExactMapExplorer = element.getAttribute("aria-label") === "Map Explorer";
    const isMapLabelled = Boolean(element.getAttribute("aria-label")?.match(/map/i));

    if (!hasCanvas && !hasMapImage && !hasZoomControl && !isExactMapExplorer && !isMapLabelled) return;

    candidateMap.set(element, {
      element,
      rect,
      reasons: [reason],
      hasCanvas,
      hasMapImage,
      hasZoomControl,
      hasSurface: hasCanvas || hasMapImage,
      isExactMapExplorer,
      isMapLabelled,
      depth: getElementDepth(element),
      listingLinkCount: countListingLinks(element),
      controlLikeCount: countControlLikeElements(element),
      surfaceCoverage: getLargestSurfaceCoverage(element, rect)
    });
  }

  function scoreMapCandidate(candidate) {
    let score = 0;
    const reasons = [...new Set(candidate.reasons)];
    const viewportArea = window.innerWidth * window.innerHeight;
    const area = candidate.rect.width * candidate.rect.height;

    if (candidate.isExactMapExplorer) score += 45;
    if (candidate.isMapLabelled) score += 20;
    if (candidate.element.getAttribute("role") === "application") score += 10;
    if (candidate.element.matches("canvas")) score += 70;
    if (candidate.hasCanvas) score += 45;
    if (candidate.hasMapImage) score += 28;
    if (candidate.hasZoomControl) score += 14;
    if (candidate.rect.left >= getSidebarGuardWidth()) score += 28;
    if (candidate.rect.left >= window.innerWidth * 0.25) score += 12;
    if (candidate.surfaceCoverage > 0.55) score += 24;
    if (candidate.surfaceCoverage > 0.85) score += 18;

    score += Math.min(22, candidate.depth);
    score += Math.min(30, (area / viewportArea) * 40);

    if (candidate.rect.left < 120 && candidate.rect.width > window.innerWidth * 0.65) score -= 85;
    if (candidate.rect.width > window.innerWidth * 0.9 && candidate.rect.left < 50) score -= 60;
    if (candidate.rect.height > window.innerHeight * 0.96 && candidate.rect.top < 20) score -= 18;
    if (candidate.listingLinkCount > 0) {
      score -= Math.min(120, candidate.listingLinkCount * 22);
      reasons.push(`listing links: ${candidate.listingLinkCount}`);
    }
    if (candidate.controlLikeCount > 8 && !candidate.hasCanvas && !candidate.hasMapImage) score -= 40;

    return {
      ...candidate,
      score: Math.round(score),
      reasons
    };
  }

  function getVisibleRect(element) {
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    const width = right - left;
    const height = bottom - top;

    if (
      width < config.MIN_MAP_WIDTH ||
      height < config.MIN_MAP_HEIGHT ||
      right <= 0 ||
      bottom <= 0 ||
      left >= window.innerWidth ||
      top >= window.innerHeight
    ) {
      return null;
    }

    return {
      top,
      left,
      right,
      bottom,
      width,
      height,
      rawTop: rect.top,
      rawLeft: rect.left,
      rawRight: rect.right,
      rawBottom: rect.bottom
    };
  }

  function getSidebarGuardWidth() {
    return Math.min(420, Math.max(240, window.innerWidth * 0.28));
  }

  function getElementDepth(element) {
    let depth = 0;
    let current = element;
    while (current?.parentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function countListingLinks(element) {
    return element.querySelectorAll('a[href*="/marketplace/item"]').length;
  }

  function countControlLikeElements(element) {
    return element.querySelectorAll("button, input, a, [role='button']").length;
  }

  function getLargestSurfaceCoverage(element, candidateRect) {
    const surfaces = [
      ...(element.matches("canvas") ? [element] : []),
      ...element.querySelectorAll("canvas"),
      ...(element.matches("img") ? [element] : []),
      ...element.querySelectorAll(
        'img[src*="map" i], img[src*="maps" i], img[src*="google" i], img[src*="gstatic" i]'
      )
    ];

    const largestArea = surfaces.reduce((maxArea, surface) => {
      const rect = surface.getBoundingClientRect();
      return Math.max(maxArea, Math.max(0, rect.width) * Math.max(0, rect.height));
    }, 0);

    const candidateArea = candidateRect.width * candidateRect.height;
    return candidateArea ? largestArea / candidateArea : 0;
  }

  function getCandidateSignature(candidate) {
    return [
      utils.describeElement(candidate.element),
      Math.round(candidate.rect.left),
      Math.round(candidate.rect.top),
      Math.round(candidate.rect.width),
      Math.round(candidate.rect.height),
      candidate.score
    ].join("|");
  }

  function observeMapSize(element) {
    state.resizeObserver?.disconnect();
    state.resizeObserver = new ResizeObserver(T.overlay.scheduleAlign);
    state.resizeObserver.observe(element);
  }

  T.map = {
    start,
    scheduleMapHunt,
    findMarketplaceMap,
    getVisibleRect
  };
})();
