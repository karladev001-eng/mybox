export const NO_AUTHOR_COLOR = "transparent";

export const AUTHOR_COLOR_PALETTE = Object.freeze([
  "#67d7c4",
  "#5f91ff",
  "#8a74ff",
  "#f783ac",
  "#ff796f",
  "#ffa94d",
  "#ffd43b",
  "#69db7c",
]);

export const AUTHOR_COLOR_OPTIONS = Object.freeze([NO_AUTHOR_COLOR, ...AUTHOR_COLOR_PALETTE]);

export function isAuthorColor(value) {
  return AUTHOR_COLOR_OPTIONS.includes(String(value ?? "").toLocaleLowerCase());
}

export function isVisibleAuthorColor(value) {
  const normalizedColor = String(value ?? "").toLocaleLowerCase();
  return isAuthorColor(normalizedColor) && normalizedColor !== NO_AUTHOR_COLOR;
}

/** Unconfigured members stay neutral until they choose a Project color. */
export function authorColorFor(_profileId, configuredColor) {
  const normalizedColor = String(configuredColor ?? "").toLocaleLowerCase();
  if (isAuthorColor(normalizedColor)) return normalizedColor;
  return NO_AUTHOR_COLOR;
}
