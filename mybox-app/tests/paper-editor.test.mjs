import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, TextSelection } from "prosemirror-state";
import { splitBlock } from "prosemirror-commands";
import { history, closeHistory, undo, redo } from "prosemirror-history";
import { paperSchema, blocksToPaper, paperToBlocks, stableBlockIds } from "../src/knowledge/paper-document.js";
import { planDocumentEdit, sameDocument } from "../src/knowledge/document-edit.js";
import { createPaperSaveSession } from "../src/knowledge/paper-save.js";
import { editBlock, moveEditorBlocks, nextEditorBlock, selectedEditorBlocks, dividerInputRule } from "../src/knowledge/block-editor-actions.js";
import { BLOCK_TYPES } from "../src/knowledge/domain.js";
import { AppHost } from "../src/core/app-host.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createKnowledgeApp } from "../src/knowledge/app.js";
import { createProjectDoc, seedPage, readPage, applyPageMutation, encodeState, applyUpdate } from "../src/knowledge/yjs-document.js";

const block = (id, text, type = "paragraph") => ({ id, text, type, checked: false, links: [], revision: 1, updatedBy: "author" });
const initial = [block("a", "Alpha"), block("b", "Beta"), block("c", "Gamma")];
const options = { types: BLOCK_TYPES, actorId: "editor", canLink: () => true };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };

test("paper projection round-trips every existing Block kind and untouched Markdown bytes", () => {
  const blocks = BLOCK_TYPES.map((type, i) => block(`type-${i}`, type === "divider" ? "" : type === "image" ? "knowledge-file:image?w=70" : type === "url-embed" ? "https://example.test" : "日本語 **太字**\nsecond", type));
  blocks.push({...block("link", "[[Target]] と $x+y$ %%#abcdef;color%%"), links:[{targetPageId:"target",token:"[[Target]]"}]});
  assert.deepEqual(paperToBlocks(blocksToPaper(blocks), blocks), blocks);
});

test("Enter splits with stable identities and text undo/redo preserves earlier typing", () => {
  let ids=0;
  let state=EditorState.create({doc:blocksToPaper(initial),plugins:[stableBlockIds(()=>`new-${++ids}`),history()]});
  const dispatch=tr=>{state=state.applyTransaction(tr).state;};
  dispatch(state.tr.setSelection(TextSelection.create(state.doc,6)).insertText(" first"));
  dispatch(closeHistory(state.tr));
  dispatch(state.tr.insertText(" second"));
  assert.equal(undo(state,dispatch),true);
  assert.equal(state.doc.firstChild.textContent,"Alpha first");
  assert.equal(redo(state,dispatch),true);
  assert.equal(state.doc.firstChild.textContent,"Alpha first second");
  dispatch(state.tr.setSelection(TextSelection.create(state.doc,3)));
  splitBlock(state,dispatch);
  const blocks=paperToBlocks(state.doc,initial);
  assert.equal(blocks[0].id,"a");
  assert.notEqual(blocks[1].id,"a");
  assert.equal(new Set(blocks.map(b=>b.id)).size,blocks.length);
  assert.deepEqual(blocks.slice(-2).map(b=>b.id),["b","c"]);
});

test("edited text preserves nested formatting and literal Markdown punctuation on reopening", () => {
  const { nodes, marks } = paperSchema;
  const doc = nodes.doc.create(null, [nodes.paragraph.create({ id: "a" }, [
    paperSchema.text("bold", [marks.bold.create()]),
    paperSchema.text("both", [marks.bold.create(), marks.italic.create()]),
    paperSchema.text("all", [marks.bold.create(), marks.italic.create(), marks.underline.create()]),
    paperSchema.text(" plain **stars** __literal__ <tag> $cash$ "),
  ])]);
  const serialized = paperToBlocks(doc);
  assert.deepEqual(blocksToPaper(serialized).toJSON(), doc.toJSON());
});

