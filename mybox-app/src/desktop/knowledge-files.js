import { invoke } from "@tauri-apps/api/core";
import { listSyncEndpoints } from "./sync-endpoints.js";

/** Project bytes are durable locally before metadata is committed. */
export function createProjectFileStore() {
  async function remote(projectId, hash, base64) {
    const server = (await listSyncEndpoints()).find((entry) => entry.projectId === projectId);
    if (!server) return null;
    const url = new URL(`${server.endpoint.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}/files`);
    url.searchParams.set("hash", hash);
    const response = await fetch(url, { method: base64 === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${server.token}`, ...(base64 === undefined ? {} : { "Content-Type": "application/json" }) }, ...(base64 === undefined ? {} : { body: JSON.stringify({ hash, base64 }) }) });
    if (!response.ok) throw new Error(response.status === 404 ? "共有先のFileが見つかりません。同期サーバーの更新・Fileの同期を確認してください" : "共有Fileを利用できません。接続と権限を確認してください");
    return response.json();
  }
  return {
    cache: (projectId, hash, base64) => invoke("write_project_file", { projectId, hash, base64 }),
    async put(projectId, hash, base64) {
      await invoke("write_project_file", { projectId, hash, base64 });
      await remote(projectId, hash, base64);
    },
    async get(projectId, hash) {
      const local = await invoke("read_project_file", { projectId, hash });
      if (local) return local;
      const result = await remote(projectId, hash);
      if (!result?.base64) throw new Error("File原本が見つかりません");
      // The authorized Operation verifies the hash before returning these bytes.
      return result.base64;
    },
    async publish(projectId, pages) {
      for (const page of pages) {
        if (!page.file?.hash) continue;
        const base64 = await invoke("read_project_file", { projectId, hash: page.file.hash });
        if (base64) await remote(projectId, page.file.hash, base64);
      }
    },
  };
}
