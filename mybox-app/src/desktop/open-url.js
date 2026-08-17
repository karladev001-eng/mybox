import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Opens a link in the User's own browser. The WebView ignores `target="_blank"`,
 * so a plain anchor silently does nothing in the desktop app.
 */
export async function openExternalUrl(url) {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
