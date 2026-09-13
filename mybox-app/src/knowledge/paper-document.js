import { Schema } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { fromMarkdown } from "mdast-util-from-markdown";

const id = { default: null };
const domAttrs = node => node.attrs.id ? { id: `record-${node.attrs.id}`, "data-block-id": node.attrs.id } : {};
const textBlock = (tag, extra = {}) => ({ group: "block", content: "inline*", attrs: { id },
  parseDOM: [{ tag }], toDOM: node => [tag, domAttrs(node), 0], ...extra });
export const paperSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: textBlock("p"),
    heading: textBlock("h1", { attrs: { id, level: { default: 1 } },
      parseDOM: [1, 2, 3].map(level => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: node => [`h${node.attrs.level}`, domAttrs(node), 0] }),
    quote: textBlock("blockquote"),
    code: textBlock("pre", { content: "text*", marks: "", code: true, whitespace: "pre", toDOM: node => ["pre", domAttrs(node), ["code", 0]] }),
    math: textBlock("pre", { content: "text*", marks: "", code: true, whitespace: "pre", parseDOM: [{ tag: "pre[data-math]" }], toDOM: node => ["pre", { ...domAttrs(node), "data-math": "true", class: "paper-math" }, 0] }),
    checklist: textBlock("p", { attrs: { id, checked: { default: false } }, parseDOM: [{ tag: "p[data-checklist]", getAttrs: dom => ({ checked: dom.dataset.checked === "true" }) }],
      toDOM: node => ["p", { ...domAttrs(node), "data-checklist": "true", "data-checked": String(node.attrs.checked), class: "paper-checklist" }, 0] }),
    bullet_list: { group: "block", content: "list_item+", attrs: { id }, parseDOM: [{ tag: "ul" }], toDOM: node => ["ul", domAttrs(node), 0] },
    ordered_list: { group: "block", content: "list_item+", attrs: { id }, parseDOM: [{ tag: "ol" }], toDOM: node => ["ol", domAttrs(node), 0] },
    list_item: { content: "paragraph", defining: true, parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] },
    divider: { group: "block", atom: true, attrs: { id }, parseDOM: [{ tag: "hr" }], toDOM: node => ["hr", domAttrs(node)] },
    media: { group: "block", atom: true, attrs: { id, kind: { default: "image" }, text: { default: "" } },
      // No image/iframe paste rule: remote media must never be loaded implicitly.
      toDOM: node => ["div", { ...domAttrs(node), class: "paper-media" }, node.attrs.kind === "image" ? "画像" : node.attrs.text] },
    text: { group: "inline" },
    hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
  },
  marks: {
    bold: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
    italic: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    underline: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
    strike: { parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["s", 0] },
    color: { attrs: { color: {} }, toDOM: mark => ["span", { style: /^#[\da-f]{6}$/i.test(mark.attrs.color) ? `color: ${mark.attrs.color}` : "" }, 0] },
    inline_math: { toDOM: () => ["span", { class: "paper-inline-math" }, 0] },
    page_link: { attrs: { targetPageId: {} }, inclusive: false, toDOM: mark => ["span", { "data-page-link": mark.attrs.targetPageId, class: "paper-page-link" }, 0] },
  },
});

function inline(text, links = [], inherited = []) {
  return text.split("\n").flatMap((line, index) => {
    const held = [];
    let prefix = "\uE000"; while (line.includes(prefix)) prefix += "\uE000";
    const hold = nodes => `${prefix}${held.push(nodes) - 1}\uE001`;
    // Protect Knowledge's inline extensions while CommonMark parses nested
    // emphasis. These temporary tokens never enter stored text or the DOM.
    let source = line;
    for (const link of links) source = source.split(link.token).join(hold(inline(link.token.slice(2, -2), [], [...inherited, paperSchema.marks.page_link.create({ targetPageId: link.targetPageId })])));
    source = source.replace(/(?<!\\)(\$([^$\n]+)\$|%%#([\da-f]{6});(.+?)%%|__(.+?)__|~~(.+?)~~)/gi, (all, _, math, color, colored, underlined, struck) => {
      const mark = math !== undefined ? paperSchema.marks.inline_math.create() : color ? paperSchema.marks.color.create({ color: `#${color}` }) : paperSchema.marks[underlined !== undefined ? "underline" : "strike"].create();
      return hold(math !== undefined ? [paperSchema.text(math, [...inherited, mark])] : inline(colored ?? underlined ?? struck, [], [...inherited, mark]));
    });
    // A sentinel prevents a paragraph's literal '# ', '> ' or indentation from
    // being reinterpreted as a different Block type by the Markdown parser.
    const parseSource = `x${source}x`, parsed = fromMarkdown(parseSource);
    let first = true;
    const visit = (node, marks) => {
      if (node.type === "root" || node.type === "paragraph") return node.children.flatMap(child => visit(child, marks));
      if (node.type === "strong" || node.type === "emphasis") return node.children.flatMap(child => visit(child, [...marks, paperSchema.marks[node.type === "strong" ? "bold" : "italic"].create()]));
      let value = node.type === "text" ? node.value : parseSource.slice(node.position.start.offset, node.position.end.offset);
      if (first) { value = value.slice(1); first = false; }
      return value.split(new RegExp(`(${prefix}\\d+\uE001)`)).flatMap(part => {
        if (!part) return [];
        if (part.startsWith(prefix)) return held[Number(part.slice(prefix.length, -1))].map(item => item.mark([...marks, ...item.marks].reduce((set, mark) => mark.addToSet(set), [])));
        return [paperSchema.text(part, marks)];
      });
    };
    const result = visit(parsed, inherited), last = result.pop();
    if (last.text.length > 1) result.push(last.withText(last.text.slice(0, -1)));
    return [...(index ? [paperSchema.nodes.hard_break.create()] : []), ...result];
  });
}

// Projection nodes are immutable. A bounded cache avoids reparsing every
// unchanged paragraph on each keystroke, even after autosave clones the draft.
const projectionCache = new Map();
let projectionCacheSize = 0;
export function blockToPaper(block) {
  const key = JSON.stringify([block.id, block.type, block.text, block.checked === true, block.links]);
  if (projectionCache.has(key)) return projectionCache.get(key);
  const node = createPaperBlock(block);
  projectionCache.set(key, node); projectionCacheSize += key.length;
  while (projectionCache.size > 512 || projectionCacheSize > 1_000_000) {
    const oldest = projectionCache.keys().next().value;
    projectionCache.delete(oldest); projectionCacheSize -= oldest.length;
  }
  return node;
}

function createPaperBlock(block) {
  const attrs = { id: block.id }, nodes = paperSchema.nodes;
  if (["image", "url-embed"].includes(block.type)) return nodes.media.create({ ...attrs, kind: block.type, text: block.text });
  if (block.type === "divider") return nodes.divider.create(attrs);
  if (["bulleted-list", "numbered-list"].includes(block.type)) return nodes[block.type === "bulleted-list" ? "bullet_list" : "ordered_list"].create(attrs,
    block.text.split("\n").map(line => nodes.list_item.create(null, nodes.paragraph.create(null, inline(line, block.links)))));
  const type = block.type.startsWith("heading-") ? "heading" : block.type;
  if (type === "heading") attrs.level = Number(block.type.slice(-1));
  if (type === "checklist") attrs.checked = block.checked === true;
  return (nodes[type] ?? nodes.paragraph).create(attrs, ["code", "math"].includes(type)
    ? (block.text ? paperSchema.text(block.text) : null) : inline(block.text, block.links));
}
export const blocksToPaper = blocks => paperSchema.nodes.doc.create(null, blocks.map(blockToPaper));

function inlineSource(node, links) {
  let output = "", open = [], linkStart = null;
  const wrap = mark => ({ bold: "**", italic: "*", underline: "__", strike: "~~", inline_math: "$", page_link: "[[" }[mark.type.name] ?? `%%${mark.attrs.color};`);
  const close = mark => mark.type.name === "page_link" ? "]]" : mark.type.name === "color" ? "%%" : wrap(mark);
  const transition = marks => {
    let shared = 0; while (shared < open.length && shared < marks.length && open[shared].eq(marks[shared])) shared++;
    for (let i = open.length - 1; i >= shared; i--) {
      output += close(open[i]);
      if (open[i].type.name === "page_link") links.push({ targetPageId: open[i].attrs.targetPageId, token: output.slice(linkStart) });
    }
    for (let i = shared; i < marks.length; i++) {
      if (marks[i].type.name === "page_link") linkStart = output.length;
      output += wrap(marks[i]);
    }
    open = marks;
  };
  node.forEach(child => {
    if (child.type.name === "hard_break") { transition([]); output += "\n"; return; }
    transition(child.marks);
    let value = child.text ?? "";
    if (!child.marks.some(mark => mark.type.name === "inline_math")) value = value.replace(/[\\*_~%$\[\]`<>]/g, "\\$&");
    output += value;
  });
  transition([]);
  return output;
}

export function paperToBlocks(doc, originals = []) {
  const byId = new Map(originals.map(block => [block.id, block]));
  const blocks = [];
  doc.forEach(node => {
    const original = byId.get(node.attrs.id);
    if (original && blockToPaper(original).eq(node)) { blocks.push(structuredClone(original)); return; }
    const kind = node.type.name, links = [];
    let type = kind, text;
    if (kind === "heading") type = `heading-${node.attrs.level}`;
    if (kind === "media") { type = node.attrs.kind; text = node.attrs.text; }
    else if (kind === "bullet_list" || kind === "ordered_list") {
      type = kind === "bullet_list" ? "bulleted-list" : "numbered-list";
      const lines = []; node.forEach(item => lines.push(inlineSource(item.firstChild, links))); text = lines.join("\n");
    } else text = ["code", "math"].includes(kind) ? node.textContent : inlineSource(node, links);
    blocks.push({ id: node.attrs.id, type, text, checked: node.attrs.checked === true, links });
  });
  return blocks;
}

export function stableBlockIds(makeId = () => `block-${crypto.randomUUID()}`) {
  return new Plugin({ appendTransaction(transactions, oldState, state) {
    if (!transactions.some(tr => tr.docChanged)) return null;
    const seen = new Set(), tr = state.tr;
    state.doc.forEach((node, pos) => {
      let blockId = node.attrs.id;
      if (!blockId || seen.has(blockId)) { blockId = makeId(); tr.setNodeMarkup(pos, null, { ...node.attrs, id: blockId }); }
      seen.add(blockId);
    });
    return tr.docChanged ? tr : null;
  } });
}
