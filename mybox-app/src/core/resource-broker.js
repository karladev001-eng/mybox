import { AppHostError } from "./app-host.js";

const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateResourceReference(reference) {
  if (!reference || typeof reference !== "object"
    || !/^[a-z][a-z0-9-]*$/.test(reference.appId ?? "")
    || typeof reference.resourceId !== "string"
    || !reference.resourceId
    || reference.resourceId.includes("/")
    || reference.resourceId.includes("\\")
    || !MEDIA_TYPES.has(reference.mediaType)
    || !Number.isInteger(reference.revision)
    || reference.revision < 1) {
    throw new AppHostError("INVALID_RESOURCE_REFERENCE", "Resource reference is invalid");
  }
  return reference;
}

export class ResourceBroker {
  #providers = new Map();
  #importers = new Map();

  register(appId, { read, importResource } = {}) {
    if (read) this.#providers.set(appId, read);
    if (importResource) this.#importers.set(appId, importResource);
    return () => { this.#providers.delete(appId); this.#importers.delete(appId); };
  }

  async read(requestingAppId, reference) {
    validateResourceReference(reference);
    const provider = this.#providers.get(reference.appId);
    if (!provider) throw new AppHostError("RESOURCE_PROVIDER_UNAVAILABLE", "Resource provider is unavailable");
    return provider(reference, { requestingAppId });
  }

  async import(targetAppId, reference, options = {}) {
    const bytes = await this.read(targetAppId, reference);
    const importer = this.#importers.get(targetAppId);
    if (!importer) throw new AppHostError("RESOURCE_IMPORTER_UNAVAILABLE", "Resource importer is unavailable");
    return importer(bytes, { reference, ...options });
  }
}