test("cross-paragraph selection deletes a text range and Undo restores both paragraphs", () => {
  let state=EditorState.create({doc:blocksToPaper(initial),plugins:[stableBlockIds(),history()]});
  const dispatch=tr=>{state=state.applyTransaction(tr).state;};
  dispatch(state.tr.setSelection(TextSelection.create(state.doc,3,10)).deleteSelection());
  assert.equal(state.doc.childCount,2);
  assert.equal(state.doc.firstChild.textContent,"Alta");
  undo(state,dispatch);
  assert.deepEqual(paperToBlocks(state.doc,initial),initial);
});

test("inline Block actions preserve IDs, move selected Blocks together and remain undoable", () => {
  let state = EditorState.create({ doc: blocksToPaper(initial), plugins: [stableBlockIds(), history()] });
  const dispatch = tr => { if (tr) state = state.applyTransaction(tr).state; };
  dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 10)));
  const ids = selectedEditorBlocks(state).map(block => block.id);
  assert.deepEqual(ids, ["a", "b"]);
  dispatch(moveEditorBlocks(state, ids, { direction: "down" }));
  assert.deepEqual(paperToBlocks(state.doc).map(block => block.id), ["c", "a", "b"]);
  assert.deepEqual(selectedEditorBlocks(state).map(block => block.id), ["a", "b"]);
  assert.equal(state.doc.textBetween(state.selection.from, state.selection.to), "AlphaBe");
  undo(state, dispatch);
  assert.deepEqual(paperToBlocks(state.doc).map(block => block.id), ["a", "b", "c"]);
  dispatch(editBlock(state, "b", "heading-2"));
  assert.equal(state.doc.child(1).type.name, "heading");
  assert.equal(state.doc.child(1).attrs.id, "b");
  assert.equal(state.doc.child(1).textContent, "Beta");
  dispatch(editBlock(state, "b", "add"));
  assert.equal(state.doc.child(2).textContent, "");
  dispatch(editBlock(state, "a", "delete"));
  assert.deepEqual(paperToBlocks(state.doc).filter(block => block.text).map(block => block.text), ["Beta", "Gamma"]);
});

test("slash choice creates a typed Block and deleting the last Block leaves an editable line", () => {
  let state = EditorState.create({ doc: blocksToPaper([block("a", "/")]), plugins: [stableBlockIds()] });
  state = state.applyTransaction(editBlock(state, "a", "checklist", { slash: true })).state;
  assert.equal(state.doc.firstChild.type.name, "checklist");
  assert.equal(state.doc.firstChild.textContent, "");
  state = state.applyTransaction(editBlock(state, "a", "delete")).state;
  assert.equal(state.doc.firstChild.type.name, "paragraph");
  assert.equal(state.doc.firstChild.attrs.id, "a");
});

test("typing --- restores a divider with a following editable line and stable identity", () => {
  const rule = dividerInputRule();
  for (const trailing of [[], [block("b", "")], [block("b", "existing")]]) {
    let state = EditorState.create({ doc: blocksToPaper([block("a", "--"), ...trailing]), plugins: [stableBlockIds(), history()] });
    state = state.applyTransaction(rule.handler(state, rule.match.exec("---"), 1, 3)).state;
    assert.equal(state.doc.firstChild.type.name, "divider");
    assert.equal(state.doc.firstChild.attrs.id, "a");
    assert.equal(state.doc.child(1).type.name, "paragraph");
    assert.equal(state.doc.child(1).textContent, "");
    assert.equal(state.doc.childCount, trailing[0]?.text ? 3 : 2);
    assert.equal(state.selection.$from.parent.type.name, "paragraph");
    undo(state, tr => { state = state.applyTransaction(tr).state; });
    assert.equal(state.doc.firstChild.textContent, "--");
  }
  const code = EditorState.create({ doc: blocksToPaper([block("a", "--", "code")]) });
  assert.equal(rule.handler(code, rule.match.exec("---"), 1, 3), null);
  const middle = EditorState.create({ doc: blocksToPaper([block("a", "--tail")]) });
  assert.equal(rule.handler(middle, rule.match.exec("---"), 1, 3), null);
  assert.equal(rule.match.test("\\---"), false);
  assert.equal(rule.match.test("text---"), false);
});

