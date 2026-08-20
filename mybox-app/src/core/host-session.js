const HOST_SESSION_SCHEMA_VERSION = 1;
const HOST_SESSION_KEY = "ui/session.json";
const HOST_VIEWS = new Set(["apps", "connections", "history", "settings", "chat"]);

function clone(value) {
  return structuredClone(value);
}

export function createDefaultHostSession() {
  return {
    schemaVersion: HOST_SESSION_SCHEMA_VERSION,
    view: "apps",
    appId: null,
  };
}

export function validateHostSession(value) {
  if (
    !value
    || value.schemaVersion !== HOST_SESSION_SCHEMA_VERSION
    || !HOST_VIEWS.has(value.view)
    || (value.appId !== null && (typeof value.appId !== "string" || !value.appId))
  ) {
    throw new TypeError("Host session is invalid");
  }
  return value;
}

export function resolveHostSession(value, installedAppIds = []) {
  const session = validateHostSession(value);
  const installed = new Set(installedAppIds);
  return clone({
    ...session,
    appId: session.appId && installed.has(session.appId) ? session.appId : null,
  });
}

export function createHostSessionStore(storage) {
  if (!storage || typeof storage.readJson !== "function" || typeof storage.writeJson !== "function") {
    throw new TypeError("Host session requires an App storage port");
  }
  return Object.freeze({
    async load() {
      const stored = await storage.readJson(HOST_SESSION_KEY);
      return stored ? clone(validateHostSession(stored)) : createDefaultHostSession();
    },
    async save({ view, appId = null } = {}) {
      const next = validateHostSession({
        schemaVersion: HOST_SESSION_SCHEMA_VERSION,
        view,
        appId,
      });
      await storage.writeJson(HOST_SESSION_KEY, next);
      return clone(next);
    },
  });
}
