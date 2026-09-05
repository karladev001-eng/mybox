// Stable preference IDs; labels may evolve independently.
export const THEMES = Object.freeze([
  { id: "graphite", label: "グラファイト", scheme: "dark" },
  { id: "light", label: "ライト", scheme: "light" },
  { id: "sepia", label: "セピア", scheme: "light" },
  { id: "midnight", label: "ミッドナイト", scheme: "dark" },
]);
export const normalizeTheme = (value) => THEMES.some((theme) => theme.id === value) ? value : "graphite";
