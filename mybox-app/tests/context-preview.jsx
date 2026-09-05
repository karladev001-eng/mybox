import { AssistantResizeHandle } from "../src/AssistantResizeHandle.jsx";
import { createMyBoxAppRegistry } from "../src/apps/registry.js";
import { resolveAppKeyboardShortcut } from "../src/core/keyboard-shortcuts.js";
import { KnowledgeView } from "../src/knowledge/KnowledgeView.jsx";
// Manual UI fixture: real in-memory Operations, simulated shared destination;
// no provider calls, disk data or external sharing.
import { RecordedMessageBody } from "../src/ChatView.jsx";
import { RecordAction } from "../src/RecordAction.jsx";
import { Brain, NotePencil } from "@phosphor-icons/react";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ContextNotebook } from "../src/knowledge/ContextNotebook.jsx";
import { createKnowledgeClient } from "../src/knowledge/client.js";
import "../src/styles.css";
import "../src/knowledge/knowledge.css";

function samplePdf() {
  const stream = "BT /F1 24 Tf 50 720 Td (MyBox PDF preview) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"];
  let pdf = "%PDF-1.4\n", offsets = [0];
  objects.forEach((body, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(pdf);
}
const sampleAnswer = "## 週末の計画\n\n予定を比較しました。**移動時間に余裕を持つ**と、ゆっくり楽しめます。\n\n| 日程 | 行き先 | ポイント |\n|---|---|---|\n| 土曜日 | 公園 | 散歩とピクニック |\n| 日曜日 | 美術館 | 展示を見てからカフェへ |\n\n### 持ち物\n- 飲み物\n- 歩きやすい靴\n\n> 雨の場合は屋内の予定を優先します。\n\n```js\nconst weekend = ['公園', '美術館'];\n```";
const client = createKnowledgeClient();
const { projects } = await client.listProjects();
let conversationProjectId = projects[0].id;
const { project: record } = await client.createProject("Record");
if (new URLSearchParams(location.search).has("sameProject")) conversationProjectId = record.id;
const { project: shared } = await client.createProject("共有の検証先");
const { page: note } = await client.createPage(conversationProjectId, "旅行のメモ");
await client.invoke("knowledge.conversation.save.v1", { projectId: conversationProjectId, session: { id: "sample-conversation", title: "旅の計画", messages: [
  { id: "question", role: "user", content: "週末の計画をまとめて", createdAt: "2026-09-05T10:00:00Z" },
  { id: "answer", role: "assistant", content: sampleAnswer, createdAt: "2026-09-05T10:00:01Z" },
] } });
await client.invoke("knowledge.context.capture.v2", { projectId: record.id, conversationProjectId, conversationId: "sample-conversation", contextId: "sample-context", messageId: "question", callId: "sample-call", prompt: "User: 週末の計画をまとめて", settings: { model: "UI fixture", history: [{ id: "question", text: "週末の計画をまとめて" }] }, sources: [{ projectId: conversationProjectId, pageId: note.id, text: "" }] });
const { page: initial } = await client.invoke("knowledge.context.finish.v2", { projectId: record.id, pageId: "sample-context", messageId: "question", status: "complete" });
if (new URLSearchParams(location.search).has("library")) {
  const { page: folder } = await client.createPage(record.id, "資料");
  await client.invoke("knowledge.file.import.v1", { projectId: record.id, fileId: "sample-file", name: "サンプル.pdf", base64: samplePdf() });
}
let outlinePage;
if (new URLSearchParams(location.search).has("outline")) {
  let result = await client.createPage(record.id, "目次の検証");
  for (const [type, text] of [["heading-1", "アイデア箱"], ["paragraph", "本文の検証。\n".repeat(25)], ["heading-2", "コンセプト"], ["paragraph", "説明の検証。\n".repeat(25)], ["heading-3", "詳細"]]) {
    result = await client.updatePage(record.id, result.page.id, result.page.revision, { type: "block-add", blockType: type, text, afterBlockId: result.page.blocks.at(-1)?.id });
  }
  outlinePage = result.page.id;
}
const fixtureClient = { ...client, listSyncEndpoints: async () => [{ projectId: shared.id }] };
function Preview() {
  const [page, setPage] = useState(initial), [notice, setNotice] = useState("");
  return <main style={{ padding: 24, maxWidth: 900, margin: "auto", height: "100dvh", overflow: "auto" }}><h1>{page.title}</h1><p>UI検証用データ · 外部への送信なし</p>{notice && <p role="status">{notice}</p>}<section className="record-block"><header>MyBox AI</header><RecordedMessageBody message={{ content: sampleAnswer }} /><div className="record-actions"><RecordAction label="この送信のContext" icon={Brain} onClick={() => setNotice("Contextを表示")} /><RecordAction label="Noteへ切り出す" icon={NotePencil} onClick={() => setNotice("Noteへ切り出し")} /></div></section><ContextNotebook page={page} client={fixtureClient} desktop readOnly={false} onNavigate={async (projectId, pageId) => { const result = await client.readPage(projectId, pageId); if (result.page.kind === "context") setPage(result.page); else setNotice(`参照先: ${result.page.title}`); }} /></main>;
}
function WorkspacePreview() {
  const [shortcut, setShortcut] = useState(null), [width, setWidth] = useState(420);
  const panel = new URLSearchParams(location.search).has("resize");
  const target = useMemo(() => ({ projectId: record.id, pageId: outlinePage ?? (new URLSearchParams(location.search).has("library") ? "sample-file" : "sample-context") }), []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveAppKeyboardShortcut(createMyBoxAppRegistry().get("knowledge").shortcuts, event);
      if (command) { event.preventDefault(); setShortcut((last) => ({ shortcutId: command.id, sequence: (last?.sequence ?? 0) + 1 })); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <div className={`app-shell app-surface-mode${panel ? " assistant-panel-open" : ""}`} style={{ "--assistant-panel-width": `min(${width}px, calc(100vw - 360px))` }}>
    <KnowledgeView shortcutCommand={shortcut} recordTarget={target} />
    {panel && <><AssistantResizeHandle width={width} onChange={setWidth} /><aside className="chat-view assistant-panel" style={{ padding: 20 }}>アシスタントの幅を検証</aside></>}
  </div>;
}
createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).has("workspace") ? <WorkspacePreview /> : <Preview />);
