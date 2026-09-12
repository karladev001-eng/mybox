import { APP_SCHEMA_VERSION, defineApp } from "../core/app-contract.js";
import {
  addTemplate, BUILT_IN_TEMPLATES, compilePrompt, createImageStudioState, createPendingGeneration,
  failGeneration, finishGeneration, parseTemplateMarkdown, purgeGeneration, serializeTemplateMarkdown,
  setGenerationState, setTemplateState, updateTemplate, validateImageStudioState,
} from "./domain.js";

const STATE_KEY = "state.json";
const VIEW_STATE_KEY = "view-state.json";
const objectSchema = { type: "object" };
const callers = ["user", "agent", "flow", "app"];
const op = (id, title, effect, confirmationClass, inputSchema = objectSchema, allowed = callers) => ({ id, title, effect, confirmationClass, callers: allowed, inputSchema, outputSchema: objectSchema });
const idInput = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } };
const viewStateSchema = {
  type: "object",
  required: ["generationId"],
  properties: { generationId: { type: ["string", "null"] } },
};
const generateInput = {
  type: "object", required: ["ratio"],
  properties: {
    subject: { type: "string", maxLength: 4000 }, ratio: { type: "string", enum: ["auto", "1:1", "4:5", "3:4", "3:2", "16:9", "21:9", "9:16"] },
    selections: { type: "object" }, references: { type: "array", maxItems: 4, items: { type: "object" } }, referenceInstruction: { type: "string", maxLength: 4000 }, extra: { type: "string", maxLength: 4000 },
    promptOverride: { type: "string", minLength: 1, maxLength: 16000 },
  },
};
const { references: _references, referenceInstruction: _referenceInstruction, ...generateWithoutReferenceProperties } = generateInput.properties;
const workflowGenerateConfig = { ...generateInput, properties: generateWithoutReferenceProperties, additionalProperties: false };
const workflowReferenceConfig = { ...generateInput, required: ["subject", "ratio", "references"], additionalProperties: false };
const workflowGenerateInput = (configSchema) => ({
  type: "object",
  required: ["config", "runId", "stepId", "deliveryId"],
  properties: {
    item: {},
    config: configSchema,
    trigger: { type: "object" },
    runId: { type: "string", minLength: 1 },
    stepId: { type: "string", minLength: 1 },
    deliveryId: { type: "string", minLength: 1 },
    source: { type: ["object", "null"] },
  },
});

async function readViewState(storage, profileId) {
  const stored = await storage.readJson(VIEW_STATE_KEY);
  const generationId = stored?.schemaVersion === 1 ? stored.profiles?.[profileId]?.generationId : null;
  return { generationId: typeof generationId === "string" && generationId ? generationId : null };
}
async function writeViewState(storage, profileId, viewState) {
  const stored = await storage.readJson(VIEW_STATE_KEY);
  const profiles = stored?.schemaVersion === 1 && stored.profiles && typeof stored.profiles === "object" ? stored.profiles : {};
  const next = { schemaVersion: 1, profiles: { ...profiles, [profileId]: viewState } };
  await storage.writeJson(VIEW_STATE_KEY, next);
  return viewState;
}

