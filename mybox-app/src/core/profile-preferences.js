import { normalizeTheme, THEMES } from "./themes.js";
import { CONFIRMATION_LEVELS } from "./app-contract.js";

const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_KEY = "profile/preferences.json";

export function createDefaultProfilePreferences() {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    confirmationLevel: "review",
    contextAutoRecord: true,
    theme: "graphite",
  };
}

export function validateProfilePreferences(value) {
  if (
    !value
    || value.schemaVersion !== PROFILE_SCHEMA_VERSION
    || !CONFIRMATION_LEVELS.includes(value.confirmationLevel)
  ) {
    throw new TypeError("Profile preferences are invalid");
  }
  if (value.contextAutoRecord !== undefined && typeof value.contextAutoRecord !== "boolean") throw new TypeError("Context recording preference is invalid");
  return { ...value, theme: normalizeTheme(value.theme), contextAutoRecord: value.contextAutoRecord ?? true };
}

export function createProfilePreferencesStore(storage) {
  if (!storage || typeof storage.readJson !== "function" || typeof storage.writeJson !== "function") {
    throw new TypeError("Profile preferences require an App storage port");
  }
  let queue = Promise.resolve();
  const update = (current, changes) => {
    const pending = queue.catch(() => {}).then(async () => {
      const stored = await storage.readJson(PROFILE_KEY);
      const next = { ...validateProfilePreferences(stored ?? current), ...changes };
      await storage.writeJson(PROFILE_KEY, next);
      return structuredClone(next);
    });
    queue = pending;
    return pending;
  };
  return Object.freeze({
    async setTheme(current, theme) {
      if (!THEMES.some((entry) => entry.id === theme)) throw new TypeError("Theme is invalid");
      return update(current, { theme });
    },
    async setContextAutoRecord(current, enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("Context recording preference is invalid");
      return update(current, { contextAutoRecord: enabled });
    },
    async load() {
      const stored = await storage.readJson(PROFILE_KEY);
      return stored ? structuredClone(validateProfilePreferences(stored)) : createDefaultProfilePreferences();
    },
    async setConfirmationLevel(current, confirmationLevel) {
      if (!CONFIRMATION_LEVELS.includes(confirmationLevel)) {
        throw new TypeError("Confirmation level is invalid");
      }
      return update(current, { confirmationLevel });
    },
  });
}
