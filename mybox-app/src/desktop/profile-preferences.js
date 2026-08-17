import { createProfilePreferencesStore } from "../core/profile-preferences.js";
import { createAppStorage, MemoryStorageDriver } from "../core/storage.js";
import { TauriStorageDriver } from "./tauri-storage.js";
import { isDesktopRuntime } from "./workspace.js";

const HOST_PROFILE_ID = "mybox-host";
const memoryStore = createProfilePreferencesStore(createAppStorage(HOST_PROFILE_ID, new MemoryStorageDriver()));
const nativeStore = createProfilePreferencesStore(createAppStorage(HOST_PROFILE_ID, new TauriStorageDriver()));

export function getProfilePreferencesStore() {
  return isDesktopRuntime() ? nativeStore : memoryStore;
}
