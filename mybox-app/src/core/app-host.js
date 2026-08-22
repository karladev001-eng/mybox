import Ajv from "ajv";
import { CALLER_TYPES, CONFIRMATION_LEVELS, defineApp } from "./app-contract.js";
import { createAppStorage, MemoryStorageDriver } from "./storage.js";

export class AppHostError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AppHostError";
    this.code = code;
    this.details = details;
  }
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function validateActor(actor) {
  if (!actor || !CALLER_TYPES.includes(actor.type) || typeof actor.id !== "string" || !actor.id) {
    throw new AppHostError("INVALID_ACTOR", "Invocation requires a valid actor");
  }
}

function grantIncludes(grant, operationId, now) {
  if (!grant || !Array.isArray(grant.operationIds)) return false;
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= now.getTime()) return false;
  return grant.operationIds.includes(operationId) || grant.operationIds.includes("*");
}

export async function defaultAuthorize({ actor, operation, grant, approval, confirmationLevel, now }) {
  if (!operation.callers.includes(actor.type)) {
    throw new AppHostError("CALLER_NOT_ALLOWED", "Operation is not exposed to this caller type", {
      operationId: operation.id,
      callerType: actor.type,
    });
  }

  if (actor.type === "user" || actor.type === "system") return;

  if (!grantIncludes(grant, operation.id, now)) {
    throw new AppHostError("GRANT_REQUIRED", "Caller needs a scoped grant for this operation", {
      operationId: operation.id,
      actor,
    });
  }

  const freshApproval = approval?.granted === true && approval?.fresh === true;
  if (operation.confirmationClass === "always-confirm" && !freshApproval) {
    throw new AppHostError("ALWAYS_CONFIRM_REQUIRED", "Operation always requires fresh confirmation", {
      operationId: operation.id,
      confirmationClass: operation.confirmationClass,
    });
  }

  if (freshApproval) return;

  const requiredLevel = CONFIRMATION_LEVELS.indexOf(operation.confirmationClass);
  const currentLevel = CONFIRMATION_LEVELS.indexOf(confirmationLevel);
  if (currentLevel < requiredLevel) {
    throw new AppHostError("CONFIRMATION_REQUIRED", "Operation exceeds the current Confirmation level", {
      operationId: operation.id,
      confirmationClass: operation.confirmationClass,
      confirmationLevel,
    });
  }
}

export class AppHost {
  #apps = new Map();
  #operations = new Map();
  #events = new Map();
  #subscriptions = new Map();
  #authorize;
  #audit;
  #clock;
  #storageDriver;
  #ajv;
  #connections;
  #resources;

  constructor({
    authorize = defaultAuthorize,
    audit = async () => {},
    clock = () => new Date(),
    storageDriver = new MemoryStorageDriver(),
    connections = null,
    resources = null,
  } = {}) {
    this.#authorize = authorize;
    this.#audit = audit;
    this.#clock = clock;
    this.#storageDriver = storageDriver;
    this.#connections = connections;
    this.#resources = resources;
    this.#ajv = new Ajv({ allErrors: true, strict: false });
  }

