import { LOCAL_PROFILE_ID } from "../core/account-identity.js";
import { registerAgentHost } from "../core/agent-host-registry.js";
import { AppHost } from "../core/app-host.js";
import { MemoryStorageDriver } from "../core/storage.js";
import {
  clearCloudflareCredentials,
  cloudflareStatus,
  deleteSyncServer,
  deploySyncServer,
  setCloudflareCredentials,
} from "../desktop/cloudflare.js";
import {
  pickKnowledgeImage,
  readKnowledgeImage,
  storeKnowledgeImageBytes,
} from "../desktop/knowledge-images.js";
import { openExternalUrl } from "../desktop/open-url.js";
import {
  connectSyncEndpoint,
  createSyncInvite,
  disconnectSyncEndpoint,
  joinSyncEndpoint,
  listSyncEndpoints,
  listSyncMembers,
  removeSyncMember,
} from "../desktop/sync-endpoints.js";
import { TauriStorageDriver } from "../desktop/tauri-storage.js";
import { createKnowledgeApp } from "./app.js";

const webDriver = new MemoryStorageDriver();

/**
 * `getProfileId` is read per invocation so a sign-in or sign-out applies to the
 * next Operation without rebuilding the client. This is the only file the
 * Knowledge surface may import a `desktop/` bridge module from; the View
 * calls these wrappers instead.
 */
export function createKnowledgeClient({ desktop = false, getProfileId = () => LOCAL_PROFILE_ID, appRuntime = null } = {}) {
  const storageDriver = desktop ? new TauriStorageDriver() : webDriver;
  const host = appRuntime?.host ?? new AppHost({ storageDriver });
  // The View owns the live shared session (it needs a socket), but every write
  // has to reach it through Operations, or the assistant writes to the JSON
  // store while the editor reads the document and neither sees the other.
  const sharedSessions = appRuntime?.sharedSessions ?? new Map();
  if (!host.getManifest("knowledge")) host.register(createKnowledgeApp({ sharedSessions: { get: (projectId) => sharedSessions.get(projectId) ?? null } }));
  // Lets the assistant panel invoke this App's Operations (ADR 0025) without
  // holding a private reference to Knowledge's client.
  registerAgentHost("knowledge", host);
  const invoke = (operationId, input = {}) => host.invoke(operationId, input, {
    actor: { type: "user", id: getProfileId() || LOCAL_PROFILE_ID },
  });
  const resolvedProfileId = () => getProfileId() || LOCAL_PROFILE_ID;

  return Object.freeze({
    listProjects: () => invoke("knowledge.project.list"),
    listMemberColors: (projectId) => invoke("knowledge.project.members.list", { projectId }),
    setMemberColor: (projectId, profileId, color) => invoke("knowledge.project.member-color.set", { projectId, profileId, color }),
    createProject: (name) => invoke("knowledge.project.create", { name }),
    renameProject: (projectId, name) => invoke("knowledge.project.rename", { projectId, name }),
    deleteProject: (projectId) => invoke("knowledge.project.delete", { projectId }),
    listPages: (projectId, includeTrash = false) => invoke("knowledge.page.list", { projectId, includeTrash }),
    readPage: (projectId, pageId) => invoke("knowledge.page.read", { projectId, pageId }),
    search: ({ query, projectIds, includeTrash = false }) => invoke("knowledge.page.search", { query, projectIds, includeTrash }),
    createPage: (projectId, title) => invoke("knowledge.page.create", { projectId, title }),
    updatePage: (projectId, pageId, expectedRevision, mutation) => invoke("knowledge.page.update", {
      projectId,
      pageId,
      expectedRevision,
      mutation,
    }),
    moveToTrash: (projectId, pageId, expectedRevision) => invoke("knowledge.page.move-to-trash", { projectId, pageId, expectedRevision }),
    restorePage: (projectId, pageId, expectedRevision) => invoke("knowledge.page.restore", { projectId, pageId, expectedRevision }),
    purgePage: (projectId, pageId, expectedRevision) => invoke("knowledge.page.purge", { projectId, pageId, expectedRevision }),
    readHistory: (projectId, pageId) => invoke("knowledge.page.history.read", { projectId, pageId }),
    restoreHistory: (projectId, pageId, expectedRevision, historyId) => invoke("knowledge.page.history.restore", {
      projectId,
      pageId,
      expectedRevision,
      historyId,
    }),
    listTags: (projectId) => invoke("knowledge.tag.list", { projectId }),
    linkAccount: (accountId) => invoke("knowledge.profile.link-account", { accountId }),
    listSync: () => listSyncEndpoints(),
    connectSync: ({ projectId, endpoint, secret }) => connectSyncEndpoint({ projectId, endpoint, secret, profileId: resolvedProfileId() }),
    joinSync: ({ projectId, endpoint, invite }) => joinSyncEndpoint({ projectId, endpoint, invite, profileId: resolvedProfileId() }),
    createInvite: ({ projectId, role }) => createSyncInvite({ projectId, role }),
    disconnectSync: (projectId) => disconnectSyncEndpoint(projectId),
    listMembers: (projectId) => listSyncMembers(projectId),
    removeMember: (projectId, profileId) => removeSyncMember(projectId, profileId),
    cloudflareStatus: () => cloudflareStatus(),
    setCloudflareCredentials: (accountId, apiToken) => setCloudflareCredentials({ accountId, apiToken }),
    clearCloudflareCredentials: () => clearCloudflareCredentials(),
    deploySyncServer: () => deploySyncServer(),
    deleteSyncServer: () => deleteSyncServer(),
    openExternalUrl: (url) => openExternalUrl(url),
    pickImage: () => pickKnowledgeImage(),
    readImage: (resourceId) => readKnowledgeImage(resourceId),
    storeImageBytes: (base64Data) => storeKnowledgeImageBytes(base64Data),
    // The assistant invokes this same host (ADR 0025), so the View has to learn
    // about writes it did not make itself. Returns an unsubscribe function.
    subscribe: (eventId, handler) => host.subscribe(eventId, handler),
    /** The View hands over its live shared session so Operations write to it. */
    setSharedSession: (projectId, session) => {
      if (session) sharedSessions.set(projectId, session);
      else sharedSessions.delete(projectId);
    },
  });
}
