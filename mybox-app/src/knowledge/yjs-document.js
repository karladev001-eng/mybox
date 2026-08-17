import * as Y from "yjs";
import { BLOCK_TYPES } from "./domain.js";

/**
 * The shared representation of one Project. A shared Page lives here instead of
 * in the JSON state, so concurrent edits merge rather than raise the revision
 * conflict the local model reports ([ADR 0023]).
 *
 * Reads project this back into the Page and Block shape the rest of the App
 * already speaks, so Operations, events, and the editor stay unchanged.
 *
 *   pages: Y.Map<pageId, Y.Map>
 *     title      string
 *     state      "active" | "trash"
 *     tagIds     Y.Array<string>
 *     blocks     Y.Array<Y.Map>
 *       id       string
 *       type     string
 *       text     Y.Text          <- merged per character
 *       checked  boolean
 *       links    Y.Array<{ targetPageId, token }>
 *   tags: Y.Map<tagId, { label, normalizedLabel }>
 */
export function createProjectDoc() {
  return new Y.Doc();
}

const pagesOf = (doc) => doc.getMap("pages");
const tagsOf = (doc) => doc.getMap("tags");

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Smallest single-range edit turning `previous` into `next`.
 *
 * Replacing the whole Y.Text on every keystroke would discard a collaborator's
 * concurrent edit, because the delete covers characters they just typed. A
 * common-prefix/suffix range keeps the untouched characters untouched, which is
 * what lets two people type in one paragraph at once.
 *
 * Boundaries never split a surrogate pair, so an emoji is inserted or removed
 * whole rather than corrupted.
 */
export function textDelta(previous, next) {
  if (previous === next) return null;

  const shorter = Math.min(previous.length, next.length);
  let start = 0;
  while (start < shorter && previous[start] === next[start]) start += 1;
  if (start > 0 && isHighSurrogate(previous.charCodeAt(start - 1))) start -= 1;

  let end = 0;
  const maxEnd = shorter - start;
  while (end < maxEnd && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end += 1;
  if (end > 0 && isHighSurrogate(next.charCodeAt(next.length - end))) end -= 1;

  return {
    index: start,
    remove: previous.length - start - end,
    insert: next.slice(start, next.length - end),
  };
}

function applyText(yText, nextText) {
  const delta = textDelta(yText.toString(), nextText);
  if (!delta) return;
  if (delta.remove > 0) yText.delete(delta.index, delta.remove);
  if (delta.insert) yText.insert(delta.index, delta.insert);
}

function newBlock(block = {}) {
  const map = new Y.Map();
  map.set("id", block.id);
  map.set("type", BLOCK_TYPES.includes(block.type) ? block.type : "paragraph");
  map.set("checked", block.checked === true);
  const text = new Y.Text();
  if (block.text) text.insert(0, block.text);
  map.set("text", text);
  const links = new Y.Array();
  if (block.links?.length) links.push(block.links.map((link) => ({ ...link })));
  map.set("links", links);
  return map;
}

function blockIndex(blocks, blockId) {
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks.get(i).get("id") === blockId) return i;
  }
  return -1;
}

/** Copies a Page from the local JSON state into the shared document. */
export function seedPage(doc, page) {
  doc.transact(() => {
    const map = new Y.Map();
    map.set("title", page.title);
    map.set("state", page.state ?? "active");
    const tagIds = new Y.Array();
    if (page.tagIds?.length) tagIds.push([...page.tagIds]);
    map.set("tagIds", tagIds);
    const blocks = new Y.Array();
    map.set("blocks", blocks);
    blocks.push((page.blocks ?? []).map(newBlock));
    pagesOf(doc).set(page.id, map);
  });
}

export function seedTags(doc, tags) {
  doc.transact(() => {
    for (const tag of tags) tagsOf(doc).set(tag.id, { label: tag.label, normalizedLabel: tag.normalizedLabel });
  });
}

export function listPageIds(doc) {
  return [...pagesOf(doc).keys()];
}

/** Projects a shared Page back into the shape the editor and Operations use. */
export function readPage(doc, pageId) {
  const page = pagesOf(doc).get(pageId);
  if (!page) return null;
  return {
    id: pageId,
    title: page.get("title"),
    state: page.get("state"),
    tagIds: page.get("tagIds").toArray(),
    blocks: page.get("blocks").map((block) => ({
      id: block.get("id"),
      type: block.get("type"),
      text: block.get("text").toString(),
      checked: block.get("checked") === true,
      links: block.get("links").toArray().map((link) => ({ ...link })),
    })),
  };
}

/**
 * Applies one Page mutation, using the same mutation vocabulary as the local
 * model so a caller does not branch on whether a Project is shared.
 *
 * There is no expected revision: a CRDT converges instead of rejecting, which
 * is the whole reason a shared Project uses this path.
 */
export function applyPageMutation(doc, pageId, mutation) {
  const page = pagesOf(doc).get(pageId);
  if (!page) throw new Error(`PAGE_NOT_FOUND: ${pageId}`);
  const blocks = page.get("blocks");

  doc.transact(() => {
    switch (mutation.type) {
      case "rename":
        page.set("title", mutation.title);
        break;

      case "page-state":
        page.set("state", mutation.state);
        break;

      case "tags-set": {
        const tagIds = page.get("tagIds");
        tagIds.delete(0, tagIds.length);
        if (mutation.tagIds?.length) tagIds.push([...mutation.tagIds]);
        break;
      }

      case "block-update": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${mutation.blockId}`);
        const block = blocks.get(index);
        if (mutation.blockType !== undefined) block.set("type", mutation.blockType);
        if (mutation.checked !== undefined) block.set("checked", mutation.checked === true);
        if (mutation.text !== undefined) applyText(block.get("text"), mutation.text);
        break;
      }

      case "block-add": {
        const after = mutation.afterBlockId ? blockIndex(blocks, mutation.afterBlockId) : blocks.length - 1;
        blocks.insert(after < 0 ? blocks.length : after + 1, [newBlock(mutation.block ?? { id: mutation.blockId })]);
        break;
      }

      case "block-remove": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index >= 0) blocks.delete(index, 1);
        break;
      }

      case "block-move": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${mutation.blockId}`);
        // Y.Array has no move, so the block is re-created at the destination.
        // Its text stops being collaborative for that edit, which is why moving
        // is a deliberate structural action rather than part of typing.
        const snapshot = readPage(doc, pageId).blocks[index];
        blocks.delete(index, 1);
        const target = mutation.beforeBlockId === null || mutation.beforeBlockId === undefined
          ? blocks.length
          : Math.max(0, blockIndex(blocks, mutation.beforeBlockId));
        blocks.insert(target, [newBlock(snapshot)]);
        break;
      }

      case "link-add": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${mutation.blockId}`);
        const block = blocks.get(index);
        applyText(block.get("text"), mutation.text);
        block.get("links").push([{ targetPageId: mutation.targetPageId, token: mutation.token }]);
        break;
      }

      default:
        throw new Error(`INVALID_PAGE_MUTATION: ${mutation.type}`);
    }
  });

  return readPage(doc, pageId);
}

export function createPage(doc, page) {
  seedPage(doc, page);
  return readPage(doc, page.id);
}

/** The bytes a peer needs to reach this document's current state. */
export function encodeState(doc) {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * `origin` lets a caller mark where an update came from. A sync client tags
 * relayed updates so it can tell them apart from local edits and avoid echoing
 * them back to the room.
 */
export function applyUpdate(doc, update, origin) {
  Y.applyUpdate(doc, update, origin);
}