  register(definition) {
    const app = defineApp(definition);
    const { manifest } = app;
    if (this.#apps.has(manifest.id)) {
      throw new AppHostError("APP_ALREADY_REGISTERED", "App is already registered", { appId: manifest.id });
    }

    const operationRecords = manifest.operations.map((operation) => {
      if (this.#operations.has(operation.id)) {
        throw new AppHostError("CAPABILITY_ALREADY_REGISTERED", "Operation ID is already registered", {
          operationId: operation.id,
        });
      }
      return {
        appId: manifest.id,
        declaration: operation,
        handler: app.handlers[operation.id],
        validateInput: this.#ajv.compile(operation.inputSchema),
        validateOutput: this.#ajv.compile(operation.outputSchema),
      };
    });

    const eventRecords = manifest.events.map((event) => {
      if (this.#events.has(event.id)) {
        throw new AppHostError("CAPABILITY_ALREADY_REGISTERED", "Event ID is already registered", {
          eventId: event.id,
        });
      }
      return {
        appId: manifest.id,
        declaration: event,
        validatePayload: this.#ajv.compile(event.payloadSchema),
      };
    });

    this.#apps.set(manifest.id, app);
    operationRecords.forEach((record) => this.#operations.set(record.declaration.id, record));
    eventRecords.forEach((record) => this.#events.set(record.declaration.id, record));
    return () => this.unregister(manifest.id);
  }

  unregister(appId) {
    const app = this.#apps.get(appId);
    if (!app) return false;

    app.manifest.operations.forEach(({ id }) => this.#operations.delete(id));
    app.manifest.events.forEach(({ id }) => {
      this.#events.delete(id);
      this.#subscriptions.delete(id);
    });
    for (const [eventId, subscriptions] of this.#subscriptions) {
      const remaining = subscriptions.filter((subscription) => subscription.subscriberId !== appId);
      if (remaining.length) this.#subscriptions.set(eventId, remaining);
      else this.#subscriptions.delete(eventId);
    }
    this.#apps.delete(appId);
    return true;
  }

  listApps() {
    return [...this.#apps.values()].map(({ manifest }) => manifest);
  }

  listOperations({ callerType } = {}) {
    if (callerType !== undefined && !CALLER_TYPES.includes(callerType)) {
      throw new AppHostError("INVALID_CALLER_TYPE", "Unknown caller type", { callerType });
    }
    return [...this.#operations.values()]
      .map(({ declaration }) => declaration)
      .filter((operation) => callerType === undefined || operation.callers.includes(callerType));
  }

  getManifest(appId) {
    return this.#apps.get(appId)?.manifest ?? null;
  }

  subscribe(eventId, handler, { subscriberId = null } = {}) {
    if (!this.#events.has(eventId)) {
      throw new AppHostError("EVENT_NOT_FOUND", "Cannot subscribe to an unknown event", { eventId });
    }
    if (typeof handler !== "function") {
      throw new AppHostError("INVALID_SUBSCRIBER", "Event subscriber must be a function", { eventId });
    }
    const subscription = { id: newId(), subscriberId, handler };
    const subscriptions = this.#subscriptions.get(eventId) ?? [];
    subscriptions.push(subscription);
    this.#subscriptions.set(eventId, subscriptions);
    return () => {
      const current = this.#subscriptions.get(eventId) ?? [];
      const next = current.filter(({ id }) => id !== subscription.id);
      if (next.length) this.#subscriptions.set(eventId, next);
      else this.#subscriptions.delete(eventId);
    };
  }

  async #emit(sourceAppId, eventId, payload, correlationId) {
    const event = this.#events.get(eventId);
    if (!event || event.appId !== sourceAppId) {
      throw new AppHostError("EVENT_NOT_DECLARED", "App cannot emit this event", {
        sourceAppId,
        eventId,
      });
    }
    if (!event.validatePayload(payload)) {
      throw new AppHostError("INVALID_EVENT_PAYLOAD", "Event payload does not match its schema", {
        eventId,
        errors: event.validatePayload.errors,
      });
    }

    const envelope = Object.freeze({
      id: newId(),
      type: eventId,
      sourceAppId,
      occurredAt: this.#clock().toISOString(),
      correlationId,
      payload,
    });
    const results = await Promise.allSettled(
      (this.#subscriptions.get(eventId) ?? []).map(({ handler }) => handler(envelope)),
    );
    return { envelope, results };
  }

  async invoke(operationId, input, {
    actor = { type: "user", id: "local-user" },
    grant,
    approval,
    confirmationLevel = "review",
    reason = "",
    correlationId = newId(),
  } = {}) {
    const startedAt = this.#clock();
    const record = this.#operations.get(operationId);
    let outcome = "failed";
    let errorCode = null;

    try {
      validateActor(actor);
      if (!CONFIRMATION_LEVELS.includes(confirmationLevel)) {
        throw new AppHostError("INVALID_CONFIRMATION_LEVEL", "Invocation requires a valid Confirmation level", {
          confirmationLevel,
        });
      }
      if (!record) {
        throw new AppHostError("OPERATION_NOT_FOUND", "Operation is unavailable", { operationId });
      }
      if (!record.validateInput(input)) {
        throw new AppHostError("INVALID_OPERATION_INPUT", "Operation input does not match its schema", {
          operationId,
          errors: record.validateInput.errors,
        });
      }

      await this.#authorize({
        actor,
        operation: record.declaration,
        grant,
        approval,
        confirmationLevel,
        reason,
        now: startedAt,
      });

      const result = await record.handler(input, Object.freeze({
        actor,
        appId: record.appId,
        correlationId,
        storage: createAppStorage(record.appId, this.#storageDriver),
        emit: (eventId, payload) => this.#emit(record.appId, eventId, payload, correlationId),
        invoke: (targetId, targetInput, options = {}) => this.invoke(targetId, targetInput, {
          ...options,
          actor: { type: "app", id: record.appId },
          correlationId,
        }),
        connections: Object.freeze({
          pull: (targetConnectorId) => {
            if (!this.#connections?.pull) throw new AppHostError("CONNECTIONS_UNAVAILABLE", "Connection runtime is unavailable");
            return this.#connections.pull(record.appId, targetConnectorId, { correlationId });
          },
        }),
        resources: Object.freeze({
          read: (reference) => {
            if (!this.#resources?.read) throw new AppHostError("RESOURCES_UNAVAILABLE", "Resource broker is unavailable");
            return this.#resources.read(record.appId, reference);
          },
          import: (reference, options) => {
            if (!this.#resources?.import) throw new AppHostError("RESOURCES_UNAVAILABLE", "Resource broker is unavailable");
            return this.#resources.import(record.appId, reference, options);
          },
        }),
      }));

      if (!record.validateOutput(result)) {
        throw new AppHostError("INVALID_OPERATION_OUTPUT", "Operation output does not match its schema", {
          operationId,
          errors: record.validateOutput.errors,
        });
      }
      outcome = "succeeded";
      return result;
    } catch (error) {
      errorCode = error.code ?? "UNEXPECTED_ERROR";
      throw error;
    } finally {
      const finishedAt = this.#clock();
      await this.#audit(Object.freeze({
        id: newId(),
        operationId,
        appId: record?.appId ?? null,
        actor,
        effect: record?.declaration.effect ?? null,
        confirmationClass: record?.declaration.confirmationClass ?? null,
        confirmationLevel,
        reason,
        correlationId,
        startedAt: startedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        outcome,
        errorCode,
      }));
    }
  }
}
