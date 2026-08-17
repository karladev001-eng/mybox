import { isValidAppVersion } from "../core/app-version.js";

const APP_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
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

const builtInDefinitions = [
  { id: "image", version: "1.0.0", name: "画像", icon: "image", color: "#8a74ff", hint: "画像の整理と変換", builtIn: true, defaultInstalled: true },
  {
    id: "knowledge",
    version: "1.1.0",
    name: "メモ",
    icon: "note",
    color: "#ff796f",
    hint: "PageとBlockをつなげて記録",
    builtIn: true,
    defaultInstalled: true,
    surface: {
      kind: "module",
      load: () => import("../knowledge/KnowledgeView.jsx"),
      exportName: "KnowledgeView",
    },
  },
  { id: "files", version: "1.0.0", name: "ファイル", icon: "folder", color: "#5f91ff", hint: "ローカルファイルを管理", builtIn: true, defaultInstalled: true },
  { id: "convert", version: "1.0.0", name: "変換", icon: "convert", color: "#ffc45b", hint: "形式をまとめて変換", builtIn: true, defaultInstalled: true },
  { id: "publish", version: "1.0.0", name: "公開", icon: "publish", color: "#a68aff", hint: "成果物を公開", builtIn: true, defaultInstalled: true },
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
