import { createChatHistoryStore } from "../core/chat-history.js";
import { createAppStorage, MemoryStorageDriver } from "../core/storage.js";
import { TauriStorageDriver } from "./tauri-storage.js";
import { isDesktopRuntime } from "./workspace.js";

const APP_ID = "ai-chat";
const memoryDriver = new MemoryStorageDriver();
const memoryStore = createChatHistoryStore(createAppStorage(APP_ID, memoryDriver));
const nativeStore = createChatHistoryStore(createAppStorage(APP_ID, new TauriStorageDriver()));

export function getChatHistoryStore() {
  return isDesktopRuntime() ? nativeStore : memoryStore;
}
