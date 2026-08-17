import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { isDesktopRuntime } from "./workspace.js";

const unsupported = Object.freeze({
  supported: false,
  currentVersion: async () => null,
  check: async () => ({ available: false }),
  downloadAndInstall: async () => {
    throw new Error("MyBox updates require the desktop app");
  },
  relaunch: async () => {},
});

const native = Object.freeze({
  supported: true,
  currentVersion: () => getVersion(),
  async check() {
    const update = await check();
    if (!update) return { available: false };
    return { available: true, version: update.version, date: update.date, notes: update.body, update };
  },
  async downloadAndInstall(update, onProgress) {
    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") downloaded += event.data.chunkLength ?? 0;
      onProgress?.({ downloaded, total });
    });
  },
  relaunch: () => relaunch(),
});

export function getHostUpdaterClient() {
  return isDesktopRuntime() ? native : unsupported;
}