test("backward multi-Block selection survives repeated moves and excludes the next line's start", () => {
  let state = EditorState.create({ doc: blocksToPaper(initial) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 10, 2)));
  state = state.apply(moveEditorBlocks(state, ["a", "b"], { direction: "down" }));
  assert.ok(state.selection.anchor > state.selection.head);
  state = state.apply(moveEditorBlocks(state, selectedEditorBlocks(state).map(b => b.id), { direction: "up" }));
  assert.equal(state.selection.anchor, 10); assert.equal(state.selection.head, 2);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 8)));
  assert.deepEqual(selectedEditorBlocks(state).map(b => b.id), ["a"]);
  state = state.apply(moveEditorBlocks(state, ["a"], { direction: "down" }));
  assert.deepEqual(selectedEditorBlocks(state).map(b => b.id), ["a"]);
});

test("Ctrl Enter exits lists and code, reuses the next Block and adds a trailing paragraph only when needed", () => {
  for (const type of ["bulleted-list", "numbered-list", "code", "checklist", "paragraph"]) {
    let state = EditorState.create({ doc: blocksToPaper([block("a", "one\ntwo", type), block("b", "next")]), plugins: [stableBlockIds()] });
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(2))));
    state = state.applyTransaction(nextEditorBlock(state)).state;
    assert.equal(state.doc.childCount, 2);
    assert.equal(selectedEditorBlocks(state)[0].id, "b");
    state = state.applyTransaction(nextEditorBlock(state)).state;
    assert.equal(state.doc.childCount, 3);
    assert.equal(state.doc.lastChild.type.name, "paragraph");
    assert.equal(state.doc.lastChild.textContent, "");
    assert.equal(state.doc.child(1).textContent, "next");
  }
});

test("document edit keeps unrelated current edits and rejects changed/deleted text or concurrent structure before writes", () => {
  const next=structuredClone(initial);next[0].text="Alpha edit";
  const current=structuredClone(initial);current[2].text="Remote Gamma";
  const planned=planDocumentEdit(current,initial,next,options);
  assert.equal(planned[2].text,"Remote Gamma");assert.equal(planned[0].text,"Alpha edit");
  current[0].text="Remote Alpha";
  assert.throws(()=>planDocumentEdit(current,initial,next,options),/DOCUMENT_EDIT_CONFLICT/);
  assert.throws(()=>planDocumentEdit([...initial,block("remote","new")],initial,next.slice(1),options),/DOCUMENT_EDIT_CONFLICT/);
  assert.throws(()=>planDocumentEdit(initial,initial,[next[0],next[0]],options),/INVALID_DOCUMENT_EDIT/);
  assert.equal(current[0].text,"Remote Alpha");
});

test("autosave serializes newer typing, uses acknowledged base and retains failed drafts for retry", async () => {
  const first=deferred(), calls=[];
  const page={id:"page",projectId:"project",revision:1,blocks:initial};
  let fail=false;
  const session=createPaperSaveSession(page,async(target,mutation)=>{
    calls.push({target,mutation});
    if(calls.length===1) await first.promise;
    if(fail) throw Error("disk failure");
    return {page:{...target,revision:target.revision+1,blocks:mutation.documentBlocks}};
  });
  const firstDraft=structuredClone(initial);firstDraft[0].text="one";session.edit(firstDraft);
  const pending=session.flush();await Promise.resolve();
  const nextDraft=structuredClone(firstDraft);nextDraft[0].text="two";session.edit(nextDraft);
  assert.equal(session.flush(),pending);
  first.resolve();await pending;
  assert.equal(calls.length,2);assert.equal(calls[1].mutation.baseBlocks[0].text,"one");
  assert.equal(calls[1].target.id,"page");assert.equal(session.dirty,false);
  fail=true;nextDraft[0].text="retained";session.edit(nextDraft);await session.flush();
  assert.equal(session.dirty,true);assert.match(session.error.message,/disk/);
  fail=false;await session.flush();assert.equal(session.error,null);assert.equal(session.dirty,false);
});

