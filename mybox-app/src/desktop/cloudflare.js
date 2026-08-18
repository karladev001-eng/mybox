import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./workspace.js";

/**
 * Drives the account-level Cloudflare API token that lets MyBox deploy and
 * manage a group's sync server directly, replacing the GitHub-connected
 * "Deploy to Cloudflare" button (ADR 0024). The token itself never returns
 * to the WebView once stored, the same submit-once boundary ADR 0006 already
 * uses for other provider API keys.
 */
function unsupported() {
  throw new Error("Cloudflareのデプロイはデスクトップ版で利用できます");
}

export async function cloudflareStatus() {
  if (!isDesktopRuntime()) return { configured: false, workerUrl: null };
  return invoke("cloudflare_status");
}

export async function setCloudflareCredentials({ accountId, apiToken }) {
  if (!isDesktopRuntime()) unsupported();
  await invoke("set_cloudflare_credentials", { accountId, apiToken });
}

export async function clearCloudflareCredentials() {
  if (!isDesktopRuntime()) return;
  await invoke("clear_cloudflare_credentials");
}

/** Deploys or redeploys the account's one Worker and returns its URL and the secret to claim a Project with. */
export async function deploySyncServer() {
  if (!isDesktopRuntime()) unsupported();
  return invoke("deploy_sync_server");
}

/** Deletes the Worker itself. Every Project hosted on it stops syncing, not just one. */
export async function deleteSyncServer() {
  if (!isDesktopRuntime()) unsupported();
  await invoke("delete_sync_server");
}
