import { AppHostError } from "./app-host.js";

const STORAGE_KEY = "connections.json";
const VERSION = 1;

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `connection-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function findConnector(host, endpoint, direction) {
  const manifest = host.getManifest(endpoint.appId);
  const connector = manifest?.connectors?.[direction]?.find((item) => item.id === endpoint.connectorId);
  return { manifest, connector };
}

function connectionGrant(operationId) {
  return { operationIds: [operationId] };
}

function compatible(source, target) {
  return Boolean(source && target && source.dataType === target.dataType);
}

export class ConnectionManager {
  #host;
  #storage;
  #records = [];
  #subscriptions = new Map();
  #confirmationLevel;
  #userId;

  constructor({ host, storage, confirmationLevel = () => "review", userId = () => "local-user" }) {
    this.#host = host;
    this.#storage = storage;
    this.#confirmationLevel = confirmationLevel;
    this.#userId = userId;
  }

  async load() {
    const stored = await this.#storage.readJson(STORAGE_KEY);
    this.#records = Array.isArray(stored?.connections) ? stored.connections : [];
    await this.#reconcile();
    return this.list();
  }

  list() {
    return structuredClone(this.#records);
  }

  listCompatiblePairs() {
    const manifests = this.#host.listApps();
    const sources = manifests.flatMap((manifest) => (manifest.connectors?.sources ?? []).map((connector) => ({ appId: manifest.id, appName: manifest.name, connector })));
    const targets = manifests.flatMap((manifest) => (manifest.connectors?.targets ?? []).map((connector) => ({ appId: manifest.id, appName: manifest.name, connector })));
    return sources.flatMap((source) => targets.filter((target) => compatible(source.connector, target.connector)).map((target) => ({ source, target })));
  }

  async options(endpoint) {
    const found = ["sources", "targets"].map((direction) => findConnector(this.#host, endpoint, direction)).find(({ connector }) => connector);
    if (!found?.connector?.optionsOperationId) return { projects: [] };
    return this.#host.invoke(found.connector.optionsOperationId, {}, { actor: { type: "user", id: this.#userId() } });
  }

  async save(input) {
    const record = {
      id: input.id || id(),
      source: structuredClone(input.source),
      target: structuredClone(input.target),
      enabled: input.enabled !== false,
      version: VERSION,
      status: { state: "idle", message: "未実行", attemptedAt: null },
    };
    const source = findConnector(this.#host, record.source, "sources");
    const target = findConnector(this.#host, record.target, "targets");
    if (!source.manifest || !target.manifest) throw new AppHostError("APP_NOT_FOUND", "Connection App is not installed");
    if (!compatible(source.connector, target.connector)) throw new AppHostError("INCOMPATIBLE_CONNECTOR", "Connector data types are incompatible");
    const index = this.#records.findIndex((item) => item.id === record.id);
    if (index >= 0) this.#records[index] = { ...this.#records[index], ...record };
    else this.#records.push(record);
    await this.#persist();
    await this.#reconcile();
    return structuredClone(record);
  }

  async remove(connectionId) {
    this.#subscriptions.get(connectionId)?.();
    this.#subscriptions.delete(connectionId);
    const before = this.#records.length;
    this.#records = this.#records.filter((item) => item.id !== connectionId);
    await this.#persist();
    return this.#records.length !== before;
  }

  async setEnabled(connectionId, enabled) {
    const record = this.#records.find((item) => item.id === connectionId);
    if (!record) throw new AppHostError("CONNECTION_NOT_FOUND", "Connection was not found");
    record.enabled = Boolean(enabled);
    await this.#persist();
    await this.#reconcile();
    return structuredClone(record);
  }

  async pull(targetAppId, targetConnectorId, { correlationId } = {}) {
    const records = this.#records.filter((record) => record.enabled && record.target.appId === targetAppId && record.target.connectorId === targetConnectorId);
    const items = [];
    const failures = [];
    for (const record of records) {
      const { connector } = findConnector(this.#host, record.source, "sources");
      if (!connector || connector.mode !== "pull") {
        failures.push({ connectionId: record.id, code: "SOURCE_UNAVAILABLE" });
        continue;
      }
      try {
        const result = await this.#host.invoke(connector.operationId, { config: record.source.config ?? {} }, {
          actor: { type: "app", id: targetAppId },
          grant: connectionGrant(connector.operationId),
          confirmationLevel: this.#confirmationLevel(),
          correlationId,
          reason: `Connection ${record.id}`,
        });
        items.push(...(Array.isArray(result.items) ? result.items : [result]));
        await this.#status(record, "succeeded", `${Array.isArray(result.items) ? result.items.length : 1}件取得`);
      } catch (error) {
        failures.push({ connectionId: record.id, code: error.code ?? "FAILED", message: error.message });
        await this.#status(record, "failed", error.message);
      }
    }
    return { items, failures };
  }

  async retry(connectionId, { approval } = {}) {
    const record = this.#records.find((item) => item.id === connectionId);
    if (!record) throw new AppHostError("CONNECTION_NOT_FOUND", "Connection was not found");
    const { connector } = findConnector(this.#host, record.source, "sources");
    if (connector?.mode === "pull") return this.pull(record.target.appId, record.target.connectorId);
    if (!record.status?.lastEnvelope) throw new AppHostError("NOTHING_TO_RETRY", "Connection has no failed delivery");
    return this.#deliver(record, record.status.lastEnvelope, approval);
  }

  async #deliver(record, envelope, approval) {
    const { connector } = findConnector(this.#host, record.target, "targets");
    if (!connector || connector.mode !== "consume") throw new AppHostError("TARGET_UNAVAILABLE", "Target Connector is unavailable");
    try {
      const result = await this.#host.invoke(connector.operationId, {
        item: envelope.payload,
        config: record.target.config ?? {},
        deliveryId: `${record.id}:${envelope.id}`,
        source: { appId: envelope.sourceAppId, eventId: envelope.type },
      }, {
        actor: { type: "flow", id: record.id },
        grant: connectionGrant(connector.operationId),
        approval,
        confirmationLevel: this.#confirmationLevel(),
        reason: `Connection ${record.id}`,
        correlationId: envelope.correlationId,
      });
      await this.#status(record, "succeeded", "配送完了");
      return result;
    } catch (error) {
      const pending = ["CONFIRMATION_REQUIRED", "ALWAYS_CONFIRM_REQUIRED"].includes(error.code);
      await this.#status(record, pending ? "pending-approval" : "failed", error.message, envelope);
      throw error;
    }
  }

  async #reconcile() {
    for (const stop of this.#subscriptions.values()) stop();
    this.#subscriptions.clear();
    for (const record of this.#records) {
      if (!record.enabled) continue;
      const source = findConnector(this.#host, record.source, "sources");
      const target = findConnector(this.#host, record.target, "targets");
      if (!source.connector || !target.connector || !compatible(source.connector, target.connector)) {
        await this.#status(record, "stopped", "Appまたは互換Connectorが利用できません");
        continue;
      }
      if (source.connector.mode === "push" && target.connector.mode === "consume") {
        const stop = this.#host.subscribe(source.connector.eventId, (envelope) => this.#deliver(record, envelope), { subscriberId: record.target.appId });
        this.#subscriptions.set(record.id, stop);
      }
    }
  }

  async #status(record, state, message, lastEnvelope = undefined) {
    record.status = { ...record.status, state, message, attemptedAt: new Date().toISOString() };
    if (lastEnvelope !== undefined) record.status.lastEnvelope = lastEnvelope;
    await this.#persist();
  }

  #persist() {
    return this.#storage.writeJson(STORAGE_KEY, { version: VERSION, connections: this.#records });
  }
}
