const APP_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export class StorageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.details = details;
  }
}

function validateAppId(appId) {
  if (typeof appId !== "string" || !APP_ID_PATTERN.test(appId)) {
    throw new StorageError("INVALID_APP_ID", "Storage namespace requires a valid app ID", { appId });
  }
}

function validateKey(key, { allowEmpty = false } = {}) {
  if (typeof key !== "string" || (!allowEmpty && key.length === 0)) {
    throw new StorageError("INVALID_STORAGE_KEY", "Storage key must be a non-empty string", { key });
  }
  if (key === "" && allowEmpty) return key;

  const segments = key.split("/");
  if (
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new StorageError("INVALID_STORAGE_KEY", "Storage key cannot escape its app namespace", { key });
  }
  return key;
}

function cloneJson(value) {
  if (value === undefined) {
    throw new StorageError("INVALID_JSON_VALUE", "Storage values must be JSON-compatible");
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Value cannot be represented as JSON");
    return JSON.parse(serialized);
  } catch (error) {
    throw new StorageError("INVALID_JSON_VALUE", "Storage values must be JSON-compatible", {
      cause: error.message,
    });
  }
}

export class MemoryStorageDriver {
  #namespaces = new Map();

  #namespace(appId) {
    if (!this.#namespaces.has(appId)) this.#namespaces.set(appId, new Map());
    return this.#namespaces.get(appId);
  }

  async read(appId, key) {
    const value = this.#namespace(appId).get(key);
    return value === undefined ? undefined : cloneJson(value);
  }

  async write(appId, key, value) {
    this.#namespace(appId).set(key, cloneJson(value));
  }

  async delete(appId, key) {
    return this.#namespace(appId).delete(key);
  }

  async list(appId, prefix) {
    return [...this.#namespace(appId).keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

export function createAppStorage(appId, driver) {
  validateAppId(appId);
  for (const method of ["read", "write", "delete", "list"]) {
    if (typeof driver?.[method] !== "function") {
      throw new StorageError("INVALID_STORAGE_DRIVER", `Storage driver is missing ${method}()`);
    }
  }

  return Object.freeze({
    async readJson(key) {
      validateKey(key);
      const value = await driver.read(appId, key);
      return value === undefined ? null : value;
    },
    async writeJson(key, value) {
      validateKey(key);
      await driver.write(appId, key, cloneJson(value));
    },
    async delete(key) {
      validateKey(key);
      return driver.delete(appId, key);
    },
    async list(prefix = "") {
      validateKey(prefix, { allowEmpty: true });
      return driver.list(appId, prefix);
    },
  });
}
