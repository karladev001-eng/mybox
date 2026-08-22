import { isValidAppVersion } from "../core/app-version.js";

const APP_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SHORTCUT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SURFACE_KINDS = new Set(["generic", "module"]);

export class AppRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AppRegistryError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppRegistryError("INVALID_APP_DEFINITION", `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function normalizeShortcuts(shortcuts = []) {
  if (!Array.isArray(shortcuts)) {
    throw new AppRegistryError("INVALID_APP_SHORTCUT", "App shortcuts must be an array");
  }
  const ids = new Set();
  return Object.freeze(shortcuts.map((shortcut, index) => {
    const field = `shortcuts[${index}]`;
    if (!shortcut || typeof shortcut !== "object") {
      throw new AppRegistryError("INVALID_APP_SHORTCUT", `${field} must be an object`, { field });
    }
    const id = requireText(shortcut.id, `${field}.id`);
    if (!SHORTCUT_ID_PATTERN.test(id) || ids.has(id)) {
      throw new AppRegistryError("INVALID_APP_SHORTCUT", "App shortcut IDs must be unique lowercase slugs", { id });
    }
    ids.add(id);
    const key = requireText(shortcut.key, `${field}.key`).toLowerCase();
    const displayKeys = shortcut.displayKeys;
    if (!Array.isArray(displayKeys) || displayKeys.length < 2 || displayKeys.some((item) => typeof item !== "string" || !item.trim())) {
      throw new AppRegistryError("INVALID_APP_SHORTCUT", "App shortcuts require display keys", { id });
    }
    return Object.freeze({
      id,
      group: requireText(shortcut.group ?? "操作", `${field}.group`),
      label: requireText(shortcut.label, `${field}.label`),
      key,
      code: requireText(shortcut.code, `${field}.code`),
      shiftKey: shortcut.shiftKey === true,
      displayKeys: Object.freeze(displayKeys.map((item) => item.trim())),
      searchText: typeof shortcut.searchText === "string" ? shortcut.searchText.trim() : "",
    });
  }));
}

export function defineAppSurface(definition) {
  if (!definition || typeof definition !== "object") {
    throw new AppRegistryError("INVALID_APP_DEFINITION", "App definition must be an object");
  }
  const id = requireText(definition.id, "id");
  if (!APP_ID_PATTERN.test(id)) {
    throw new AppRegistryError("INVALID_APP_ID", "App ID must be a stable lowercase slug", { id });
  }
  const color = requireText(definition.color, "color");
  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new AppRegistryError("INVALID_APP_COLOR", "App color must be a six-digit hex color", { color });
  }
  const version = requireText(definition.version, "version");
  if (!isValidAppVersion(version)) {
    throw new AppRegistryError("INVALID_APP_VERSION", "App version must use semantic versioning", { version });
  }
  const surface = definition.surface ?? { kind: "generic" };
  if (!SURFACE_KINDS.has(surface.kind)) {
    throw new AppRegistryError("INVALID_APP_SURFACE", "App surface kind is invalid", { kind: surface.kind });
  }
  if (surface.kind === "module" && typeof surface.load !== "function") {
    throw new AppRegistryError("INVALID_APP_SURFACE", "Module App surfaces require a load function", { id });
  }
  const normalizedSurface = surface.kind === "module"
    ? Object.freeze({ kind: "module", load: surface.load, exportName: requireText(surface.exportName, "surface.exportName") })
    : Object.freeze({ kind: "generic" });

  return Object.freeze({
    id,
    version,
    name: requireText(definition.name, "name"),
    icon: requireText(definition.icon, "icon"),
    color,
    hint: requireText(definition.hint, "hint"),
    builtIn: definition.builtIn === true,
    defaultInstalled: definition.defaultInstalled === true,
    shortcuts: normalizeShortcuts(definition.shortcuts),
    surface: normalizedSurface,
  });
}

export class AppRegistry {
  #definitions = new Map();

  register(definition) {
    const app = defineAppSurface(definition);
    if (this.#definitions.has(app.id)) {
      throw new AppRegistryError("APP_ID_CONFLICT", "App ID is already registered", { id: app.id });
    }
    this.#definitions.set(app.id, app);
    return app;
  }

  get(appId) {
    return this.#definitions.get(appId) ?? null;
  }

  list() {
    return [...this.#definitions.values()];
  }

  listDefaultInstalled() {
    return this.list().filter((app) => app.defaultInstalled);
  }
}

// Only Apps with a working Surface are offered. A placeholder in the catalog
// reads as a shipped feature and installs to an empty screen.
const builtInDefinitions = [
  {
    id: "knowledge",
    version: "1.14.1",
    name: "Note",
    icon: "note",
    color: "#ff796f",
    hint: "PageとBlockをつなげて記録",
    builtIn: true,
    defaultInstalled: true,
    shortcuts: [
      {
        id: "page-search",
        group: "Note",
        label: "Pageを検索",
        key: "p",
        code: "KeyP",
        displayKeys: ["Ctrl", "P"],
        searchText: "Note Page ページ 検索",
      },
    ],
    surface: {
      kind: "module",
      load: () => import("../knowledge/KnowledgeView.jsx"),
      exportName: "KnowledgeView",
    },
  },
  {
    id: "image-studio",
    version: "0.4.1",
    name: "Image",
    icon: "image",
    color: "#67d7c4",
    hint: "テンプレートと参照画像から1枚を生成",
    builtIn: true,
    defaultInstalled: true,
    shortcuts: [],
    surface: {
      kind: "module",
      load: () => import("../image-studio/ImageStudioView.jsx"),
      exportName: "ImageStudioView",
    },
  },
];

export function createMyBoxAppRegistry() {
  const registry = new AppRegistry();
  builtInDefinitions.forEach((definition) => registry.register(definition));
  return registry;
}

export function createCustomAppDefinition({ name, icon, color, now = Date.now } = {}) {
  return defineAppSurface({
    id: `custom-${now()}`,
    version: "1.0.0",
    name,
    icon,
    color,
    hint: "カスタムアプリ",
    surface: { kind: "generic" },
  });
}
