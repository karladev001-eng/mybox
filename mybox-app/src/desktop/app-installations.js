import { createAppInstallationsStore } from "../core/app-installations.js";
import { createAppStorage, MemoryStorageDriver } from "../core/storage.js";
import { TauriStorageDriver } from "./tauri-storage.js";
import { isDesktopRuntime } from "./workspace.js";

const HOST_APP_ID = "mybox-host";
const memoryDriver = new MemoryStorageDriver();

export function createDeviceAppInstallationsStore(defaultInstalledApps, availableApps = defaultInstalledApps) {
  const driver = isDesktopRuntime() ? new TauriStorageDriver() : memoryDriver;
  return createAppInstallationsStore(createAppStorage(HOST_APP_ID, driver), { defaultInstalledApps, availableApps });
}
