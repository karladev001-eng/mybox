import { createSyncClient } from "./sync-client.js";
import {
  applyPageMutation,
  createProjectDoc,
  listPageIds,
  readPage,
  seedPage,
} from "./yjs-document.js";

/**
 * Mutations the document can apply today. Tags and PageLink creation still run
 * through the local model, so they are refused with an explanation rather than
 * silently dropped.
 */
const SHARED_MUTATIONS = new Set(["rename", "block-update", "block-add", "block-remove", "block-move"]);

export class SharedProjectError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SharedProjectError";
    this.code = code;
    this.details = details;
  }
}

function newBlockId() {
  return `block-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

/** The document wants a whole Block where the domain names a type and text. */
function toDocumentMutation(mutation) {
  if (mutation.type !== "block-add") return mutation;
  return {
    type: "block-add",
    afterBlockId: mutation.afterBlockId,
    block: {
      id: newBlockId(),
      type: mutation.blockType ?? "paragraph",
      text: mutation.text ?? "",
      checked: false,
      links: [],
    },
  };
}

/**
 * A shared Project's live state: one Yjs document plus the client keeping it in
 * step with the group's server.
 *
 * The view asks this for Pages instead of the JSON store, but gets the same
 * shapes back, so the editor does not branch on whether a Project is shared.
 * Mutations carry no expected revision here: a CRDT converges rather than
 * rejecting, which is what allows two people to type at once.
 */
export function createSharedProject({
  endpoint,
  projectId,
  token,
  onChange = () => {},
  onStatus = () => {},
  onError = () => {},
  onPresence = () => {},
  createClient = createSyncClient,
}) {
  const doc = createProjectDoc();
  let status = "idle";

  // Fires for local and remote updates alike, so the editor re-reads whenever
  // the document moves for any reason.
  const notify = () => onChange();
  doc.on("update", notify);

  const client = createClient({
    doc,
    endpoint,
    projectId,
    token,
    onStatus: (state) => {
      status = state.status;
      onStatus(state);
    },
    onError,
    onAwareness: onPresence,
  });

  return {
    doc,
    get status() { return status; },
    get role() { return client.role; },

    connect() {
      client.connect();
    },

    listPages() {
      return listPageIds(doc)
        .map((id) => readPage(doc, id))
        .filter((page) => page && page.state === "active")
        .map((page) => ({
          id: page.id,
          projectId,
          title: page.title,
          state: page.state,
          tagIds: page.tagIds,
          excerpt: page.blocks.find((block) => block.text.trim())?.text.slice(0, 120) ?? "",
        }));
    },

    readPage(pageId) {
      const page = readPage(doc, pageId);
      if (!page) return null;
      // Backlinks are derived rather than stored, so they stay correct after a
      // merge without any peer having to recompute them.
      const backlinks = listPageIds(doc).flatMap((sourceId) => {
        const source = readPage(doc, sourceId);
        return source.blocks
          .filter((block) => block.links.some((link) => link.targetPageId === pageId))
          .map((block) => ({
            projectId,
            pageId: sourceId,
            pageTitle: source.title,
            pageState: source.state,
            blockId: block.id,
            excerpt: block.text.slice(0, 180),
          }));
      });
      return { page: { ...page, projectId, revision: 0 }, tags: [], backlinks };
    },

    /**
     * Takes the same mutation vocabulary `domain.js` does, so every caller —
     * the editor, the assistant, a future Flow — speaks one language and the
     * document is not a second, parallel write path with its own shapes.
     */
    mutate(pageId, mutation) {
      if (!SHARED_MUTATIONS.has(mutation.type)) {
        throw new SharedProjectError(
          "MUTATION_UNSUPPORTED_WHEN_SHARED",
          "この操作は共有Projectではまだ利用できません。",
          { type: mutation.type },
        );
      }
      return applyPageMutation(doc, pageId, toDocumentMutation(mutation));
    },

    createPage(page) {
      seedPage(doc, page);
      return readPage(doc, page.id);
    },

    /** Copies Pages already held locally into the shared document. */
    adopt(pages) {
      const existing = new Set(listPageIds(doc));
      for (const page of pages) {
        if (!existing.has(page.id)) seedPage(doc, page);
      }
    },

    sendPresence(state) {
      client.sendAwareness(state);
    },

    dispose() {
      doc.off("update", notify);
      client.disconnect();
    },
  };
}
