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

export function isAuthorColor(value) {
  return AUTHOR_COLOR_PALETTE.includes(String(value ?? "").toLocaleLowerCase());
}

/** A stable fallback makes an unconfigured collaborator identifiable immediately. */
export function authorColorFor(profileId, configuredColor) {
  const normalizedColor = String(configuredColor ?? "").toLocaleLowerCase();
  if (isAuthorColor(normalizedColor)) return normalizedColor;
  const value = String(profileId ?? "");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  return AUTHOR_COLOR_PALETTE[hash % AUTHOR_COLOR_PALETTE.length];
}
