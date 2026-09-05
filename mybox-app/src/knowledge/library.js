import { readPage, KnowledgeDomainError } from "./domain.js";
import { authorize, recordPage } from "./records.js";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const fail = (code, message) => { throw new KnowledgeDomainError(code, message); };

function destination(state, projectId, folderId, profileId, movingId) {
  let id = folderId;
  const seen = new Set(movingId ? [movingId] : []);
  while (id) {
    if (seen.has(id)) fail("FOLDER_CYCLE", "Folderを自身の中へ移動できません");
    seen.add(id);
    const folder = readPage(state, { projectId, pageId: id, profileId });
    if (folder.kind !== "folder" || folder.state !== "active") fail("FOLDER_UNAVAILABLE", "保存先のFolderを利用できません");
    id = folder.folderId;
  }
}

export function createFolder(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  destination(state, input.projectId, input.folderId, profileId);
  const result = recordPage(state, { ...input, id: input.folderIdToCreate }, "folder", profileId);
  result.page.folderId = input.folderId ?? null;
  return result;
}

export function moveToFolder(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  const next = structuredClone(state);
  const page = next.pages.find((p) => p.id === input.pageId && p.projectId === input.projectId);
  if (!page || page.state !== "active") fail("PAGE_NOT_FOUND", "移動するPageを利用できません");
  destination(next, input.projectId, input.folderId, profileId, page.id);
  page.folderId = input.folderId ?? null;
  page.updatedAt = new Date().toISOString();
  return { state: next, page };
}

export function assertEmptyFolder(state, page) {
  if (page?.kind === "folder" && state.pages.some((p) => p.projectId === page.projectId && p.folderId === page.id)) fail("FOLDER_NOT_EMPTY", "Folder内のPageを移動してから削除してください（Trash内も含みます）");
}

export async function verifyFile(base64, expectedHash) {
  if (typeof base64 !== "string" || base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail("INVALID_FILE", "ファイルは20 MB以下で指定してください");
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) fail("INVALID_FILE", "空のファイル、または20 MBを超えるファイルは取り込めません");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expectedHash && hash !== expectedHash) fail("FILE_CORRUPT", "ファイルの照合に失敗しました");
  const starts = (...signature) => signature.every((b, i) => bytes[i] === b);
  const mediaType = starts(137, 80, 78, 71, 13, 10, 26, 10) ? "image/png" : starts(255, 216, 255) ? "image/jpeg" : starts(82, 73, 70, 70) && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP" ? "image/webp" : starts(37, 80, 68, 70, 45) ? "application/pdf" : "application/octet-stream";
  return { hash, size: bytes.length, mediaType };
}

export async function importFile(state, input, profileId, resources, files) {
  authorize(state, input.projectId, profileId, true);
  const name = input.name?.trim();
  if (!name || name.length > 240 || /[\\/\x00-\x1f]/.test(name)) fail("INVALID_FILE_NAME", "ファイル名を確認してください");
  const metadata = await verifyFile(input.base64);
  const existing = state.pages.find((page) => page.id === input.fileId);
  if (existing) {
    if (existing.projectId !== input.projectId || existing.kind !== "file" || existing.file?.hash !== metadata.hash || existing.file.name !== name) fail("RECORD_ID_CONFLICT", "File IDが既に使われています");
    return { state, page: existing };
  }
  await files.put(input.projectId, metadata.hash, input.base64);
  const result = recordPage(state, { projectId: input.projectId, id: input.fileId, title: name }, "file", profileId);
  result.page.file = { version: 1, name, ...metadata };
  return result;
}


/** Retain former Folder identities as link Notes; no content or original is deleted. */
export function flattenLibrary(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  readPage(state, { ...input, profileId });
  const next = structuredClone(state);
  for (const page of next.pages.filter((p) => p.projectId === input.projectId)) {
    if (page.kind === "folder") {
      for (const child of next.pages.filter((p) => p.projectId === page.projectId && p.folderId === page.id)) {
        const id = `former-folder-child-${child.id}`;
        if (!page.blocks.some((b) => b.id === id)) page.blocks.push({ id, type: "paragraph", text: `[[${child.title}]]`, checked: false, revision: 1, links: [{ targetPageId: child.id, token: `[[${child.title}]]` }] });
      }
      page.kind = "note";
      page.revision = (page.revision ?? 0) + 1;
    }
  }
  for (const page of next.pages.filter((p) => p.projectId === input.projectId && p.folderId)) page.folderId = null;
  return { state: next, page: next.pages.find((p) => p.id === input.pageId && p.projectId === input.projectId) };
}
