import { CONFIRMATION_LEVELS } from "./app-contract.js";

const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_KEY = "profile/preferences.json";

export function createDefaultProfilePreferences() {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    confirmationLevel: "review",
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
  return value;
}

export function createProfilePreferencesStore(storage) {
  if (!storage || typeof storage.readJson !== "function" || typeof storage.writeJson !== "function") {
    throw new TypeError("Profile preferences require an App storage port");
  }
  return Object.freeze({
    async load() {
      const stored = await storage.readJson(PROFILE_KEY);
      return stored ? structuredClone(validateProfilePreferences(stored)) : createDefaultProfilePreferences();
    },
    async setConfirmationLevel(current, confirmationLevel) {
      if (!CONFIRMATION_LEVELS.includes(confirmationLevel)) {
        throw new TypeError("Confirmation level is invalid");
      }
      const next = { ...validateProfilePreferences(current), confirmationLevel };
      await storage.writeJson(PROFILE_KEY, next);
      return structuredClone(next);
    },
  });
}
