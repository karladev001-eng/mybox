import Ajv from "ajv";
import { AppHostError } from "./app-host.js";
import {
  applyWorkflowInputMappings,
  applyWorkflowOutputMappings,
  beginWorkflowDocumentRun,
  createWorkflowDocument,
  finishWorkflowDocumentRun,
  parseWorkflowJsonPath,
  prepareWorkflowDocumentForStorage,
  recordWorkflowDocumentStep,
} from "./workflow-json.js";

const DEFINITIONS_KEY = "workflows.json";
const RUNS_KEY = "workflow-runs.json";
const LEGACY_KEY = "connections.json";
const VERSION = 1;
const RUN_LIMIT = 200;
const RETRY_DELAYS = [5_000, 30_000, 300_000];
const TRANSIENT_ERRORS = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "PROVIDER_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
  "TEMPORARILY_UNAVAILABLE",
]);
const APPROVAL_ERRORS = new Set(["CONFIRMATION_REQUIRED", "ALWAYS_CONFIRM_REQUIRED"]);

function uid(prefix) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone(value) {
  return structuredClone(value);
}

function nowIso(clock) {
  return clock().toISOString();
}

function connector(host, endpoint, direction) {
  const manifest = host.getManifest(endpoint?.appId);
  const value = manifest?.connectors?.[direction]?.find((item) => item.id === endpoint?.connectorId) ?? null;
  return { manifest, connector: value };
}

function actionCatalog(host) {
  return host.listApps().flatMap((manifest) => {
    const declared = (manifest.workflowActions ?? []).map((action) => {
      const operation = manifest.operations.find((candidate) => candidate.id === action.operationId);
      return {
        ...action,
        appId: manifest.id,
        appName: manifest.name,
        inputSchema: operation?.inputSchema,
        outputSchema: operation?.outputSchema,
        source: "action",
      };
    });
    const declaredConnectors = new Set(declared.map((action) => action.connectorId).filter(Boolean));
    const representedOperations = new Set(declared.map((action) => action.operationId));
    const consumed = (manifest.connectors?.targets ?? [])
      .filter((target) => target.mode === "consume" && !declaredConnectors.has(target.id))
      .map((target) => ({
        id: target.id,
        title: target.title,
        appId: manifest.id,
        appName: manifest.name,
        operationId: target.operationId,
        inputDataType: target.dataType,
        outputDataType: null,
        configSchema: target.configSchema ?? { type: "object" },
        inputSchema: manifest.operations.find((operation) => operation.id === target.operationId)?.inputSchema,
        outputSchema: manifest.operations.find((operation) => operation.id === target.operationId)?.outputSchema,
        optionsOperationId: target.optionsOperationId,
        connectorId: target.id,
        source: "connector",
      }));
    consumed.forEach((action) => representedOperations.add(action.operationId));
    const commands = manifest.operations
      .filter((operation) => operation.callers.includes("agent") && operation.callers.includes("flow"))
      .filter((operation) => operation.effect !== "destructive" && !representedOperations.has(operation.id))
      .map((operation) => ({
        id: `${operation.id}.command`,
        title: operation.title,
        appId: manifest.id,
        appName: manifest.name,
        operationId: operation.id,
        inputDataType: null,
        outputDataType: null,
        configSchema: operation.inputSchema,
        inputSchema: operation.inputSchema,
        outputSchema: operation.outputSchema,
        source: "agent-command",
        passthrough: true,
        effect: operation.effect,
        confirmationClass: operation.confirmationClass,
      }));
    return [...declared, ...consumed, ...commands];
  });
}

export function workflowActionAccepts(action, inputDataType) {
  return Boolean(action?.passthrough) || (action?.inputDataType ?? null) === inputDataType;
}

export function workflowActionOutputType(action, inputDataType) {
  return action?.passthrough ? inputDataType : action?.outputDataType ?? null;
}

function commandResultSummary(result) {
  if (result === null || result === undefined) return "結果なし";
  if (Array.isArray(result)) return `${result.length}件`;
  if (typeof result !== "object") return "完了";
  const arrays = Object.values(result).filter(Array.isArray);
  if (arrays.length === 1) return `${arrays[0].length}件`;
  return `${Object.keys(result).length}項目`;
}

function eventCatalog(host) {
  return host.listApps().flatMap((manifest) => (manifest.connectors?.sources ?? [])
    .filter((source) => source.mode === "push")
    .map((source) => ({ ...source, appId: manifest.id, appName: manifest.name })));
}

function requestCatalog(host) {
  const manifests = host.listApps();
  const sources = manifests.flatMap((manifest) => (manifest.connectors?.sources ?? [])
    .filter((source) => source.mode === "pull")
    .map((source) => ({ ...source, appId: manifest.id, appName: manifest.name })));
  const targets = manifests.flatMap((manifest) => (manifest.connectors?.targets ?? [])
    .filter((target) => target.mode === "pull")
    .map((target) => ({ ...target, appId: manifest.id, appName: manifest.name })));
  return sources.flatMap((source) => targets
    .filter((target) => target.dataType === source.dataType)
    .map((target) => ({ source, target })));
}

function scheduleParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), weekday };
}

function shiftDateKey(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function latestScheduleOccurrence(schedule, at = new Date()) {
  const timeZone = schedule.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = scheduleParts(at, timeZone);
  const minute = Number(schedule.minute ?? 0);
  if (schedule.frequency === "hourly") {
    if (parts.minute >= minute) return `${shiftDateKey(parts, 0)}T${String(parts.hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const previous = scheduleParts(new Date(at.getTime() - 60 * 60 * 1000), timeZone);
    return `${shiftDateKey(previous, 0)}T${String(previous.hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const hour = Number(schedule.hour ?? 0);
  const passed = parts.hour > hour || (parts.hour === hour && parts.minute >= minute);
  if (schedule.frequency === "daily") {
    const date = shiftDateKey(parts, passed ? 0 : -1);
    return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const weekday = Number(schedule.weekday ?? 1);
  let offset = -((parts.weekday - weekday + 7) % 7);
  if (offset === 0 && !passed) offset = -7;
  const date = shiftDateKey(parts, offset);
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function statusMessage(state) {
  return {
    idle: "未実行",
    queued: "実行待ち",
    running: "実行中",
    retrying: "再試行待ち",
    "pending-approval": "承認待ち",
    failed: "停止中",
    succeeded: "完了",
    stopped: "停止中",
  }[state] ?? state;
}

export class WorkflowManager {
  #host;
  #storage;
  #definitions = [];
  #runs = [];
  #subscriptions = new Map();
  #listeners = new Set();
  #active = new Map();
  #epoch = 0;
  #retryTimers = new Map();
  #scheduleTimer = null;
  #approvals = new Map();
  #confirmationLevel;
  #userId;
  #clock;
  #notify;
  #retryDelays;
  #setTimeout;
  #clearTimeout;
  #ajv;

  constructor({
    host,
    storage,
    confirmationLevel = () => "review",
    userId = () => "local-user",
    clock = () => new Date(),
    notify = async () => {},
    retryDelays = RETRY_DELAYS,
    setTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeoutFn = (timer) => globalThis.clearTimeout(timer),
  }) {
    this.#host = host;
    this.#storage = storage;
    this.#confirmationLevel = confirmationLevel;
    this.#userId = userId;
    this.#clock = clock;
    this.#notify = notify;
    this.#retryDelays = retryDelays;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
    this.#ajv = new Ajv({ allErrors: true, strict: false });
    this.#ajv.addFormat("mybox-project", true);
    this.#ajv.addFormat("mybox-tag", true);
  }

  async load() {
    this.stop();
    const stored = await this.#storage.readJson(DEFINITIONS_KEY);
    const runStore = await this.#storage.readJson(RUNS_KEY);
    this.#definitions = Array.isArray(stored?.workflows) ? stored.workflows : [];
    this.#runs = Array.isArray(runStore?.runs) ? runStore.runs : [];
    const actions = actionCatalog(this.#host);
    let recoveredRun = false;
    this.#runs.forEach((run) => {
      if (run.state === "running") {
        const step = (run.steps ?? [])[run.currentStepIndex];
        const action = actions.find((candidate) => candidate.appId === step?.appId && candidate.id === step?.actionId);
        if (action?.source === "agent-command" && action.effect !== "read") {
          const message = "終了前の実行結果を確認してから再開してください";
          run.state = "failed";
          run.error = { code: "COMMAND_OUTCOME_UNKNOWN", message, stepId: step?.id };
          const stepRun = run.stepRuns?.[run.currentStepIndex];
          if (stepRun) {
            stepRun.state = "failed";
            stepRun.error = { code: "COMMAND_OUTCOME_UNKNOWN", message };
          }
        } else {
          run.state = "queued";
        }
        recoveredRun = true;
      }
      if (run.state === "retrying" && (!run.nextAttemptAt || new Date(run.nextAttemptAt) <= this.#clock())) run.state = "queued";
    });
    if (recoveredRun) await this.#persistRuns();
    await this.#migrateConnections(stored?.migratedConnectionIds ?? []);
    await this.#reconcile();
    await this.tickSchedules();
    for (const definition of this.#definitions) this.#drain(definition.id);
    this.#armScheduleTick();
    return this.list();
  }

  stop() {
    this.#epoch += 1;
    this.#active.clear();
    for (const stop of this.#subscriptions.values()) stop();
    this.#subscriptions.clear();
    for (const timer of this.#retryTimers.values()) this.#clearTimeout?.(timer);
    this.#retryTimers.clear();
    if (this.#scheduleTimer) this.#clearTimeout?.(this.#scheduleTimer);
    this.#scheduleTimer = null;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  list() { return clone(this.#definitions); }
  listRuns({ workflowId } = {}) {
    return clone(this.#runs.filter((run) => !workflowId || run.workflowId === workflowId));
  }
  hasEnabledSchedules() { return this.#definitions.some((item) => item.enabled && item.trigger.kind === "schedule"); }
  get(workflowId) { return clone(this.#definitions.find((item) => item.id === workflowId) ?? null); }
  listEventTriggers() { return clone(eventCatalog(this.#host)); }
  listRequestPairs() { return clone(requestCatalog(this.#host)); }
  listActions({ inputDataType } = {}) {
    return clone(actionCatalog(this.#host).filter((action) => inputDataType === undefined
      || workflowActionAccepts(action, inputDataType)));
  }

  async options({ appId, actionId, connectorId, direction }) {
    let operationId = null;
    if (actionId) operationId = actionCatalog(this.#host).find((item) => item.appId === appId && item.id === actionId)?.optionsOperationId;
    if (connectorId) operationId = connector(this.#host, { appId, connectorId }, direction ?? "sources").connector?.optionsOperationId;
    if (!operationId) return { projects: [] };
    return this.#host.invoke(operationId, {}, { actor: { type: "user", id: this.#userId() } });
  }

  async save(input) {
    const existing = input.id ? this.#definitions.find((item) => item.id === input.id) : null;
    const at = nowIso(this.#clock);
    const definition = {
      id: input.id || uid("workflow"),
      name: String(input.name || "新しいワークフロー").trim(),
      enabled: input.enabled !== false,
      version: VERSION,
      trigger: clone(input.trigger),
      steps: clone(input.steps ?? []),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      status: existing?.status ?? { state: "idle", message: "未実行", updatedAt: null },
    };
    this.#validate(definition);
    if (definition.trigger.kind === "schedule" && !definition.trigger.lastOccurrenceKey) {
      definition.trigger.lastOccurrenceKey = latestScheduleOccurrence(definition.trigger.schedule, this.#clock());
    }
    const index = this.#definitions.findIndex((item) => item.id === definition.id);
    if (index >= 0) this.#definitions[index] = definition;
    else this.#definitions.unshift(definition);
    await this.#persistDefinitions();
    if (input.documentData !== undefined) await this.writeDocumentData(definition.id, input.documentData);
    else if (!existing) await this.#storeDocument(createWorkflowDocument(definition.id, at));
    await this.#reconcile();
    if (definition.enabled) this.#drain(definition.id);
    this.#emitChange();
    return clone(definition);
  }

  async remove(workflowId) {
    this.#subscriptions.get(workflowId)?.();
    this.#subscriptions.delete(workflowId);
    const before = this.#definitions.length;
    this.#definitions = this.#definitions.filter((item) => item.id !== workflowId);
    this.#runs = this.#runs.filter((item) => item.workflowId !== workflowId);
    await Promise.all([this.#persistDefinitions(), this.#persistRuns(), this.#storage.delete(this.#documentKey(workflowId))]);
    this.#emitChange();
    return this.#definitions.length !== before;
  }

  async setEnabled(workflowId, enabled) {
    const definition = this.#definition(workflowId);
    definition.enabled = Boolean(enabled);
    definition.updatedAt = nowIso(this.#clock);
    if (definition.enabled && definition.trigger.kind === "schedule") {
      definition.trigger.lastOccurrenceKey = latestScheduleOccurrence(definition.trigger.schedule, this.#clock());
    }
    await this.#persistDefinitions();
    await this.#reconcile();
    if (definition.enabled) this.#drain(definition.id);
    this.#emitChange();
    return clone(definition);
  }

  async run(workflowId) {
    const definition = this.#definition(workflowId);
    if (!["manual", "schedule"].includes(definition.trigger.kind)) throw new AppHostError("WORKFLOW_TRIGGER_ONLY", "このワークフローはTriggerから実行します");
    const run = await this.#enqueue(definition, { kind: "manual", occurredAt: nowIso(this.#clock), payload: null });
    this.#drain(workflowId);
    return clone(run);
  }

  async resume(runId, { approval } = {}) {
    const run = this.#runs.find((item) => item.id === runId);
    if (!run) throw new AppHostError("WORKFLOW_RUN_NOT_FOUND", "Workflow Run was not found");
    if (!["failed", "pending-approval", "retrying"].includes(run.state)) throw new AppHostError("WORKFLOW_RUN_NOT_PAUSED", "Workflow Run is not paused");
    if (approval?.granted) this.#approvals.set(run.id, approval);
    run.state = "queued";
    run.error = null;
    run.nextAttemptAt = null;
    await this.#persistRuns();
    this.#drain(run.workflowId);
    this.#emitChange();
    return clone(run);
  }

  async request(targetAppId, targetConnectorId, { correlationId } = {}) {
    const definitions = this.#definitions.filter((definition) => definition.enabled
      && definition.trigger.kind === "app-request"
      && definition.trigger.target.appId === targetAppId
      && definition.trigger.target.connectorId === targetConnectorId);
    const items = [];
    const failures = [];
    for (const definition of definitions) {
      const run = await this.#createRun(definition, { kind: "app-request", occurredAt: nowIso(this.#clock), payload: null });
      let document = beginWorkflowDocumentRun(await this.#loadDocument(definition.id), run, nowIso(this.#clock));
      document = await this.#storeDocument(document, run.id);
      const source = connector(this.#host, definition.trigger.source, "sources").connector;
      if (!source || source.mode !== "pull") {
        const sourceError = new AppHostError("SOURCE_UNAVAILABLE", "Source Connector is unavailable");
        document = finishWorkflowDocumentRun(document, run.id, "failed", nowIso(this.#clock), { code: sourceError.code, message: sourceError.message });
        await this.#storeDocument(document, run.id);
        await this.#failRun(definition, run, sourceError);
        failures.push({ workflowId: definition.id, code: "SOURCE_UNAVAILABLE" });
        continue;
      }
      try {
        run.state = "running";
        run.startedAt = run.startedAt ?? nowIso(this.#clock);
        await this.#persistRuns();
        const sourceInput = { config: definition.trigger.source.config ?? {} };
        document = recordWorkflowDocumentStep(document, run.id, "app-request-source", { state: "running", attempts: 1, startedAt: run.startedAt, input: sourceInput }, nowIso(this.#clock));
        document = await this.#storeDocument(document, run.id);
        const result = await this.#host.invoke(source.operationId, sourceInput, {
          actor: { type: "app", id: targetAppId },
          grant: { operationIds: [source.operationId] },
          confirmationLevel: this.#confirmationLevel(),
          correlationId,
          reason: `Workflow ${definition.id}`,
        });
        const completedAt = nowIso(this.#clock);
        document = recordWorkflowDocumentStep(document, run.id, "app-request-source", { state: "succeeded", completedAt, output: result }, completedAt);
        document = finishWorkflowDocumentRun(document, run.id, "succeeded", completedAt);
        await this.#storeDocument(document, run.id);
        items.push(...(Array.isArray(result.items) ? result.items : [result]));
        await this.#completeRun(definition, run, `${Array.isArray(result.items) ? result.items.length : 1}件取得`);
      } catch (error) {
        const at = nowIso(this.#clock);
        document = recordWorkflowDocumentStep(document, run.id, "app-request-source", { state: "failed", completedAt: at, error: { code: error.code ?? "FAILED", message: error.message } }, at);
        document = finishWorkflowDocumentRun(document, run.id, "failed", at, { code: error.code ?? "FAILED", message: error.message });
        await this.#storeDocument(document, run.id);
        failures.push({ workflowId: definition.id, code: error.code ?? "FAILED", message: error.message });
        await this.#failRun(definition, run, error);
      }
    }
    return { items, failures };
  }

  pull(targetAppId, targetConnectorId, options) { return this.request(targetAppId, targetConnectorId, options); }

  async readDocument(workflowId) {
    this.#definition(workflowId);
    return clone(await this.#loadDocument(workflowId));
  }

  async writeDocumentData(workflowId, data) {
    this.#definition(workflowId);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new AppHostError("INVALID_WORKFLOW_DOCUMENT_DATA", "Workflow JSONのdataはオブジェクトにしてください");
    }
    const document = await this.#loadDocument(workflowId);
    document.data = clone(data);
    document.updatedAt = nowIso(this.#clock);
    return clone(await this.#storeDocument(document));
  }

  async retry(workflowId, { approval } = {}) {
    const run = this.#runs.find((item) => item.workflowId === workflowId && ["failed", "pending-approval", "retrying"].includes(item.state));
    if (!run) throw new AppHostError("NOTHING_TO_RETRY", "Workflow has no paused Run");
    return this.resume(run.id, { approval });
  }

  async tickSchedules(at = this.#clock()) {
    for (const definition of this.#definitions) {
      if (!definition.enabled || definition.trigger.kind !== "schedule") continue;
      const occurrence = latestScheduleOccurrence(definition.trigger.schedule, at);
      if (definition.trigger.lastOccurrenceKey === occurrence) continue;
      definition.trigger.lastOccurrenceKey = occurrence;
      await this.#enqueue(definition, { kind: "schedule", occurredAt: at.toISOString(), scheduledFor: occurrence, payload: null });
      this.#drain(definition.id);
    }
    await this.#persistDefinitions();
  }

  #definition(workflowId) {
    const definition = this.#definitions.find((item) => item.id === workflowId);
    if (!definition) throw new AppHostError("WORKFLOW_NOT_FOUND", "Workflow was not found");
    return definition;
  }

  #validate(definition) {
    if (!definition.name) throw new AppHostError("INVALID_WORKFLOW", "Workflow名が必要です");
    const kind = definition.trigger?.kind;
    if (!["event", "manual", "schedule", "app-request"].includes(kind)) throw new AppHostError("INVALID_WORKFLOW", "Triggerが不正です");
    let dataType = null;
    if (kind === "event") {
      const source = connector(this.#host, { appId: definition.trigger.appId, connectorId: definition.trigger.connectorId }, "sources").connector;
      if (!source || source.mode !== "push") throw new AppHostError("SOURCE_UNAVAILABLE", "Event Connectorが利用できません");
      dataType = source.dataType;
    }
    if (kind === "app-request") {
      const source = connector(this.#host, definition.trigger.source, "sources").connector;
      const target = connector(this.#host, definition.trigger.target, "targets").connector;
      if (!source || source.mode !== "pull" || !target || target.mode !== "pull" || source.dataType !== target.dataType) {
        throw new AppHostError("INCOMPATIBLE_CONNECTOR", "App要求Connectorが互換ではありません");
      }
      if (definition.steps.length) throw new AppHostError("INVALID_WORKFLOW", "App要求WorkflowにStepは追加できません");
      return;
    }
    if (kind === "schedule") {
      const schedule = definition.trigger.schedule;
      if (!schedule || !["hourly", "daily", "weekly"].includes(schedule.frequency)) throw new AppHostError("INVALID_SCHEDULE", "スケジュールが不正です");
      scheduleParts(this.#clock(), schedule.timeZone);
    }
    if (!definition.steps.length) throw new AppHostError("INVALID_WORKFLOW", "Actionを1つ以上追加してください");
    const actions = actionCatalog(this.#host);
    for (let index = 0; index < definition.steps.length; index += 1) {
      const step = definition.steps[index];
      const action = actions.find((item) => item.appId === step.appId && item.id === step.actionId);
      if (!action) throw new AppHostError("ACTION_UNAVAILABLE", "Workflow Actionが利用できません", { stepId: step.id });
      if (!workflowActionAccepts(action, dataType)) throw new AppHostError("INCOMPATIBLE_ACTION", "Actionの入出力型が一致しません", { stepId: step.id, expected: dataType, actual: action.inputDataType ?? null });
      for (const mapping of step.inputMappings ?? []) {
        parseWorkflowJsonPath(mapping.from);
        parseWorkflowJsonPath(mapping.to, { writable: true });
      }
      for (const mapping of step.outputMappings ?? []) {
        parseWorkflowJsonPath(mapping.from);
        const outputTokens = parseWorkflowJsonPath(mapping.to, { writable: true });
        if (outputTokens[0]?.type !== "property" || outputTokens[0].key !== "data") {
          throw new AppHostError("INVALID_WORKFLOW_JSON_DESTINATION", "出力先は $.data から始めてください", { stepId: step.id });
        }
      }
      const configSchema = clone(action.configSchema ?? { type: "object" });
      const mappedRequired = new Set((step.inputMappings ?? []).flatMap((mapping) => /^\$\.([^.[\]]+)$/.exec(mapping.to)?.[1] ?? []));
      if (Array.isArray(configSchema.required)) configSchema.required = configSchema.required.filter((key) => !mappedRequired.has(key));
      const validate = this.#ajv.compile(configSchema);
      const staticConfig = clone(step.config ?? {});
      mappedRequired.forEach((key) => delete staticConfig[key]);
      if (!validate(staticConfig)) throw new AppHostError("INVALID_ACTION_CONFIG", "Action設定が不正です", { stepId: step.id, errors: validate.errors });
      dataType = workflowActionOutputType(action, dataType);
      if (!dataType && index < definition.steps.length - 1 && !action.passthrough) throw new AppHostError("ACTION_HAS_NO_OUTPUT", "出力のないActionは最後に配置してください", { stepId: step.id });
    }
  }

  async #enqueue(definition, trigger) {
    const run = await this.#createRun(definition, trigger);
    definition.status = { state: "queued", message: "実行待ち", updatedAt: nowIso(this.#clock), runId: run.id };
    await this.#persistDefinitions();
    this.#emitChange();
    return run;
  }

  async #createRun(definition, trigger) {
    const at = nowIso(this.#clock);
    const run = {
      id: uid("run"), workflowId: definition.id, state: "queued", trigger: clone(trigger), currentStepIndex: 0,
      steps: clone(definition.steps),
      createdAt: at, startedAt: null, completedAt: null, updatedAt: at, attempts: 0, stepRuns: [], error: null, nextAttemptAt: null,
    };
    this.#runs.unshift(run);
    this.#trimRuns(definition.id);
    await this.#persistRuns();
    return run;
  }

  #drain(workflowId) {
    if (this.#active.has(workflowId)) return;
    const epoch = this.#epoch;
    this.#active.set(workflowId, epoch);
    queueMicrotask(async () => {
      try {
        while (epoch === this.#epoch) {
          const run = [...this.#runs].reverse().find((item) => item.workflowId === workflowId && !["succeeded", "stopped"].includes(item.state));
          if (!run || run.state !== "queued") break;
          await this.#execute(run);
        }
      } finally {
        if (this.#active.get(workflowId) === epoch) this.#active.delete(workflowId);
        this.#emitChange();
      }
    });
  }

  async #execute(run) {
    const definition = this.#definitions.find((item) => item.id === run.workflowId);
    if (!definition?.enabled) return;
    run.state = "running";
    run.startedAt = run.startedAt ?? nowIso(this.#clock);
    run.updatedAt = nowIso(this.#clock);
    definition.status = { state: "running", message: "実行中", updatedAt: run.updatedAt, runId: run.id };
    await Promise.all([this.#persistRuns(), this.#persistDefinitions()]);
    let document = beginWorkflowDocumentRun(await this.#loadDocument(definition.id), run, run.updatedAt);
    document = await this.#storeDocument(document, run.id);
    let item = run.currentStepIndex === 0 ? run.trigger.payload : run.stepRuns[run.currentStepIndex - 1]?.outputItem;
    const actions = actionCatalog(this.#host);
    const steps = run.steps ?? definition.steps;
    for (let index = run.currentStepIndex; index < steps.length; index += 1) {
      const step = steps[index];
      const action = actions.find((candidate) => candidate.appId === step.appId && candidate.id === step.actionId);
      if (!action) {
        const actionError = new AppHostError("ACTION_UNAVAILABLE", "Workflow Actionが利用できません");
        document = finishWorkflowDocumentRun(document, run.id, "failed", nowIso(this.#clock), { code: actionError.code, message: actionError.message });
        await this.#storeDocument(document, run.id);
        await this.#failRun(definition, run, actionError);
        return;
      }
      const stepRun = run.stepRuns[index] ?? {
        stepId: step.id,
        appId: action.appId,
        actionId: action.id,
        operationId: action.operationId,
        title: action.title,
        source: action.source,
        effect: action.effect ?? null,
        confirmationClass: action.confirmationClass ?? null,
        state: "running",
        attempts: 0,
        startedAt: nowIso(this.#clock),
        completedAt: null,
        error: null,
      };
      stepRun.state = "running";
      stepRun.startedAt = stepRun.startedAt ?? nowIso(this.#clock);
      stepRun.completedAt = null;
      stepRun.attempts += 1;
      run.attempts += 1;
      run.stepRuns[index] = stepRun;
      run.currentStepIndex = index;
      document = recordWorkflowDocumentStep(document, run.id, step.id, {
        state: "running",
        attempts: stepRun.attempts,
        startedAt: stepRun.startedAt,
        completedAt: null,
        error: null,
      }, nowIso(this.#clock));
      await Promise.all([this.#persistRuns(), this.#storeDocument(document, run.id)]);
      try {
        const baseInput = action.passthrough ? clone(step.config ?? {}) : {
          item,
          config: step.config ?? {},
          trigger: run.trigger,
          runId: run.id,
          stepId: step.id,
          deliveryId: `${definition.id}:${run.id}:${step.id}`,
          source: run.trigger.source ?? null,
        };
        const input = applyWorkflowInputMappings(baseInput, step.inputMappings, document);
        document = recordWorkflowDocumentStep(document, run.id, step.id, {
          input,
          state: "running",
          attempts: stepRun.attempts,
        }, nowIso(this.#clock));
        document = await this.#storeDocument(document, run.id);
        const result = await this.#host.invoke(action.operationId, input, {
          actor: { type: "flow", id: definition.id },
          grant: { operationIds: steps.map((candidate) => actions.find((entry) => entry.appId === candidate.appId && entry.id === candidate.actionId)?.operationId).filter(Boolean) },
          approval: this.#approvals.get(run.id),
          confirmationLevel: this.#confirmationLevel(),
          reason: `Workflow ${definition.name}`,
          correlationId: run.id,
        });
        this.#approvals.delete(run.id);
        if (!action.passthrough) item = result?.item;
        document = applyWorkflowOutputMappings(document, result, step.outputMappings);
        const completedAt = nowIso(this.#clock);
        document = recordWorkflowDocumentStep(document, run.id, step.id, {
          output: result,
          state: "succeeded",
          completedAt,
          error: null,
        }, completedAt);
        document = await this.#storeDocument(document, run.id);
        Object.assign(stepRun, {
          state: "succeeded",
          completedAt,
          outputItem: item,
          resultSummary: action.passthrough ? commandResultSummary(result) : null,
          error: null,
        });
        run.currentStepIndex = index + 1;
        run.updatedAt = nowIso(this.#clock);
        await this.#persistRuns();
      } catch (error) {
        this.#approvals.delete(run.id);
        stepRun.error = { code: error.code ?? "FAILED", message: error.message };
        stepRun.state = APPROVAL_ERRORS.has(error.code) ? "pending-approval" : "failed";
        document = recordWorkflowDocumentStep(document, run.id, step.id, {
          state: stepRun.state,
          completedAt: nowIso(this.#clock),
          error: stepRun.error,
        }, nowIso(this.#clock));
        document = finishWorkflowDocumentRun(document, run.id, stepRun.state, nowIso(this.#clock), stepRun.error);
        await this.#storeDocument(document, run.id);
        await this.#pauseOrRetry(definition, run, stepRun, error, {
          allowTransientRetry: action.source !== "agent-command" || action.effect === "read",
        });
        return;
      }
    }
    document = finishWorkflowDocumentRun(document, run.id, "succeeded", nowIso(this.#clock));
    await this.#storeDocument(document, run.id);
    await this.#completeRun(definition, run, "完了");
  }

  async #pauseOrRetry(definition, run, stepRun, error, { allowTransientRetry = true } = {}) {
    const at = nowIso(this.#clock);
    run.updatedAt = at;
    run.error = { code: error.code ?? "FAILED", message: error.message, stepId: stepRun.stepId };
    if (APPROVAL_ERRORS.has(error.code)) {
      run.state = "pending-approval";
      definition.status = { state: "pending-approval", message: error.message, updatedAt: at, runId: run.id };
      await this.#notify({ kind: "pending-approval", workflowId: definition.id, runId: run.id, title: definition.name, message: error.message });
    } else if (allowTransientRetry && TRANSIENT_ERRORS.has(error.code) && stepRun.attempts <= this.#retryDelays.length) {
      const delay = this.#retryDelays[stepRun.attempts - 1];
      run.state = "retrying";
      run.nextAttemptAt = new Date(this.#clock().getTime() + delay).toISOString();
      definition.status = { state: "retrying", message: `${Math.round(delay / 1000)}秒後に再試行`, updatedAt: at, runId: run.id };
      const timer = this.#setTimeout?.(() => {
        this.#retryTimers.delete(run.id);
        run.state = "queued";
        run.nextAttemptAt = null;
        this.#persistRuns().then(() => this.#drain(definition.id));
      }, delay);
      timer?.unref?.();
      if (timer) this.#retryTimers.set(run.id, timer);
    } else {
      run.state = "failed";
      definition.status = { state: "failed", message: error.message, updatedAt: at, runId: run.id };
      await this.#notify({ kind: "failed", workflowId: definition.id, runId: run.id, title: definition.name, message: error.message });
    }
    let document = await this.#loadDocument(definition.id);
    document = recordWorkflowDocumentStep(document, run.id, stepRun.stepId, {
      state: run.state,
      attempts: stepRun.attempts,
      completedAt: run.state === "retrying" ? null : nowIso(this.#clock),
      error: stepRun.error,
    }, nowIso(this.#clock));
    document = finishWorkflowDocumentRun(document, run.id, run.state, nowIso(this.#clock), run.error);
    await this.#storeDocument(document, run.id);
    await Promise.all([this.#persistRuns(), this.#persistDefinitions()]);
    this.#emitChange();
  }

  async #completeRun(definition, run, message) {
    const at = nowIso(this.#clock);
    Object.assign(run, { state: "succeeded", completedAt: at, updatedAt: at, error: null, nextAttemptAt: null });
    definition.status = { state: "succeeded", message, updatedAt: at, runId: run.id };
    await Promise.all([this.#persistRuns(), this.#persistDefinitions()]);
    this.#emitChange();
  }

  async #failRun(definition, run, error) {
    const at = nowIso(this.#clock);
    Object.assign(run, { state: "failed", completedAt: at, updatedAt: at, error: { code: error.code ?? "FAILED", message: error.message } });
    definition.status = { state: "failed", message: error.message, updatedAt: at, runId: run.id };
    await Promise.all([this.#persistRuns(), this.#persistDefinitions()]);
    this.#emitChange();
  }

  async #reconcile() {
    for (const stop of this.#subscriptions.values()) stop();
    this.#subscriptions.clear();
    for (const definition of this.#definitions) {
      if (!definition.enabled) continue;
      try {
        this.#validate(definition);
      } catch (error) {
        definition.enabled = false;
        definition.status = { state: "stopped", message: error.message, updatedAt: nowIso(this.#clock) };
        continue;
      }
      if (definition.trigger.kind === "event") {
        const source = connector(this.#host, { appId: definition.trigger.appId, connectorId: definition.trigger.connectorId }, "sources").connector;
        const stop = this.#host.subscribe(source.eventId, async (envelope) => {
          await this.#enqueue(definition, {
            kind: "event", occurredAt: envelope.occurredAt, payload: envelope.payload,
            source: { appId: envelope.sourceAppId, eventId: envelope.type, envelopeId: envelope.id },
          });
          this.#drain(definition.id);
        }, { subscriberId: `workflow:${definition.id}` });
        this.#subscriptions.set(definition.id, stop);
      }
    }
    await this.#persistDefinitions();
  }

  async #migrateConnections(previousIds) {
    const legacy = await this.#storage.readJson(LEGACY_KEY);
    const migrated = new Set(previousIds);
    for (const record of legacy?.connections ?? []) {
      if (migrated.has(record.id)) continue;
      const source = connector(this.#host, record.source, "sources");
      const target = connector(this.#host, record.target, "targets");
      if (!source.connector || !target.connector || source.connector.dataType !== target.connector.dataType) continue;
      const base = {
        id: `workflow-${record.id}`,
        name: `${source.manifest.name} → ${target.manifest.name}`,
        enabled: record.enabled !== false,
        version: VERSION,
        createdAt: record.status?.attemptedAt ?? nowIso(this.#clock),
        updatedAt: nowIso(this.#clock),
        status: record.status ?? { state: "idle", message: "未実行", updatedAt: null },
      };
      if (source.connector.mode === "push" && target.connector.mode === "consume") {
        const action = actionCatalog(this.#host).find((item) => item.appId === record.target.appId && (item.connectorId === record.target.connectorId || item.id === record.target.connectorId));
        if (!action) continue;
        const definition = { ...base, trigger: { kind: "event", appId: record.source.appId, connectorId: record.source.connectorId, config: record.source.config ?? {} }, steps: [{ id: `step-${record.id}`, appId: record.target.appId, actionId: action.id, config: record.target.config ?? {} }] };
        this.#definitions.push(definition);
        const envelope = record.status?.lastEnvelope;
        if (["failed", "pending-approval"].includes(record.status?.state) && envelope) {
          const runId = `run-connection-${record.id}-${envelope.id}`;
          if (!this.#runs.some((run) => run.id === runId)) {
            const at = envelope.occurredAt ?? base.updatedAt;
            this.#runs.unshift({
              id: runId,
              workflowId: definition.id,
              state: record.status.state,
              trigger: {
                kind: "event",
                occurredAt: at,
                payload: clone(envelope.payload),
                source: { appId: envelope.sourceAppId, eventId: envelope.type, envelopeId: envelope.id },
              },
              steps: clone(definition.steps),
              currentStepIndex: 0,
              createdAt: at,
              startedAt: null,
              completedAt: null,
              updatedAt: base.updatedAt,
              attempts: 0,
              stepRuns: [],
              error: { code: "MIGRATED_DELIVERY", message: record.status.message ?? "旧Connectionの配送を再開できます", stepId: definition.steps[0].id },
              nextAttemptAt: null,
            });
          }
        }
      } else if (source.connector.mode === "pull" && target.connector.mode === "pull") {
        this.#definitions.push({ ...base, trigger: { kind: "app-request", source: clone(record.source), target: clone(record.target) }, steps: [] });
      } else continue;
      migrated.add(record.id);
    }
    await this.#storage.writeJson(RUNS_KEY, { version: VERSION, runs: this.#runs });
    await this.#storage.writeJson(DEFINITIONS_KEY, { version: VERSION, migratedConnectionIds: [...migrated], workflows: this.#definitions });
  }

  #trimRuns(workflowId) {
    const matching = this.#runs.filter((run) => run.workflowId === workflowId);
    if (matching.length <= RUN_LIMIT) return;
    const keep = new Set(matching.slice(0, RUN_LIMIT).map((run) => run.id));
    this.#runs = this.#runs.filter((run) => run.workflowId !== workflowId || keep.has(run.id));
  }

  #documentKey(workflowId) {
    return `workflow-data/${encodeURIComponent(workflowId)}.json`;
  }

  async #loadDocument(workflowId) {
    const stored = await this.#storage.readJson(this.#documentKey(workflowId));
    if (!stored) return createWorkflowDocument(workflowId, nowIso(this.#clock));
    if (stored.version !== 1 || stored.workflowId !== workflowId || !stored.data || Array.isArray(stored.data) || typeof stored.data !== "object") {
      throw new AppHostError("INVALID_WORKFLOW_DOCUMENT", "Workflow JSONの形式が正しくありません", { workflowId });
    }
    return stored;
  }

  async #storeDocument(document, currentRunId = null) {
    const prepared = prepareWorkflowDocumentForStorage(document, currentRunId);
    await this.#storage.writeJson(this.#documentKey(prepared.workflowId), prepared);
    return prepared;
  }

  #persistDefinitions() {
    return this.#storage.readJson(DEFINITIONS_KEY).then((stored) => this.#storage.writeJson(DEFINITIONS_KEY, {
      version: VERSION,
      migratedConnectionIds: stored?.migratedConnectionIds ?? [],
      workflows: this.#definitions,
    }));
  }

  #persistRuns() { return this.#storage.writeJson(RUNS_KEY, { version: VERSION, runs: this.#runs }); }

  #emitChange() {
    const snapshot = { workflows: this.list(), runs: this.listRuns() };
    for (const listener of this.#listeners) listener(snapshot);
  }

  #armScheduleTick() {
    const timer = this.#setTimeout?.(async () => {
      await this.tickSchedules();
      this.#armScheduleTick();
    }, 30_000);
    timer?.unref?.();
    this.#scheduleTimer = timer;
  }
}

export const workflowStatusLabel = statusMessage;
