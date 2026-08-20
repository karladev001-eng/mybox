import { createHostSessionStore } from "../core/host-session.js";
import { createAppStorage, MemoryStorageDriver } from "../core/storage.js";
import { TauriStorageDriver } from "./tauri-storage.js";
import { isDesktopRuntime } from "./workspace.js";

const HOST_APP_ID = "mybox-host";
const memoryStore = createHostSessionStore(createAppStorage(HOST_APP_ID, new MemoryStorageDriver()));
const nativeStore = createHostSessionStore(createAppStorage(HOST_APP_ID, new TauriStorageDriver()));

export function getHostSessionStore() {
  return isDesktopRuntime() ? nativeStore : memoryStore;
}
