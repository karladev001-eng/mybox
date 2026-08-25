import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isDesktopRuntime } from "./workspace.js";

function unsupported() {
  throw new Error("Projectの保存場所変更はデスクトップ版で利用できます");
}

export async function listProjectStores() {
  if (!isDesktopRuntime()) return [];
  return invoke("project_stores");
}

export async function projectStorePath(projectId) {
  if (!isDesktopRuntime()) return "MyBoxアプリ内";
  return invoke("project_store_path", { projectId });
}

/** Selects a parent directory and moves this Project below `MyBox Projects`. */
export async function moveProjectStore({ projectId, projectName }) {
  if (!isDesktopRuntime()) unsupported();
  const parentPath = await open({
    directory: true,
    multiple: false,
    title: "Projectの保存場所を選択",
  });
  if (!parentPath) return null;
  return invoke("move_project_store", { projectId, projectName, parentPath });
}

/** Selects an existing MyBox Note Project directory on this device. */
export async function attachProjectStore() {
  if (!isDesktopRuntime()) unsupported();
  const path = await open({
    directory: true,
    multiple: false,
    title: "既存のMyBox Note Projectフォルダーを選択",
  });
  if (!path) return null;
  return invoke("attach_project_store", { path });
}

export async function ensureAppProjectStore({ projectId, projectName }) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("ensure_app_project_store", { projectId, projectName });
}

export async function moveProjectStoreToApp({ projectId, projectName }) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("move_project_store_to_app", { projectId, projectName });
}

export async function forgetProjectStore(projectId) {
  if (!isDesktopRuntime()) return;
  await invoke("forget_project_store", { projectId });
}

export async function renameProjectStore(projectId, projectName) {
  if (!isDesktopRuntime()) return;
  await invoke("rename_project_store", { projectId, projectName });
}

export async function readProjectStoreUpdates(projectId, knownIds = []) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("read_project_store_updates", { projectId, knownIds });
}

export async function writeProjectStoreUpdate(projectId, update) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("write_project_store_update", { projectId, update });
}
