(() => {
  const T = window.TransitOverlay;
  const { config } = T;
  const W = T.walkingTimeUtils;

  let tooltip = null;
  let activeSignature = "";

  function createTooltip() {
    if (tooltip) return;

    tooltip = document.createElement("div");
    tooltip.id = "transit-walking-time";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }

  function hasTooltip() {
    return Boolean(tooltip);
  }

  function clear() {
    activeSignature = "";
    hide();
  }

  function hide() {
    if (tooltip) {
      tooltip.hidden = true;
    }
  }

  function showTooltip(candidate, clientX, clientY) {
    if (!tooltip) createTooltip();

    const commuteEstimate = T.transitTime?.getEstimateForLatLng(candidate.latLng);
    const signature = [
      candidate.text,
      candidate.latLng?.lat,
      candidate.latLng?.lng,
      candidate.nearestStations.map((station) => `${station.stationName}:${station.estimatedWalkMinutes}`).join("|"),
      commuteEstimate
        ? `${commuteEstimate.mode}:${commuteEstimate.label}:${commuteEstimate.totalMinutes}:${commuteEstimate.destinationLabel}`
        : ""
    ].join("|");

    if (activeSignature !== signature) {
      tooltip.innerHTML = [
        candidate.nearestStations.map(renderStationEstimate).join(""),
        T.transitTime?.renderTooltipEstimate(commuteEstimate) || ""
      ].join("");
      activeSignature = signature;
    }

    const offset = config.WALKING_TOOLTIP_OFFSET_PX;
    tooltip.hidden = false;
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tooltipRect.width - 8, clientX + offset);
    const top = Math.min(window.innerHeight - tooltipRect.height - 8, clientY + offset);

    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function renderStationEstimate(station) {
    const lines = station.lines.map(renderLineBadge).join("");
    const minutesText = station.estimationSource === "precomputed-graph"
      ? `~${station.estimatedWalkMinutes} min walk`
      : `est. ${station.estimatedWalkMinutes} min walk`;

    return `
      <div class="transit-walking-time-row">
        <div class="transit-walking-time-main">
          <span class="transit-walking-time-name">${W.escapeHtml(station.stationName)}</span>
          <span class="transit-walking-time-minutes">${W.escapeHtml(minutesText)}</span>
        </div>
        <div class="transit-walking-time-lines">${lines}</div>
      </div>
    `;
  }

  function renderLineBadge(line) {
    return `<span class="transit-walking-time-line" data-line="${W.escapeHtml(line)}">${W.escapeHtml(line)}</span>`;
  }

  T.walkingTimeTooltip = {
    create: createTooltip,
    hasTooltip,
    clear,
    hide,
    show: showTooltip
  };
})();