test("newer typing does not overwrite an unrelated remote edit returned by an in-flight save", async () => {
  const first = deferred(); let count = 0, stored = structuredClone(initial);
  const page = { id: "page", projectId: "project", revision: 1, blocks: initial };
  const session = createPaperSaveSession(page, async (target, mutation) => {
    if (++count === 1) { await first.promise; stored[2].text = "Remote Gamma"; }
    stored = planDocumentEdit(stored, mutation.baseBlocks, mutation.documentBlocks, options);
    return { page: { ...target, revision: target.revision + 1, blocks: stored } };
  });
  const draft = structuredClone(initial); draft[0].text = "one"; session.edit(draft);
  const pending = session.flush(); await Promise.resolve();
  draft[0].text = "two"; session.edit(draft); first.resolve(); await pending;
  assert.equal(count, 2); assert.equal(session.error, null); assert.equal(session.dirty, false);
  assert.deepEqual(session.draft.map(b => b.text), ["two", "Beta", "Remote Gamma"]);
});

test("document mutation persists through Host restart", async () => {
  const driver=new MemoryStorageDriver(),host=new AppHost({storageDriver:driver});host.register(createKnowledgeApp());
  const actor={type:"user",id:"local-user"}, invoke=(id,input)=>host.invoke(id,input,{actor});
  const {projects}=await invoke("knowledge.project.list",{}),projectId=projects[0].id;
  let {page}=await invoke("knowledge.page.create",{projectId,title:"Paper test"});
  const next=[{...page.blocks[0],text:"written"},block("new-line","second")];
  ({page}=await invoke("knowledge.page.update",{projectId,pageId:page.id,expectedRevision:page.revision,mutation:{type:"document-edit",baseBlocks:page.blocks,documentBlocks:next}}));
  assert.deepEqual(page.blocks.map(b=>b.text),["written","second"]);
  const reloaded=new AppHost({storageDriver:driver});reloaded.register(createKnowledgeApp());
  assert.deepEqual((await reloaded.invoke("knowledge.page.read",{projectId,pageId:page.id},{actor})).page.blocks,page.blocks);
});

test("Yjs document edit preserves untouched Y.Text, checks conflicts atomically and reaches another peer", () => {
  const doc=createProjectDoc(),other=createProjectDoc();seedPage(doc,{id:"page",title:"Paper",state:"active",blocks:initial});
  const before=readPage(doc,"page").blocks,next=structuredClone(before);next[0].text="changed";next.splice(1,0,block("added","new"));
  applyPageMutation(doc,"page",{type:"document-edit",baseBlocks:before,documentBlocks:next},{actorId:"editor"});
  const saved=readPage(doc,"page");assert.deepEqual(saved.blocks.map(b=>b.id),["a","added","b","c"]);
  applyUpdate(other,encodeState(doc));assert.deepEqual(readPage(other,"page"),saved);
  const stale=structuredClone(before);stale[0].text="stale";
  assert.throws(()=>applyPageMutation(doc,"page",{type:"document-edit",baseBlocks:before,documentBlocks:stale}),/DOCUMENT_EDIT_CONFLICT/);
  assert.deepEqual(readPage(doc,"page"),saved);
  const record=createProjectDoc();seedPage(record,{id:"record",kind:"conversation",title:"Record",state:"active",blocks:initial});
  assert.throws(()=>applyPageMutation(record,"record",{type:"document-edit",baseBlocks:initial,documentBlocks:next}),/IMMUTABLE_RECORD/);
});
