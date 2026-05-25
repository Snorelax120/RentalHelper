(() => {
  const T = window.TransitOverlay;
  const { config, utils } = T;

  const EARTH_RADIUS_METERS = 6371008.8;
  const PRICE_PATTERN = /(?:CA\$|C\$|\$)\s?\d[\d,.]*(?:\s?[KkMm])?/;
  const MAX_SCANNED_ELEMENTS = 1500;

  function normalizeLatLng(value) {
    if (!value) return null;

    const lat = Array.isArray(value) ? Number(value[0]) : Number(value.lat);
    const lng = Array.isArray(value) ? Number(value[1]) : Number(value.lng ?? value.lon);

    if (!utils.isValidLatitude(lat) || !utils.isValidLongitude(lng)) return null;
    return { lat, lng };
  }

  function normalizeResultCount(count) {
    const parsed = Math.round(Number(count));
    if (!Number.isFinite(parsed)) return config.WALKING_RESULT_COUNT;
    return Math.min(10, Math.max(1, parsed));
  }

  function normalizeLines(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") return [value];
    return [];
  }

  function haversineMeters(origin, destination) {
    const lat1 = toRadians(origin.lat);
    const lat2 = toRadians(destination.lat);
    const deltaLat = toRadians(destination.lat - origin.lat);
    const deltaLng = toRadians(destination.lng - origin.lng);

    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
  }

  function toLocalPoint(base, latLng) {
    const latRadians = toRadians(base.lat);
    return {
      x: toRadians(latLng.lng - base.lng) * Math.cos(latRadians) * EARTH_RADIUS_METERS,
      y: toRadians(latLng.lat - base.lat) * EARTH_RADIUS_METERS
    };
  }

  function isInsideBounds(latLng, bounds) {
    return Boolean(
      bounds &&
        latLng.lng >= bounds.west &&
        latLng.lng <= bounds.east &&
        latLng.lat >= bounds.south &&
        latLng.lat <= bounds.north
    );
  }

  function latLngKey(latLng) {
    return `${roundCoordinate(latLng.lat)},${roundCoordinate(latLng.lng)}`;
  }

  function isMarkerLikeRect(rect, text) {
    if (!hasArea(rect)) return false;

    const width = rect.width;
    const height = rect.height;
    const area = getArea(rect);

    return (
      text.length <= 60 &&
      width >= 16 &&
      width <= 180 &&
      height >= 14 &&
      height <= 80 &&
      area <= 10000
    );
  }

  function getCandidateText(element) {
    return [
      element.textContent || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || ""
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function isExtensionElement(element) {
    return Boolean(
      element.closest(
        `#${config.OVERLAY_ID}, #${config.TOGGLE_ID}, #${config.DEBUG_PANEL_ID}, #transit-station-hover, #transit-walking-time`
      )
    );
  }

  function isMapControlElement(element) {
    return Boolean(
      element.closest(
        [
          '[aria-label*="Zoom" i]',
          '[aria-label*="Map" i][role="button"]',
          '[aria-label*="Keyboard" i]',
          '[aria-label*="Directions" i]',
          '[aria-label*="Current location" i]',
          '[aria-label*="Locate" i]'
        ].join(",")
      )
    );
  }

  function hasVisiblePaint(styles) {
    return (
      styles.backgroundColor !== "rgba(0, 0, 0, 0)" ||
      styles.borderTopColor !== "rgba(0, 0, 0, 0)" ||
      styles.boxShadow !== "none"
    );
  }

  function hasArea(rect) {
    return rect.width > 0 && rect.height > 0;
  }

  function getArea(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function getIntersectionArea(a, b) {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function getRectOverlapRatio(a, b) {
    const overlap = getIntersectionArea(a, b);
    const smallerArea = Math.min(getArea(a), getArea(b));
    return smallerArea ? overlap / smallerArea : 0;
  }

  function getRectDistance(rect, x, y) {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.hypot(dx, dy);
  }

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function round(value, places) {
    const multiplier = 10 ** places;
    return Math.round(value * multiplier) / multiplier;
  }

  function roundCoordinate(value) {
    return round(value, 6);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      const replacements = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      };
      return replacements[character];
    });
  }

  T.walkingTimeUtils = {
    EARTH_RADIUS_METERS,
    PRICE_PATTERN,
    MAX_SCANNED_ELEMENTS,
    normalizeLatLng,
    normalizeResultCount,
    normalizeLines,
    haversineMeters,
    toLocalPoint,
    isInsideBounds,
    latLngKey,
    isMarkerLikeRect,
    getCandidateText,
    isExtensionElement,
    isMapControlElement,
    hasVisiblePaint,
    hasArea,
    getArea,
    getIntersectionArea,
    getRectOverlapRatio,
    getRectDistance,
    toRadians,
    round,
    roundCoordinate,
    escapeHtml
  };
})();
