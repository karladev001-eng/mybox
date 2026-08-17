import { isValidAppVersion } from "./app-version.js";

const INSTALLATION_SCHEMA_VERSION = 2;
const LEGACY_INSTALLATION_SCHEMA_VERSION = 1;
const INSTALLATION_KEY = "apps/installations.json";

function clone(value) {
  return structuredClone(value);
}

function installationEntry(app) {
  if (!app || typeof app.id !== "string" || !isValidAppVersion(app.version)) {
    throw new TypeError("Installed Apps require an ID and semantic version");
  }
  return { id: app.id, version: app.version };
}

export function createDefaultAppInstallations(defaultInstalledApps = []) {
  return {
    schemaVersion: INSTALLATION_SCHEMA_VERSION,
    installedApps: defaultInstalledApps.map(installationEntry),
    customApps: [],
  };
}

export function validateAppInstallations(value) {
  if (
    !value
    || value.schemaVersion !== INSTALLATION_SCHEMA_VERSION
    || !Array.isArray(value.installedApps)
    || value.installedApps.some((app) => !app || typeof app.id !== "string" || !isValidAppVersion(app.version))
    || new Set(value.installedApps.map((app) => app.id)).size !== value.installedApps.length
    || !Array.isArray(value.customApps)
    || value.customApps.some((app) => !app || typeof app.id !== "string" || !isValidAppVersion(app.version))
  ) {
    throw new TypeError("App installations are invalid");
  }
  return value;
}

function migrateLegacyAppInstallations(value, availableApps) {
  if (
    !value
    || value.schemaVersion !== LEGACY_INSTALLATION_SCHEMA_VERSION
    || !Array.isArray(value.installedAppIds)
    || value.installedAppIds.some((id) => typeof id !== "string")
    || !Array.isArray(value.customApps)
  ) {
    throw new TypeError("App installations are invalid");
  }
  const customApps = value.customApps.map((app) => ({ ...app, version: isValidAppVersion(app.version) ? app.version : "1.0.0" }));
  const versions = new Map([...availableApps, ...customApps].map((app) => [app.id, app.version]));
  return validateAppInstallations({
    schemaVersion: INSTALLATION_SCHEMA_VERSION,
    installedApps: [...new Set(value.installedAppIds)].map((id) => ({ id, version: versions.get(id) ?? "1.0.0" })),
    customApps,
  });
}

function installedVersion(installedVersions, app) {
  const version = installedVersions instanceof Map ? installedVersions.get(app.id) : installedVersions?.[app.id];
  return version ?? app.version;
}

export function snapshotAppInstallations(apps, catalog = apps, installedVersions = {}) {
  return validateAppInstallations({
    schemaVersion: INSTALLATION_SCHEMA_VERSION,
    installedApps: apps.map((app) => installationEntry({ id: app.id, version: installedVersion(installedVersions, app) })),
    customApps: catalog.filter((app) => !app.builtIn).map((app) => ({
      id: app.id,
      version: app.version,
      name: app.name,
      icon: app.icon,
      color: app.color,
      hint: app.hint,
    })),
  });
}

export function createAppInstallationsStore(storage, { defaultInstalledApps = [], availableApps = defaultInstalledApps } = {}) {
  if (!storage || typeof storage.readJson !== "function" || typeof storage.writeJson !== "function") {
    throw new TypeError("App installations require an App storage port");
  }
  return Object.freeze({
    async load() {
      const stored = await storage.readJson(INSTALLATION_KEY);
      if (!stored) return clone(createDefaultAppInstallations(defaultInstalledApps));
      const normalized = stored.schemaVersion === LEGACY_INSTALLATION_SCHEMA_VERSION
        ? migrateLegacyAppInstallations(stored, availableApps)
        : validateAppInstallations(stored);
      return clone(normalized);
    },
    async save(apps, catalog = apps, installedVersions = {}) {
      const snapshot = snapshotAppInstallations(apps, catalog, installedVersions);
      await storage.writeJson(INSTALLATION_KEY, snapshot);
      return clone(snapshot);
    },
  });
}
