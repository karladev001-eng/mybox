import { AppHost } from "../core/app-host.js";
import { registerAgentHost } from "../core/agent-host-registry.js";
import { MemoryStorageDriver } from "../core/storage.js";
import { TauriStorageDriver } from "../desktop/tauri-storage.js";
import { generateImageStudio, readImageStudioResource, pickImageStudioReference, storeImageStudioReferenceBytes } from "../desktop/image-studio.js";
import { createImageStudioApp } from "./app.js";

const webDriver = new MemoryStorageDriver();

export function createImageStudioClient({ desktop = false, appRuntime = null, host: sharedHost = null, getUserId = () => "local-user" } = {}) {
  const host = appRuntime?.host ?? sharedHost ?? new AppHost({ storageDriver: desktop ? new TauriStorageDriver() : webDriver });
  if (!host.getManifest("image-studio")) host.register(createImageStudioApp({ generator: { generate: generateImageStudio } }));
  registerAgentHost("image-studio", host);
  const invoke = (operationId, input = {}) => host.invoke(operationId, input, { actor: { type: "user", id: getUserId() || "local-user" } });
  return Object.freeze({
    listTemplates: () => invoke("image-studio.template.list"), readTemplate: (id) => invoke("image-studio.template.read", { id }),
    createTemplate: (markdown) => invoke("image-studio.template.create", { markdown }), updateTemplate: (id, markdown) => invoke("image-studio.template.update", { id, markdown }),
    trashTemplate: (id) => invoke("image-studio.template.trash", { id }), restoreTemplate: (id) => invoke("image-studio.template.restore", { id }),
    listGenerations: (includeTrash = false) => invoke("image-studio.generation.list", { includeTrash }), readGeneration: (id) => invoke("image-studio.generation.read", { id }),
    generate: (input) => invoke((input.references?.length ?? 0) ? "image-studio.generation.create-from-reference" : "image-studio.generation.create", input),
    trashGeneration: (id) => invoke("image-studio.generation.trash", { id }), restoreGeneration: (id) => invoke("image-studio.generation.restore", { id }), purgeGeneration: (id) => invoke("image-studio.generation.purge", { id }),
    isNoteAvailable: () => Boolean(host.getManifest("knowledge")),
    listNoteProjects: () => invoke("knowledge.project.list"),
    listNotePages: (projectId) => invoke("knowledge.page.list", { projectId }),
    listNoteTags: (projectId) => invoke("knowledge.tag.list", { projectId }),
    readNotePageMarkdown: (projectId, pageId) => invoke("knowledge.page.markdown.read", { projectId, pageId }),
    pickReference: () => pickImageStudioReference(), storeReference: (file) => storeImageStudioReferenceBytes(file), readResource: (id) => readImageStudioResource(id), subscribe: (eventId, handler) => host.subscribe(eventId, handler),
  });
}
