import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./workspace.js";

/**
 * A Project's sync endpoint and the member token that opens it. The token rests
 * in the OS credential store and is handed here only because the sync socket
 * carries it in its URL.
 */
function unsupported() {
  throw new Error("同期はデスクトップ版で利用できます");
}

export async function listSyncEndpoints() {
  if (!isDesktopRuntime()) return [];
  return invoke("sync_endpoints");
}

/** Claims a Project on a server this User operates. */
export async function connectSyncEndpoint({ projectId, endpoint, secret, profileId }) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("connect_sync_endpoint", { projectId, endpoint, secret, profileId });
}

/** Joins a Project on someone else's server with the invite they sent. */
export async function joinSyncEndpoint({ projectId, endpoint, invite, profileId }) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("join_sync_endpoint", { projectId, endpoint, invite, profileId });
}

export async function createSyncInvite({ projectId, role = "editor" }) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("create_sync_invite", { projectId, role });
}

export async function disconnectSyncEndpoint(projectId) {
  if (!isDesktopRuntime()) return;
  await invoke("disconnect_sync_endpoint", { projectId });
}
