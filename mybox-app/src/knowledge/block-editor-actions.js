import { TextSelection, Selection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { InputRule } from "prosemirror-inputrules";
import { paperSchema, blockToPaper, paperToBlocks } from "./paper-document.js";
import { planBlockMove } from "./block-movement.js";

export function dividerInputRule() {
  return new InputRule(/^---$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    // Only a complete top-level paragraph: never replace code, list content,
    // an escaped marker or a marker followed by existing text.
    if ($start.depth !== 1 || $start.parent.type !== paperSchema.nodes.paragraph || end !== $start.end()) return null;
    const pos = $start.before(), after = pos + $start.parent.nodeSize;
    const next = state.doc.maybeChild($start.index(0) + 1);
    const reuse = next?.type === paperSchema.nodes.paragraph && !next.content.size;
    const divider = paperSchema.nodes.divider.create({ id: $start.parent.attrs.id });
    const tr = state.tr.replaceWith(pos, after, reuse ? [divider] : [divider, paperSchema.nodes.paragraph.create()]);
    return tr.setSelection(TextSelection.create(tr.doc, pos + divider.nodeSize + 1)).scrollIntoView();
  });
}

export function editorBlocks(state) {
  const blocks = [];
  state.doc.forEach((node, pos) => blocks.push({ id: node.attrs.id, node, pos }));
  return blocks;
}

export function selectedEditorBlocks(state) {
  const { from, to } = state.selection;
  return editorBlocks(state).filter(({ node, pos }) => pos < to && pos + node.nodeSize > from && (from === to || to !== pos + 1));
}

export function moveEditorBlocks(state, ids, destination) {
  const blocks = editorBlocks(state), plan = planBlockMove(blocks, { type: "blocks-move", blockIds: ids, ...destination });
  if (!plan.changed) return null;
  const nodes = new Map(blocks.map(block => [block.id, block.node]));
  const tr = closeHistory(state.tr).replaceWith(0, state.doc.content.size, plan.order.map(id => nodes.get(id)));
  const positions = new Map(); let pos = 0;
  for (const id of plan.order) { positions.set(id, pos); pos += nodes.get(id).nodeSize; }
  const selected = selectedEditorBlocks(state);
  if (state.selection instanceof TextSelection && selected.length && selected.every(block => ids.includes(block.id))) {
    const remap = point => {
      const block = blocks.find(block => point > block.pos && point < block.pos + block.node.nodeSize);
      if (block && !ids.includes(block.id) && point === state.selection.to) {
        const last = selected.at(-1);
        return positions.get(last.id) + last.node.nodeSize - 1;
      }
      return block ? positions.get(block.id) + point - block.pos : point;
    };
    tr.setSelection(TextSelection.create(tr.doc, remap(state.selection.anchor), remap(state.selection.head)));
  } else tr.setSelection(Selection.near(tr.doc.resolve(positions.get(ids[0]) + 1)));
  return tr.scrollIntoView();
}

/** Leave the entire current Block, including multi-item lists and code. */
export function nextEditorBlock(state) {
  const blocks = editorBlocks(state), head = state.selection.head;
  const found = blocks.findIndex(block => head >= block.pos && head < block.pos + block.node.nodeSize);
  const index = found < 0 ? blocks.length - 1 : found, current = blocks[index];
  const next = blocks[index + 1];
  if (next) return state.tr.setSelection(Selection.near(state.doc.resolve(next.pos), 1)).scrollIntoView();
  return editBlock(state, current.id, "add");
}

export function editBlock(state, id, action, { slash = false } = {}) {
  const block = editorBlocks(state).find(block => block.id === id);
  if (!block) return null;
  const { node, pos } = block;
  let tr = closeHistory(state.tr);
  if (action === "add") {
    tr.insert(pos + node.nodeSize, paperSchema.nodes.paragraph.create());
    return tr.setSelection(TextSelection.near(tr.doc.resolve(pos + node.nodeSize + 1))).scrollIntoView();
  }
  if (action === "delete") {
    if (state.doc.childCount === 1) tr.replaceWith(0, node.nodeSize, paperSchema.nodes.paragraph.create({ id }));
    else tr.delete(pos, pos + node.nodeSize);
    return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
  }
  const source = paperToBlocks(paperSchema.nodes.doc.create(null, [node]))[0];
  const replacement = blockToPaper({ ...source, type: action, text: slash || action === "divider" ? "" : source.text });
  tr.replaceWith(pos, pos + node.nodeSize, replacement);
  return tr.setSelection(Selection.near(tr.doc.resolve(pos + (replacement.isTextblock ? 1 : 0)))).scrollIntoView();
}
