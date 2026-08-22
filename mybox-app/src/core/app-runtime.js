import { registerAgentHost } from "./agent-host-registry.js";
import { AppHost } from "./app-host.js";
import { ConnectionManager } from "./connections.js";
import { ResourceBroker } from "./resource-broker.js";
import { createAppStorage, MemoryStorageDriver } from "./storage.js";
import { TauriStorageDriver } from "../desktop/tauri-storage.js";
import { deleteImageStudioResource, readImageStudioResource, storeImageStudioReferenceBase64, generateImageStudio } from "../desktop/image-studio.js";
import { readKnowledgeImage, storeKnowledgeImageBytes } from "../desktop/knowledge-images.js";
import { createKnowledgeApp } from "../knowledge/app.js";
import { createImageStudioApp } from "../image-studio/app.js";

const HOST_APP_ID = "mybox-host";
const webDriver = new MemoryStorageDriver();

function payload(dataUri) { return String(dataUri).replace(/^data:image\/(?:png|jpeg|webp);base64,/, ""); }

export function createSharedAppRuntime({ desktop = false, getConfirmationLevel = () => "review", getUserId = () => "local-user" } = {}) {
  const storageDriver = desktop ? new TauriStorageDriver() : webDriver;
  const resources = new ResourceBroker();
  let connections;
  const host = new AppHost({
    storageDriver,
    resources,
    connections: { pull: (...args) => connections.pull(...args) },
  });
  connections = new ConnectionManager({
    host,
    storage: createAppStorage(HOST_APP_ID, storageDriver),
    confirmationLevel: getConfirmationLevel,
    userId: getUserId,
  });
  const sharedSessions = new Map();
  const definitions = new Map([
    ["knowledge", () => createKnowledgeApp({ sharedSessions: { get: (projectId) => sharedSessions.get(projectId) ?? null } })],
    ["image-studio", () => createImageStudioApp({ generator: { generate: generateImageStudio, purge: deleteImageStudioResource } })],
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
    const wanted = new Set(appIds);
    for (const manifest of host.listApps()) if (!wanted.has(manifest.id)) host.unregister(manifest.id);
    for (const appId of wanted) {
      const create = definitions.get(appId);
      if (create && !host.getManifest(appId)) host.register(create());
    }
    for (const appId of wanted) if (host.getManifest(appId)) registerAgentHost(appId, host);
  }

  syncInstalled(["knowledge", "image-studio"]);

  return Object.freeze({
    host, connections, sharedSessions, syncInstalled,
    start: () => connections.load(),
  });
}
