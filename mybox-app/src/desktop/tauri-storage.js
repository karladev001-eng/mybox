import { invoke } from "@tauri-apps/api/core";

export class TauriStorageDriver {
  async read(appId, key) {
    const value = await invoke("read_app_json", { appId, key });
    return value === null ? undefined : value;
  }

  async write(appId, key, value) {
    await invoke("write_app_json", { appId, key, value });
  }

  async delete(appId, key) {
    return invoke("delete_app_value", { appId, key });
  }

  async list(appId, prefix) {
    return invoke("list_app_keys", { appId, prefix });
  }
}
