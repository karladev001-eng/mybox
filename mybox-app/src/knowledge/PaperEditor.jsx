import { useEffect, useRef, useState } from "react";
import { EditorState, TextSelection, Selection } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { Plugin } from "prosemirror-state";
import { history, undo, redo, undoDepth, redoDepth } from "prosemirror-history";
import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { splitListItem, liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import { ArrowUDownLeft, ArrowUDownRight, TextB, TextItalic, TextUnderline, ListBullets, Copy, ArrowClockwise, DotsSixVertical, Plus, ArrowUp, ArrowDown, Trash, Check, Image as ImageIcon } from "@phosphor-icons/react";
import { paperSchema, blocksToPaper, paperToBlocks, stableBlockIds } from "./paper-document.js";
import { sameDocument } from "./document-edit.js";
import { createPaperSaveSession } from "./paper-save.js";
import { editorBlocks, selectedEditorBlocks, moveEditorBlocks, nextEditorBlock, editBlock, dividerInputRule } from "./block-editor-actions.js";
import "prosemirror-view/style/prosemirror.css";
import "./paper-editor.css";

function plugins() {
  const nodes = paperSchema.nodes;
  const move = direction => (state, dispatch) => {
    const tr = moveEditorBlocks(state, selectedEditorBlocks(state).map(block => block.id), { direction });
    if (tr) dispatch?.(tr); return true;
  };
  return [stableBlockIds(), history({ newGroupDelay: 500 }), new Plugin({ props: { decorations(state) {
    return DecorationSet.create(state.doc, editorBlocks(state).map(({ node, pos }) => Decoration.node(pos, pos + node.nodeSize, {
      "data-block-id": node.attrs.id,
      class: `paper-block${node.isTextblock && !node.content.size ? " paper-block-empty" : ""}${state.selection.from > pos && state.selection.from < pos + node.nodeSize ? " paper-block-active" : ""}`,
      "data-placeholder": "入力を始める、または / でブロックを選択",
    })));
  } } }), keymap({
    "Alt-ArrowUp": move("up"), "Alt-ArrowDown": move("down"),
    "Mod-Enter": (state, dispatch) => { dispatch?.(nextEditorBlock(state)); return true; },
    "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo,
    "Mod-b": toggleMark(paperSchema.marks.bold), "Mod-i": toggleMark(paperSchema.marks.italic), "Mod-u": toggleMark(paperSchema.marks.underline),
    Enter: chainCommands(splitListItem(nodes.list_item), baseKeymap.Enter),
    "Shift-Enter": chainCommands(exitCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView()); return true; }),
    Tab: sinkListItem(nodes.list_item), "Shift-Tab": liftListItem(nodes.list_item),
  }), keymap(baseKeymap), inputRules({ rules: [
    dividerInputRule(),
    textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, match => ({ level: match[1].length })),
    textblockTypeInputRule(/^>\s$/, nodes.quote), textblockTypeInputRule(/^```\s?$/, nodes.code),
    textblockTypeInputRule(/^\$\$$/, nodes.math),
    textblockTypeInputRule(/^-\s\[\s\]\s$/, nodes.checklist),
    wrappingInputRule(/^[-*]\s$/, nodes.bullet_list), wrappingInputRule(/^\d+\.\s$/, nodes.ordered_list),
  ] })];
}

export function PaperEditor({ page, profileId, readOnly, onCommit, onDirty, onReadImage, onOpenPage, onOpenUrl, onAddImage, sessions, focusRequest }) {
  const mount = useRef(null), surface = useRef(null), menuRef = useRef(null), viewRef = useRef(null), timer = useRef(null), latest = useRef(null), dragging = useRef(null);
  const [activeBlock, setActiveBlock] = useState(null), [menu, setMenu] = useState(null), [dropTop, setDropTop] = useState(null);
  const [dragCount, setDragCount] = useState(0);
  latest.current = { page, readOnly, onCommit, onDirty, onReadImage, onOpenPage, onOpenUrl };
  const [, refresh] = useState(0);
  const cacheKey = `${profileId}:${page.projectId}:${page.id}`;
  if (!sessions.has(cacheKey)) {
    const save = onCommit;
    sessions.set(cacheKey, { session: createPaperSaveSession(page, (target, mutation) => save(mutation, target)), state: null });
    if (sessions.size > 20) {
      for (const [key, entry] of sessions) {
        if (key !== cacheKey && !entry.session.dirty && !entry.session.saving) { sessions.delete(key); break; }
      }
    }
  }
  const entry = sessions.get(cacheKey), session = entry.session;
  const locateBlock = id => {
    const view = viewRef.current, block = view && editorBlocks(view.state).find(block => block.id === id);
    const dom = block && view.nodeDOM(block.pos);
    return dom ? { id, top: dom.getBoundingClientRect().top - surface.current.getBoundingClientRect().top } : null;
  };
  const openBlockMenu = (id, slash = false) => { const block = locateBlock(id); if (block) { setActiveBlock(block); setMenu({ ...block, slash }); } };
  useEffect(() => {
    let alive = true;
    const report = () => {
      if (!alive) return;
      const view = viewRef.current;
      // A save may include an unrelated remote change. Adopt it before the next
      // keystroke can accidentally submit the older visible text again.
      if (view && !session.dirty && !view.composing && !sameDocument(paperToBlocks(view.state.doc, session.draft), session.draft)) {
        const next = EditorState.create({ doc: blocksToPaper(session.draft), plugins: plugins() });
        entry.state = next.apply(next.tr.setSelection(TextSelection.near(next.doc.resolve(Math.min(view.state.selection.from, next.doc.content.size)))));
        view.updateState(entry.state);
      }
      latest.current.onDirty?.(session.dirty); refresh(value => value + 1);
    };
    const unsubscribe = session.subscribe(report);
    const state = entry.state ?? EditorState.create({ doc: blocksToPaper(session.draft), plugins: plugins() });
    const view = new EditorView(mount.current, {
      state,
      editable: () => !latest.current.readOnly,
      attributes: { role: "textbox", "aria-label": "本文", "aria-multiline": "true", spellcheck: "false" },
      handleKeyDown(view, event) {
        if (event.altKey && event.key === "Enter" && !latest.current.readOnly && !view.composing) {
          const block = selectedEditorBlocks(view.state)[0]; if (block) openBlockMenu(block.id); return true;
        }
        return false;
      },
      nodeViews: {
        checklist(node, view, getPos) {
          const dom = document.createElement("p"), contentDOM = document.createElement("span"), button = document.createElement("button");
          dom.className = "paper-checklist"; dom.id = `record-${node.attrs.id}`;
          button.type = "button"; button.contentEditable = "false"; button.className = "paper-check-toggle";
          const update = next => {
            if (next.type.name !== "checklist") return false;
            node = next; button.setAttribute("aria-label", node.attrs.checked ? "チェックを外す" : "チェックする");
            button.setAttribute("aria-pressed", String(node.attrs.checked)); button.disabled = latest.current.readOnly; return true;
          };
          update(node); dom.append(button, contentDOM);
          button.addEventListener("click", () => { if (!latest.current.readOnly) view.dispatch(view.state.tr.setNodeMarkup(getPos(), null, { ...node.attrs, checked: !node.attrs.checked })); });
          return { dom, contentDOM, update, stopEvent: event => event.target === button };
        },
        media(node) {
          const dom = document.createElement("div"); dom.className = "paper-media"; dom.id = `record-${node.attrs.id}`;
          dom.contentEditable = "false";
          let active = true;
          if (node.attrs.kind === "image") {
            dom.textContent = "画像を読み込み中…";
            const [resourceId, options = ""] = node.attrs.text.split("?");
            const width = Number(new URLSearchParams(options).get("w"));
            latest.current.onReadImage(resourceId).then(result => {
              if (!active) return;
              const src = typeof result === "string" ? result : result.dataUri;
              if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(src ?? "")) throw new Error("Invalid image");
              const image = document.createElement("img"); image.src = src; image.alt = "埋め込み画像"; image.draggable = false;
              if (width > 0 && width <= 100) image.style.width = `${width}%`;
              dom.replaceChildren(image);
            }).catch(() => { if (active) dom.textContent = "画像を読み込めません"; });
          } else {
            const button = document.createElement("button"); button.type = "button"; button.textContent = node.attrs.text;
            button.addEventListener("click", () => { if (/^https?:\/\//.test(node.attrs.text)) latest.current.onOpenUrl?.(node.attrs.text); }); dom.append(button);
          }
          return { dom, stopEvent: event => event.target.tagName === "BUTTON", destroy: () => { active = false; } };
        },
      },
      handleClick(view, pos, event) {
        const link = event.target.closest("[data-page-link]");
        if (link && (event.ctrlKey || event.metaKey)) { latest.current.onOpenPage?.(link.dataset.pageLink); return true; }
        if (latest.current.readOnly) return false;
        // Clicking the blank area after the last paragraph always starts writing.
        if (event.target === view.dom) {
          const last = view.dom.lastElementChild;
          if (!last || event.clientY >= last.getBoundingClientRect().bottom) {
            let tr = view.state.tr;
            if (!tr.doc.lastChild.isTextblock || tr.doc.lastChild.content.size) tr = tr.insert(tr.doc.content.size, paperSchema.nodes.paragraph.create());
            view.dispatch(tr.setSelection(Selection.atEnd(tr.doc))); view.focus(); return true;
          }
        }
        return false;
      },
      dispatchTransaction(tr) {
        if (latest.current.readOnly && tr.docChanged) return;
        const result = view.state.applyTransaction(tr); view.updateState(result.state); entry.state = result.state;
        const focused = selectedEditorBlocks(result.state)[0];
        if (focused) setActiveBlock(locateBlock(focused.id));
        if (result.transactions.some(item => item.docChanged)) {
          session.edit(paperToBlocks(result.state.doc, session.draft));
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => { if (!view.composing) session.flush(); }, 400);
          const block = selectedEditorBlocks(result.state)[0];
          if (!view.composing && block?.node.isTextblock && /^[\/／]$/.test(block.node.textContent)) openBlockMenu(block.id, true);
          else setMenu(null);
        }
        refresh(value => value + 1);
      },
      handleDOMEvents: {
        focus: view => { const block = selectedEditorBlocks(view.state)[0]; if (block) setActiveBlock(locateBlock(block.id)); return false; },
        dragover: (view, event) => {
          if (!dragging.current || latest.current.readOnly) return false;
          event.preventDefault(); event.dataTransfer.dropEffect = "move";
          const target = event.target.closest("[data-block-id]") ?? view.dom.lastElementChild;
          if (target) { const rect = target.getBoundingClientRect(); setDropTop((event.clientY > rect.top + rect.height / 2 ? rect.bottom : rect.top) - surface.current.getBoundingClientRect().top); }
          return true;
        },
        drop: (view, event) => {
          if (!dragging.current || latest.current.readOnly) return false;
          event.preventDefault();
          const target = event.target.closest("[data-block-id]");
          const blocks = editorBlocks(view.state), index = blocks.findIndex(block => block.id === target?.dataset.blockId);
          const after = target && event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
          const beforeBlockId = index < 0 ? null : blocks[index + (after ? 1 : 0)]?.id ?? null;
          const tr = moveEditorBlocks(view.state, dragging.current, { beforeBlockId });
          dragging.current = null; setDragCount(0); setDropTop(null); if (tr) view.dispatch(tr); view.focus(); return true;
        },
        blur: () => { window.clearTimeout(timer.current); session.flush(); return false; },
        compositionend: () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => session.flush(), 400); return false; },
      },
    });
    viewRef.current = view; report();
    return () => {
      alive = false; unsubscribe(); window.clearTimeout(timer.current); entry.state = view.state;
      view.destroy(); viewRef.current = null; session.flush(); latest.current.onDirty?.(false);
    };
  }, [cacheKey]);

  useEffect(() => {
    const view = viewRef.current;
    const changed = session.receive(page);
    if (!view) return;
    view.setProps({ editable: () => !readOnly });
    view.dom.querySelectorAll(".paper-check-toggle").forEach(button => { button.disabled = readOnly; });
    if (changed && !sameDocument(paperToBlocks(view.state.doc, session.draft), session.draft)) {
      const next = EditorState.create({ doc: blocksToPaper(session.draft), plugins: plugins() });
      const pos = Math.min(view.state.selection.from, next.doc.content.size);
      entry.state = next.apply(next.tr.setSelection(TextSelection.near(next.doc.resolve(pos))));
      view.updateState(entry.state);
    }
  }, [page.blocks, readOnly]);
  useEffect(() => { if (focusRequest && !readOnly) viewRef.current?.focus(); }, [focusRequest, readOnly]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector("button:not(:disabled)")?.focus();
    const close = event => { if (!menuRef.current?.contains(event.target) && !event.target.closest(".paper-block-handle")) setMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const command = action => { const view = viewRef.current; if (!view || readOnly) return; action(view.state, tr => view.dispatch(tr), view); view.focus(); };
  const state = viewRef.current?.state;
  const applyBlock = action => {
    const view = viewRef.current; if (!view || readOnly || !menu) return;
    const selected = selectedEditorBlocks(view.state).map(block => block.id);
    const ids = selected.includes(menu.id) ? selected : [menu.id];
    const tr = ["up", "down"].includes(action) ? moveEditorBlocks(view.state, ids, { direction: action }) : editBlock(view.state, menu.id, action, { slash: menu.slash });
    if (tr) view.dispatch(tr); setMenu(null); view.focus();
  };
  return <section ref={surface} className="paper-editor" data-dragging={dragCount > 0} aria-label="ブロックエディタ" onMouseMove={event => {
    if (menu || readOnly || dragging.current) return;
    const target = event.target.closest("[data-block-id]");
    if (target) setActiveBlock(locateBlock(target.dataset.blockId));
  }} onMouseLeave={() => { if (!menu) setActiveBlock(null); }}>
    {!readOnly && state && !state.selection.empty && !menu && !dragCount && <div className="paper-toolbar" role="toolbar" aria-label="選択したテキストの編集">
      <button type="button" aria-label="元に戻す" data-tooltip="元に戻す · Ctrl Z" disabled={!state || undoDepth(state) === 0} onMouseDown={event => event.preventDefault()} onClick={() => command(undo)}><ArrowUDownLeft size={16} /></button>
      <button type="button" aria-label="やり直す" data-tooltip="やり直す · Ctrl Y" disabled={!state || redoDepth(state) === 0} onMouseDown={event => event.preventDefault()} onClick={() => command(redo)}><ArrowUDownRight size={16} /></button>
      {[["bold", "太字", TextB], ["italic", "斜体", TextItalic], ["underline", "下線", TextUnderline]].map(([mark, label, Icon]) => <button key={mark} type="button" aria-label={label} data-tooltip={label} aria-pressed={Boolean(state && (state.selection.empty ? paperSchema.marks[mark].isInSet(state.storedMarks ?? state.selection.$from.marks()) : state.doc.rangeHasMark(state.selection.from, state.selection.to, paperSchema.marks[mark])))} onMouseDown={event => event.preventDefault()} onClick={() => command(toggleMark(paperSchema.marks[mark]))}><Icon size={16} /></button>)}
      <button type="button" aria-label="箇条書き" data-tooltip="箇条書き" onMouseDown={event => event.preventDefault()} onClick={() => command(wrapInList(paperSchema.nodes.bullet_list))}><ListBullets size={16} /></button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => command(setBlockType(paperSchema.nodes.paragraph))}>本文</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => command(setBlockType(paperSchema.nodes.heading, { level: 2 }))}>見出し</button>
    </div>}
    {!readOnly && activeBlock && <div className="paper-block-handle" style={{ top: activeBlock.top }}>
      <button type="button" aria-label="下にブロックを追加" data-tooltip="下に追加" onMouseDown={event => event.preventDefault()} onClick={() => {
        const view = viewRef.current, tr = editBlock(view.state, activeBlock.id, "add"); if (tr) view.dispatch(tr); view.focus();
      }}><Plus size={16} /></button>
      <button type="button" aria-label="ブロックの操作" data-tooltip="ドラッグで移動 · Alt ↑ / ↓" aria-haspopup="menu" aria-expanded={Boolean(menu)} draggable
        onClick={() => openBlockMenu(activeBlock.id)}
        onDragStart={event => {
          const selected = selectedEditorBlocks(viewRef.current.state).map(block => block.id);
          dragging.current = selected.includes(activeBlock.id) ? selected : [activeBlock.id];
          setDragCount(dragging.current.length);
          event.dataTransfer.setData("application/x-mybox-block", activeBlock.id); event.dataTransfer.effectAllowed = "move";
          const preview = document.createElement("div"); preview.className = "paper-drag-preview";
          preview.textContent = `${dragging.current.length}個のブロックを移動`;
          document.body.append(preview); event.dataTransfer.setDragImage(preview, 16, 16);
          requestAnimationFrame(() => preview.remove()); setMenu(null);
        }} onDragEnd={() => { dragging.current = null; setDragCount(0); setDropTop(null); }}><DotsSixVertical size={16} /></button>
    </div>}
    {dropTop !== null && <div className="paper-drop-marker" aria-hidden="true" style={{ top: dropTop }} />}
    {!readOnly && menu && <div ref={menuRef} className="paper-block-menu" role="menu" aria-label="ブロックの操作" style={{ top: Math.min(menu.top + 36, Math.max(0, window.innerHeight - surface.current.getBoundingClientRect().top - 360)) }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); setMenu(null); viewRef.current?.focus(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const buttons = [...menuRef.current.querySelectorAll("button:not(:disabled)")], index = buttons.indexOf(document.activeElement);
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      } else if (event.key === "Tab") setMenu(null);
    }}>
      {[["paragraph", "テキスト"], ["heading-1", "見出し1"], ["heading-2", "見出し2"], ["heading-3", "見出し3"], ["bulleted-list", "箇条書き"], ["numbered-list", "番号付きリスト"], ["checklist", "チェックリスト"], ["quote", "引用"], ["code", "コード"], ["math", "数式"], ["divider", "区切り線"]].map(([type, label]) => {
        const checked = session.draft.find(block => block.id === menu.id)?.type === type;
        return <button key={type} role="menuitemradio" aria-checked={checked} type="button" onClick={() => applyBlock(type)}><span className="paper-menu-check">{checked && <Check size={16} />}</span>{label}</button>;
      })}
      <div className="paper-menu-divider" />
      <button role="menuitem" type="button" disabled={!onAddImage || session.dirty} onClick={() => { setMenu(null); onAddImage?.(); }}><ImageIcon size={16} />画像を追加</button>
      {!menu.slash && <><button role="menuitem" type="button" disabled={editorBlocks(state)[0]?.id === menu.id} onClick={() => applyBlock("up")}><ArrowUp size={16} />上へ移動</button>
      <button role="menuitem" type="button" disabled={editorBlocks(state).at(-1)?.id === menu.id} onClick={() => applyBlock("down")}><ArrowDown size={16} />下へ移動</button>
      <button role="menuitem" type="button" onClick={() => applyBlock("delete")}><Trash size={16} />削除</button></>}
    </div>}
    {session.error && <div className="paper-save-error" role="alert"><span>{session.error.message}</span>
      <button type="button" onClick={() => session.flush()} disabled={session.saving}><ArrowClockwise size={16} />再試行</button>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(viewRef.current.state.doc.textBetween(0, viewRef.current.state.doc.content.size, "\n")); } catch { viewRef.current?.focus(); } }}><Copy size={16} />入力をコピー</button>
    </div>}
    <div ref={mount} />
  </section>;
}
