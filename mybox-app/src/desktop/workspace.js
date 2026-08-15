import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function isDesktopRuntime() {
  return isTauri();
}

export async function getCurrentWorkspace() {
  if (!isDesktopRuntime()) return null;
  return invoke("current_workspace");
}

export async function chooseWorkspace() {
  if (!isDesktopRuntime()) return null;
  const path = await open({
    directory: true,
    multiple: false,
    title: "MyBoxの保存先を選択",
  });
  if (!path) return null;
  return invoke("open_workspace", { path });
}
