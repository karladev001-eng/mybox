import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isDesktopRuntime } from "./workspace.js";

/**
 * Stores an image a User picked, dropped, or pasted in the Knowledge App's
 * own private resource namespace, the same "opaque resource ID, never a
 * path" pattern the AI chat's generated images already use (`codex.rs`).
 */
function unsupported() {
  throw new Error("画像の追加はデスクトップ版で利用できます");
}

/** Opens a native file picker limited to images. Resolves to null if the User cancelled. */
export async function pickKnowledgeImage() {
  if (!isDesktopRuntime()) unsupported();
  const path = await open({
    multiple: false,
    title: "画像を選択",
    filters: [{ name: "画像", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (!path) return null;
  return invoke("store_knowledge_image", { path });
}

/** Reads a stored image back as a data URI. */
export async function readKnowledgeImage(resourceId) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("read_knowledge_image", { resourceId });
}

/** Stores a pasted or dropped image. `base64Data` is a plain base64 payload, not a `data:` URI. */
export async function storeKnowledgeImageBytes(base64Data) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("store_knowledge_image_bytes", { data: base64Data });
}
