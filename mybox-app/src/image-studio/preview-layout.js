const DEFAULT_RATIO = 1;
const PREVIEW_VERTICAL_RESERVE = 190;

function requestedRatioValue(requestedRatio) {
  if (requestedRatio === "auto") return DEFAULT_RATIO;
  const [width, height] = String(requestedRatio).split(":").map(Number);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? width / height
    : DEFAULT_RATIO;
}

/**
 * Sizes the preview from both available width and viewport height. CSS receives
 * the numeric ratio separately so a portrait frame narrows before it can grow
 * below the visible desktop surface.
 */
export function previewFrameLayout({ actualWidth, actualHeight, requestedRatio = "auto", complete = false } = {}) {
  const hasActualSize = complete
    && Number.isFinite(actualWidth)
    && actualWidth > 0
    && Number.isFinite(actualHeight)
    && actualHeight > 0;
  const fitRatio = hasActualSize ? actualWidth / actualHeight : requestedRatioValue(requestedRatio);
  return {
    aspectRatio: hasActualSize ? `${actualWidth} / ${actualHeight}` : requestedRatio === "auto" ? "1 / 1" : requestedRatio.replace(":", " / "),
    "--image-preview-height-bound": `calc(${fitRatio * 100}dvh - ${fitRatio * PREVIEW_VERTICAL_RESERVE}px)`,
  };
}
