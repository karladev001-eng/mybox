export const AGENT_PROVIDER_KINDS = Object.freeze(["subscription", "api", "local"]);

export class AgentProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AgentProviderError";
    this.code = code;
    this.details = details;
  }
}

function assert(condition, message, details = {}) {
  if (!condition) throw new AgentProviderError("INVALID_PROVIDER", message, details);
}

function validateDescriptor(descriptor) {
  assert(descriptor && typeof descriptor === "object", "Provider descriptor is required");
  assert(/^[a-z][a-z0-9-]*$/.test(descriptor.id ?? ""), "Provider ID is invalid", { id: descriptor.id });
  assert(typeof descriptor.name === "string" && descriptor.name.trim(), "Provider name is required");
  assert(AGENT_PROVIDER_KINDS.includes(descriptor.kind), "Provider kind is invalid", { kind: descriptor.kind });
  assert(typeof descriptor.authMode === "string" && descriptor.authMode.trim(), "Provider auth mode is required");
  assert(descriptor.capabilities && typeof descriptor.capabilities === "object", "Provider capabilities are required");
  assert(descriptor.capabilities.text === true, "A provider must support text generation");
  return Object.freeze(structuredClone(descriptor));
}

export function defineAgentProvider({ descriptor, getStatus, generate, listModels, getUsage }) {
  const stableDescriptor = validateDescriptor(descriptor);
  assert(typeof getStatus === "function", "Provider getStatus must be a function");
  assert(typeof generate === "function", "Provider generate must be a function");
  assert(listModels === undefined || typeof listModels === "function", "Provider listModels must be a function");
  assert(getUsage === undefined || typeof getUsage === "function", "Provider getUsage must be a function");
  return Object.freeze({ descriptor: stableDescriptor, getStatus, generate, listModels, getUsage });
}

export class AgentProviderRegistry {
  #providers = new Map();

  register(provider) {
    const stable = defineAgentProvider(provider);
    const { id } = stable.descriptor;
    if (this.#providers.has(id)) {
      throw new AgentProviderError("PROVIDER_ALREADY_REGISTERED", "Provider is already registered", { id });
    }
    this.#providers.set(id, stable);
    return () => this.unregister(id);
  }

  unregister(id) {
    return this.#providers.delete(id);
  }

  get(id) {
    const provider = this.#providers.get(id);
    if (!provider) throw new AgentProviderError("PROVIDER_NOT_FOUND", "Provider is unavailable", { id });
    return provider;
  }

  list() {
    return [...this.#providers.values()].map(({ descriptor }) => descriptor);
  }
}
