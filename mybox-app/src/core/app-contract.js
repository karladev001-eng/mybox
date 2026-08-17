export const APP_SCHEMA_VERSION = 2;

export const OPERATION_EFFECTS = Object.freeze([
  "read",
  "write",
  "external",
  "destructive",
]);

export const CALLER_TYPES = Object.freeze([
  "user",
  "agent",
  "flow",
  "app",
  "system",
]);

export const CONFIRMATION_LEVELS = Object.freeze([
  "review",
  "recoverable",
  "autonomous",
]);

export const CONFIRMATION_CLASSES = Object.freeze([
  ...CONFIRMATION_LEVELS,
  "always-confirm",
]);

const APP_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export class AppContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AppContractError";
    this.code = "INVALID_APP_CONTRACT";
    this.details = details;
  }
}

function assert(condition, message, details) {
  if (!condition) throw new AppContractError(message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function validateCapabilityId(appId, id, kind) {
  assert(typeof id === "string" && CAPABILITY_ID_PATTERN.test(id), `${kind} ID is invalid`, { id });
  assert(id.startsWith(`${appId}.`), `${kind} ID must be namespaced by the app ID`, {
    appId,
    id,
  });
}

function validateSchema(schema, label) {
  assert(isObject(schema), `${label} must be a JSON Schema object`);
}

export function validateAppManifest(manifest) {
  assert(isObject(manifest), "App manifest must be an object");
  assert(manifest.schemaVersion === APP_SCHEMA_VERSION, "Unsupported app schema version", {
    expected: APP_SCHEMA_VERSION,
    actual: manifest.schemaVersion,
  });
  assert(typeof manifest.id === "string" && APP_ID_PATTERN.test(manifest.id), "App ID is invalid", {
    id: manifest.id,
  });
  assert(typeof manifest.name === "string" && manifest.name.trim(), "App name is required");
  assert(typeof manifest.version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version), "App version must be semantic", {
    version: manifest.version,
  });
  assert(Array.isArray(manifest.operations), "Manifest operations must be an array");
  assert(Array.isArray(manifest.events), "Manifest events must be an array");

  const seenIds = new Set();
  for (const operation of manifest.operations) {
    assert(isObject(operation), "Operation declaration must be an object");
    validateCapabilityId(manifest.id, operation.id, "Operation");
    assert(!seenIds.has(operation.id), "Capability IDs must be unique in an app", { id: operation.id });
    seenIds.add(operation.id);
    assert(typeof operation.title === "string" && operation.title.trim(), "Operation title is required", {
      id: operation.id,
    });
    assert(OPERATION_EFFECTS.includes(operation.effect), "Operation effect is invalid", {
      id: operation.id,
      effect: operation.effect,
    });
    assert(CONFIRMATION_CLASSES.includes(operation.confirmationClass), "Operation Confirmation class is invalid", {
      id: operation.id,
      confirmationClass: operation.confirmationClass,
    });
    assert(Array.isArray(operation.callers) && operation.callers.length > 0, "Operation callers are required", {
      id: operation.id,
    });
    assert(operation.callers.every((caller) => CALLER_TYPES.includes(caller)), "Operation caller is invalid", {
      id: operation.id,
      callers: operation.callers,
    });
    assert(new Set(operation.callers).size === operation.callers.length, "Operation callers must be unique", {
      id: operation.id,
    });
    validateSchema(operation.inputSchema, `${operation.id} inputSchema`);
    validateSchema(operation.outputSchema, `${operation.id} outputSchema`);
  }

  for (const event of manifest.events) {
    assert(isObject(event), "Event declaration must be an object");
    validateCapabilityId(manifest.id, event.id, "Event");
    assert(!seenIds.has(event.id), "Capability IDs must be unique in an app", { id: event.id });
    seenIds.add(event.id);
    assert(typeof event.title === "string" && event.title.trim(), "Event title is required", {
      id: event.id,
    });
    validateSchema(event.payloadSchema, `${event.id} payloadSchema`);
  }

  if (manifest.hostCapabilities !== undefined) {
    assert(Array.isArray(manifest.hostCapabilities), "hostCapabilities must be an array");
    assert(manifest.hostCapabilities.every((item) => typeof item === "string" && item.trim()), "hostCapabilities must contain non-empty strings");
  }

  return manifest;
}

export function defineApp({ manifest, handlers }) {
  const stableManifest = structuredClone(manifest);
  validateAppManifest(stableManifest);
  assert(isObject(handlers), "App handlers must be an object");

  const operationIds = new Set(stableManifest.operations.map((operation) => operation.id));
  for (const id of operationIds) {
    assert(typeof handlers[id] === "function", "Every operation must have a handler", { id });
  }
  for (const id of Object.keys(handlers)) {
    assert(operationIds.has(id), "Handler is not declared in the manifest", { id });
  }

  return Object.freeze({
    manifest: deepFreeze(stableManifest),
    handlers: Object.freeze({ ...handlers }),
  });
}
