import { createKnowledgeImageStore } from "./knowledge-image-store.js";
import { createProjectFileStore } from "../desktop/knowledge-files.js";
import { registerAgentHost } from "./agent-host-registry.js";
import { AppHost } from "./app-host.js";
import { WorkflowManager } from "./workflow-manager.js";
import { ResourceBroker } from "./resource-broker.js";
import { createAppStorage, MemoryStorageDriver } from "./storage.js";
import { TauriStorageDriver } from "../desktop/tauri-storage.js";
import { deleteImageStudioResource, readImageStudioResource, storeImageStudioReferenceBase64, generateImageStudio } from "../desktop/image-studio.js";
import { readKnowledgeImage, storeKnowledgeImageBytes } from "../desktop/knowledge-images.js";
import { notifyWorkflow } from "../desktop/workflow-background.js";
import { createKnowledgeApp } from "../knowledge/app.js";
import { createKnowledgeClient } from "../knowledge/client.js";
import { createImageStudioApp } from "../image-studio/app.js";

const HOST_APP_ID = "mybox-host";
const webDriver = new MemoryStorageDriver();

function payload(dataUri) { return String(dataUri).replace(/^data:image\/(?:png|jpeg|webp);base64,/, ""); }

export function createSharedAppRuntime({ desktop = false, enableWorkflows = true, getConfirmationLevel = () => "review", getUserId = () => "local-user" } = {}) {
  const storageDriver = desktop ? new TauriStorageDriver() : webDriver;
  const resources = new ResourceBroker();
  let workflows, imageRecords, recordProjectResolver;
  const requestWorkflow = async (...args) => { if (!enableWorkflows) throw new Error("Workflow is retired in this workspace"); return workflows.request(...args); };
  const host = new AppHost({
    requiredAppIds: ["knowledge"],
    storageDriver,
    resources,
    workflows: { request: (...args) => requestWorkflow(...args) },
    connections: { pull: (...args) => requestWorkflow(...args) },
  });
  workflows = new WorkflowManager({
    host,
    storage: createAppStorage(HOST_APP_ID, storageDriver),
    confirmationLevel: getConfirmationLevel,
    userId: getUserId,
    notify: async (notice) => {
      if (!desktop) return;
      await notifyWorkflow(notice);
    },
  });
  const sharedSessions = new Map();
  const sharedSessionPreparations = new Map();
  const definitions = new Map([
    ["knowledge", () => createKnowledgeApp({ fileStore: desktop ? createProjectFileStore() : null, sharedSessions: { get: (projectId) => sharedSessions.get(projectId) ?? null } })],
    ["image-studio", () => createImageStudioApp({
      recordStore: {assertActor: (actor) => {
        const profileId = actor.type === "user" ? actor.id : actor.profileId;
        if (profileId && profileId !== getUserId()) throw new Error("現在のProfileで操作してください");
      }, load: (...args) => imageRecords.load(...args), save: (...args) => imageRecords.save(...args)},
      generator: {generate: async (input) => generateImageStudio({...input, references: await imageRecords.prepareReferences(input.references)}), purge: deleteImageStudioResource},
    })],
  ]);

  resources.register("image-studio", {
    read: async (reference) => payload(await readImageStudioResource(reference.resourceId)),
    importResource: async (base64) => storeImageStudioReferenceBase64(base64),
  });
  resources.register("knowledge", {
    read: async (reference) => payload(await readKnowledgeImage(reference.resourceId)),
    importResource: async (base64, { reference }) => {
      const resourceId = await storeKnowledgeImageBytes(base64);
      return { appId: "knowledge", resourceId, mediaType: reference.mediaType, revision: 1, name: reference.name };
    },
  });

  function syncInstalled(appIds) {
    const wanted = new Set(["knowledge", ...appIds]);
    for (const manifest of host.listApps()) if (!wanted.has(manifest.id)) host.unregister(manifest.id);
    for (const appId of wanted) {
      const create = definitions.get(appId);
      if (create && !host.getManifest(appId)) host.register(create());
    }
    for (const appId of wanted) if (host.getManifest(appId)) registerAgentHost(appId, host);
  }

  syncInstalled(["knowledge", "image-studio"]);

  let prepareKnowledgeProject = async () => null;
  const runtime = {
    host,
    workflows,
    connections: workflows,
    sharedSessions,
    sharedSessionPreparations,
    setRecordProjectResolver: (resolve) => { recordProjectResolver = resolve; },
    readImageRecordResource: (id) => imageRecords.readResource(id),
    prepareKnowledgeProject: (projectId) => prepareKnowledgeProject(projectId),
    syncInstalled,
    start: () => enableWorkflows ? workflows.load() : Promise.resolve(),
    stop: () => workflows.stop(),
  };
  const knowledgeClient = createKnowledgeClient({ desktop, appRuntime: runtime, getProfileId: getUserId });
  const hostStorage = createAppStorage(HOST_APP_ID, storageDriver);
  imageRecords = createKnowledgeImageStore({client: knowledgeClient, desktop, readLegacyImage: readImageStudioResource,
    materializeImage: storeImageStudioReferenceBase64,
    getDefaultProject: async () => {
      if (recordProjectResolver) return recordProjectResolver();
      // Standalone runtimes also retain a stable destination; the desktop Host supplies Record's resolver.
      const stored = await hostStorage.readJson("image-record-project.json");
      const {projects} = await knowledgeClient.listProjects();
      const servers = desktop ? await knowledgeClient.listSyncEndpoints() : [];
      if (projects.some((p) => p.id === stored?.projectId && p.role === "owner") && !servers.some((s) => s.projectId === stored.projectId)) return stored.projectId;
      const {project} = await knowledgeClient.createProject("My Records");
      await hostStorage.writeJson("image-record-project.json", {projectId: project.id});
      return project.id;
    },
  });
  if (desktop) {
    prepareKnowledgeProject = (projectId) => knowledgeClient.prepareProjectSession(projectId);
  }

  return Object.freeze(runtime);
}
