import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isDesktopRuntime } from "./workspace.js";

/**
 * Stores an image a User picked, dropped, or pasted in the Knowledge App's
 * own private resource namespace, the same "opaque resource ID, never a
 * path" pattern the AI chat's generated images already use (`codex.rs`).
 */
function unsupported() {
  throw new Error("画像の追加はデスクトップ版で利用できます");
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

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

/** Stores a pasted clipboard image. `base64Data` is a plain base64 payload, not a `data:` URI. */
export async function storeKnowledgeImageBytes(base64Data) {
  if (!isDesktopRuntime()) unsupported();
  return invoke("store_knowledge_image_bytes", { data: base64Data });
}

/**
 * Watches for OS-level file drops onto the window for as long as the caller
 * keeps the returned unsubscribe function unused, and stores whichever
 * dropped files look like images. Native drag-drop is webview-wide, not
 * scoped to a DOM element, so this is meant to run only while a surface that
 * wants dropped images (an open Knowledge Page) is mounted.
 */
export function watchDroppedKnowledgeImages(onStored, onError = () => {}) {
  if (!isDesktopRuntime()) return () => {};
  let unlisten = null;
  let cancelled = false;
  getCurrentWebview()
    .onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      event.payload.paths
        .filter((path) => IMAGE_EXTENSIONS.has(path.split(".").pop()?.toLowerCase()))
        .forEach((path) => {
          invoke("store_knowledge_image", { path }).then(onStored).catch(onError);
        });
    })
    .then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