export function createImageStudioApp({ generator = null, recordStore = null } = {}) {
  const ownerPort = (storage) => ({
    readRaw: () => storage.readJson(STATE_KEY),
    complete: async () => {
      if ((await storage.readJson(STATE_KEY))?.recordStore !== "knowledge") await storage.writeJson(STATE_KEY, {schemaVersion: 2, recordStore: "knowledge"});
    },
    readBackup: () => storage.readJson("migration/records-backup.json"),
    writeBackup: async (raw) => { if (!await storage.readJson("migration/records-backup.json")) await storage.writeJson("migration/records-backup.json", raw); },
    readCheckpoint: () => storage.readJson("migration/records-checkpoint.json"),
    writeCheckpoint: (value) => storage.writeJson("migration/records-checkpoint.json", value),
  });
  const load = async (storage) => {
    if (recordStore) return recordStore.load(ownerPort(storage));
    const stored = await storage.readJson(STATE_KEY);
    return stored ? validateImageStudioState(stored) : createImageStudioState();
  };
  const save = async (storage, mutation) => {
    if (recordStore) return recordStore.save(mutation);
    await storage.writeJson(STATE_KEY, mutation.state); return mutation;
  };
  const performGeneration = async (input, context, { throwOnFailure = false } = {}) => {
    const state = await load(context.storage);
    const locals = state.templates.filter((item) => item.state === "active");
    const connected = await Promise.resolve().then(() => context.workflows.request("image-studio.prompt-library")).catch(() => ({ items: [] }));
    const compiled = compilePrompt({ ...input, templates: [...locals, ...connected.items] });
    const selectedIds = new Set(Object.values(input.selections ?? {}));
    const recordedInput = {...input, templateSnapshots: [...BUILT_IN_TEMPLATES, ...locals, ...connected.items].filter((t) => selectedIds.has(t.id)).map((t) => ({id:t.id, revision:t.revision ?? 0, name:t.name, prompt:t.prompt}))};
    const pending = await save(context.storage, createPendingGeneration(state, recordedInput, compiled));
    let modelStarted = false;
    try {
      if (!generator?.generate) { const error = new Error("ChatGPT画像生成はデスクトップ版で接続してください"); error.code = "PROVIDER_UNAVAILABLE"; throw error; }
      modelStarted = true;
      const result = await generator.generate({ prompt: compiled.prompt, references: pending.generation.input.references ?? [], generationId: pending.generation.id });
      const completed = await save(context.storage, finishGeneration(await load(context.storage), pending.generation.id, result));
      const item = {
        generationId: completed.generation.id, finalPrompt: completed.generation.finalPrompt, selections: input.selections ?? {}, ratio: input.ratio,
        resource: completed.generation.resource, width: completed.generation.actual.width, height: completed.generation.actual.height, createdAt: completed.generation.updatedAt,
      };
      await context.emit("image-studio.generation.completed", item);
      return { generation: completed.generation, item };
    } catch (error) {
      const failure = failGeneration(await load(context.storage), pending.generation.id, error);
      if (recordStore && modelStarted) failure.generation.state = "unknown";
      const failed = await save(context.storage, failure);
      if (throwOnFailure) {
        const workflowError = new Error(failed.generation.error.message);
        workflowError.code = failed.generation.error.code;
        workflowError.generationId = failed.generation.id;
        throw workflowError;
      }
      return { generation: failed.generation };
    }
  };

  const definition = {
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION, id: "image-studio", name: "Image", version: "0.6.1", hostCapabilities: ["app-storage", "workflows", "connections", "resources", "codex-image-generation"],
      operations: [
        op("image-studio.template.list", "Prompt templateを一覧", "read", "review"), op("image-studio.template.read", "Prompt templateを読む", "read", "review", idInput),
        op("image-studio.template.create", "Prompt templateを作成", "write", "recoverable", { type: "object", required: ["markdown"], properties: { markdown: { type: "string", minLength: 1, maxLength: 262144 } } }),
        op("image-studio.template.update", "Prompt templateを更新", "write", "recoverable", { type: "object", required: ["id", "markdown"], properties: { id: { type: "string" }, markdown: { type: "string", minLength: 1, maxLength: 262144 } } }),
        op("image-studio.template.trash", "Prompt templateをTrashへ移動", "write", "recoverable", idInput), op("image-studio.template.restore", "Prompt templateを復元", "write", "recoverable", idInput),
        op("image-studio.generation.list", "画像生成履歴を一覧", "read", "review", { type: "object", properties: { includeTrash: { type: "boolean" } } }), op("image-studio.generation.read", "画像生成を読む", "read", "review", idInput),
        op("image-studio.view-state.read", "最後に表示した画像を読む", "read", "review", objectSchema, ["user"]),
        op("image-studio.view-state.update", "最後に表示した画像を記録", "write", "autonomous", viewStateSchema, ["user"]),
        op("image-studio.generation.create", "画像を生成", "external", "autonomous", generateInput), op("image-studio.generation.create-from-reference", "参照画像からアレンジ", "external", "always-confirm", { ...generateInput, required: ["subject", "ratio", "references"] }),
        op("image-studio.workflow.generate", "Workflowで画像を生成", "external", "autonomous", workflowGenerateInput(workflowGenerateConfig), ["flow"]),
        op("image-studio.workflow.generate-from-reference", "Workflowで参照画像をアレンジ", "external", "always-confirm", workflowGenerateInput(workflowReferenceConfig), ["flow"]),
        op("image-studio.generation.trash", "画像生成をTrashへ移動", "write", "recoverable", idInput), op("image-studio.generation.restore", "画像生成を復元", "write", "recoverable", idInput), op("image-studio.generation.purge", "画像生成を完全削除", "destructive", "always-confirm", idInput, ["user"]),
      ],
      events: [{ id: "image-studio.generation.completed", title: "画像生成が完了", payloadSchema: objectSchema }],
      connectors: {
        sources: [{ id: "image-studio.generated-images", title: "生成完了", mode: "push", dataType: "mybox.generated-image.v1", eventId: "image-studio.generation.completed", configSchema: objectSchema }],
        targets: [{ id: "image-studio.prompt-library", title: "Prompt template library", mode: "pull", dataType: "mybox.prompt-fragment.v1", configSchema: objectSchema }],
      },
      workflowActions: [
        {
          id: "image-studio.workflow.generate-action",
          title: "画像を生成",
          operationId: "image-studio.workflow.generate",
          inputDataType: null,
          outputDataType: "mybox.generated-image.v1",
          configSchema: workflowGenerateConfig,
        },
        {
          id: "image-studio.workflow.generate-from-reference-action",
          title: "参照画像をアレンジ",
          operationId: "image-studio.workflow.generate-from-reference",
          inputDataType: null,
          outputDataType: "mybox.generated-image.v1",
          configSchema: workflowReferenceConfig,
        },
      ],
    },
    handlers: {
      async "image-studio.template.list"(_, { storage, workflows }) { const state = await load(storage); const connected = await Promise.resolve().then(() => workflows.request("image-studio.prompt-library")).catch(() => ({ items: [], failures: [] })); return { templates: [...BUILT_IN_TEMPLATES, ...state.templates, ...connected.items], failures: connected.failures }; },
      async "image-studio.template.read"({ id }, { storage }) { const state = await load(storage); const template = [...BUILT_IN_TEMPLATES, ...state.templates].find((item) => item.id === id); if (!template) throw new Error("Template was not found"); const markdown = template.source === "local" && !recordStore ? await storage.readText(`templates/${id}.md`) : serializeTemplateMarkdown(template); return { template, markdown }; },
      async "image-studio.template.create"({ markdown }, { storage }) { const parsed = parseTemplateMarkdown(markdown); const mutation = await save(storage, addTemplate(await load(storage), parsed)); if (!recordStore) await storage.writeText(`templates/${mutation.template.id}.md`, markdown); return { template: mutation.template }; },
      async "image-studio.template.update"({ id, markdown }, { storage }) { const parsed = parseTemplateMarkdown(markdown); const mutation = await save(storage, updateTemplate(await load(storage), id, parsed)); if (!recordStore) await storage.writeText(`templates/${id}.md`, markdown); return { template: mutation.template }; },
      async "image-studio.template.trash"({ id }, { storage }) { const mutation = await save(storage, setTemplateState(await load(storage), id, "trash")); return { template: mutation.template }; },
      async "image-studio.template.restore"({ id }, { storage }) { const mutation = await save(storage, setTemplateState(await load(storage), id, "active")); return { template: mutation.template }; },
      async "image-studio.generation.list"({ includeTrash = false }, { storage }) { const state = await load(storage); return { generations: state.generations.filter((item) => includeTrash || item.state !== "trash") }; },
      async "image-studio.generation.read"({ id }, { storage }) { const generation = (await load(storage)).generations.find((item) => item.id === id); if (!generation) throw new Error("Generation was not found"); return { generation }; },
      async "image-studio.view-state.read"(_, { actor, storage }) { return readViewState(storage, actor.id); },
      async "image-studio.view-state.update"(input, { actor, storage }) { return writeViewState(storage, actor.id, input); },
      "image-studio.generation.create": performGeneration,
      "image-studio.generation.create-from-reference": performGeneration,
      async "image-studio.workflow.generate"({ config }, context) {
        const result = await performGeneration(config, context, { throwOnFailure: true });
        return { item: result.item };
      },
      async "image-studio.workflow.generate-from-reference"({ config }, context) {
        const result = await performGeneration(config, context, { throwOnFailure: true });
        return { item: result.item };
      },
      async "image-studio.generation.trash"({ id }, { storage }) { const mutation = await save(storage, setGenerationState(await load(storage), id, "trash")); return { generation: mutation.generation }; },
      async "image-studio.generation.restore"({ id }, { storage }) { const mutation = await save(storage, setGenerationState(await load(storage), id, "complete")); return { generation: mutation.generation }; },
      async "image-studio.generation.purge"({ id }, { storage }) {
        const state = await load(storage);
        const generation = state.generations.find((item) => item.id === id);
        if (!recordStore && generation?.resource?.resourceId && generator?.purge) await generator.purge(generation.resource.resourceId);
        const mutation = await save(storage, purgeGeneration(state, id));
        return { id: mutation.id };
      },
    },
  };
  if (recordStore?.assertActor) {
    for (const [id, handler] of Object.entries(definition.handlers)) {
      definition.handlers[id] = (input, context) => {
        recordStore.assertActor(context.actor);
        return handler(input, context);
      };
    }
  }
  return defineApp(definition);
}
