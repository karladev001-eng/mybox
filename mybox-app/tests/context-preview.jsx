import { KnowledgeView } from "../src/knowledge/KnowledgeView.jsx";
// Manual UI fixture: real in-memory Operations, simulated shared destination;
// no provider calls, disk data or external sharing.
import { RecordedMessageBody } from "../src/ChatView.jsx";
import { RecordAction } from "../src/RecordAction.jsx";
import { Brain, NotePencil } from "@phosphor-icons/react";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ContextNotebook } from "../src/knowledge/ContextNotebook.jsx";
import { createKnowledgeClient } from "../src/knowledge/client.js";
import "../src/styles.css";
import "../src/knowledge/knowledge.css";

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
const fixtureClient = { ...client, listSyncEndpoints: async () => [{ projectId: shared.id }] };
function Preview() {
  const [page, setPage] = useState(initial), [notice, setNotice] = useState("");
  return <main style={{ padding: 24, maxWidth: 900, margin: "auto", height: "100dvh", overflow: "auto" }}><h1>{page.title}</h1><p>UI検証用データ · 外部への送信なし</p>{notice && <p role="status">{notice}</p>}<section className="record-block"><header>MyBox AI</header><RecordedMessageBody message={{ content: sampleAnswer }} /><div className="record-actions"><RecordAction label="この送信のContext" icon={Brain} onClick={() => setNotice("Contextを表示")} /><RecordAction label="Noteへ切り出す" icon={NotePencil} onClick={() => setNotice("Noteへ切り出し")} /></div></section><ContextNotebook page={page} client={fixtureClient} desktop readOnly={false} onNavigate={async (projectId, pageId) => { const result = await client.readPage(projectId, pageId); if (result.page.kind === "context") setPage(result.page); else setNotice(`参照先: ${result.page.title}`); }} /></main>;
}
createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).has("workspace") ? <KnowledgeView recordTarget={{ projectId: record.id, pageId: "sample-context" }} /> : <Preview />);
