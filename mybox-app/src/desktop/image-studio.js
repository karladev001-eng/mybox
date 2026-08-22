import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function generateImageStudio({ prompt, references = [], generationId }) {
  if (!isTauri()) { const error = new Error("画像生成はデスクトップ版で利用できます"); error.code = "DESKTOP_REQUIRED"; throw error; }
  return invoke("generate_image_studio", { request: { prompt, references, generationId } });
}

export async function readImageStudioResource(resourceId) {
  if (!isTauri()) return null;
  return invoke("read_image_studio_resource", { resourceId });
}

export async function deleteImageStudioResource(resourceId) {
  if (!isTauri()) return;
  return invoke("delete_image_studio_resource", { resourceId });
}

export async function pickImageStudioReference() {
  if (!isTauri()) throw new Error("参照画像はデスクトップ版で利用できます");
  const path = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }] });
  if (!path) return null;
  return invoke("store_image_studio_reference", { path });
}

export async function storeImageStudioReferenceBytes(file) {
  if (!isTauri()) throw new Error("参照画像はデスクトップ版で利用できます");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return invoke("store_image_studio_reference_bytes", { data: btoa(binary) });
}

export async function storeImageStudioReferenceBase64(data) {
  if (!isTauri()) throw new Error("参照画像はデスクトップ版で利用できます");
  return invoke("store_image_studio_reference_bytes", { data });
}
