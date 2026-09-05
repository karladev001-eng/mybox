import { useEffect, useRef, useState } from "react";
import { ThemedSelect } from "../ThemedSelect.jsx";
import { RecordedMessageBody } from "../ChatView.jsx";
import { ChatCircleDots } from "@phosphor-icons/react";

const labels = { complete: "完了", error: "失敗", interrupted: "中断", unknown: "結果不明", sending: "送信中", prepared: "準備中" };

function TurnDetail({ turn, client, onNavigate, targetBlockId }) {
  return <>
    <p className="record-notice">{turn.createdAt} · {labels[turn.status] ?? turn.status}</p>
    <p>{turn.question}</p>
    {turn.sources?.map((source) => <div className="record-source" key={`${source.projectId}:${source.pageId}`}>
      <button type="button" onClick={() => onNavigate(source.projectId, source.pageId, source.blocks?.[0]?.id)}>{source.title} · 参照元を開く</button>
      <details><summary>送信時の参照内容 · 版 {source.pageRevision}</summary><pre>{source.blocks.map((b) => b.text).join("\n\n")}</pre></details>
    </div>)}
    {turn.calls?.map((call, index) => <details key={call.id} id={`record-${call.id}`} open={targetBlockId === call.id ? true : undefined}><summary>モデル呼び出し {index + 1}</summary><pre>{call.text}</pre><details><summary>採用した履歴・モデル・設定</summary><pre>{JSON.stringify(call.call?.settings ?? {}, null, 2)}</pre></details></details>)}
    {turn.answers?.map((answer) => <section key={answer.id}><h4>回答</h4><RecordedMessageBody message={answer} onReadImage={(image) => client.readImage(image.resourceId)} /></section>)}
  </>;
}

function ShareRecordDialog({ page, turnIds, client, desktop, onClose, onCopied, onNavigate }) {
  const dialog = useRef(null);
  const [projects, setProjects] = useState([]), [target, setTarget] = useState("");
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const copyId = useRef(`page-${crypto.randomUUID()}`);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    let active = true;
    Promise.all([client.listProjects(), desktop ? client.listSyncEndpoints() : Promise.resolve([])]).then(([result, endpoints]) => {
      if (active) setProjects(result.projects.filter((p) => p.id !== page.projectId && p.role !== "viewer" && endpoints.some((e) => e.projectId === p.id)));
    }).catch((e) => active && setError(String(e.message || e)));
    return () => { active = false; previous?.focus?.(); };
  }, []);
  const input = { projectId: page.projectId, pageId: page.id, targetProjectId: target, turnIds };
  const prepare = async () => {
    setBusy(true); setError("");
    try { await client.prepareProjectSession(target); setPreview(await client.invoke("knowledge.context.share-preview.v2", input)); }
    catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); setError("");
    try {
      const result = await client.invoke("knowledge.context.share-copy.v2", { ...input, copyId: copyId.current, previewToken: preview.token });
      onCopied(result.page);
    } catch (e) { setError(String(e.message || e)); setPreview(null); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="knowledge-dialog record-share-dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} aria-labelledby="record-share-title">
    <h2 id="record-share-title">記録を共有Projectへコピー</h2>
    <p>選択した{turnIds.length}回の質問・回答・Contextを固定コピーします。Context内の過去の履歴と参照本文も共有されます。今後の会話は追加されません。</p>
    <ThemedSelect id="record-share-target" disabled={busy} label="共有先Project" value={target} onChange={(value) => { setTarget(value); setPreview(null); copyId.current = `page-${crypto.randomUUID()}`; }} options={[{ id: "", label: "共有先を選択" }, ...projects.map((p) => ({ id: p.id, label: p.name }))]} placement="bottom" />
    {!projects.length && <p>書き込み可能な共有Projectがありません。先に共有先のProjectを設定してください。</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <section className="record-share-preview" aria-label="共有内容のプレビュー"><h3>{projects.find((p) => p.id === target)?.name}へコピー</h3>{preview.turns.map((turn) => <details key={turn.id}><summary>{turn.question}</summary><TurnDetail turn={turn} client={client} onNavigate={onNavigate} /></details>)}</section>}
    <div className="knowledge-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>キャンセル</button><button type="button" disabled={busy || !target} onClick={preview ? commit : prepare}>{busy ? "処理中…" : preview ? "この内容を共有先へコピー" : "共有内容を確認"}</button></div>
  </dialog>;
}

export function ContextNotebook({ page, client, desktop, readOnly, onNavigate, targetBlockId }) {
  const [conversationLink, setConversationLink] = useState(null);
  const [turns, setTurns] = useState([]), [selected, setSelected] = useState([]), [sharing, setSharing] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    client.invoke("knowledge.context.read.v2", { projectId: page.projectId, pageId: page.id }).then((result) => { if (active) { setTurns(result.turns); setConversationLink(result.conversationLink); setError(""); } }).catch((e) => { if (active) { setConversationLink(null); setError(String(e.message || e)); } });
    return () => { active = false; };
  }, [page, client]);
  useEffect(() => { setSelected([]); setSharing(false); }, [page.id]);
  useEffect(() => { if (targetBlockId) document.getElementById(`record-${targetBlockId}`)?.scrollIntoView({ block: "center" }); }, [turns, targetBlockId]);
  const eligible = turns.filter((t) => !t.unavailable && t.status !== "sending" && t.status !== "prepared" && t.conversationAvailable !== false);
  return <div className="context-notebook">
    {conversationLink && <div className="context-session-relation"><button type="button" className="context-session-link" disabled={!conversationLink.available} aria-label={`セッション会話を開く：${conversationLink.title}`} onClick={() => onNavigate(conversationLink.projectId, conversationLink.pageId)}><ChatCircleDots size={16} aria-hidden="true" /><span>{conversationLink.title}</span></button>{!conversationLink.available && <small>削除済み、または閲覧権限がありません</small>}</div>}
    <p className="record-notice">{page.context?.sharedCopy ? "共有時点の固定記録" : "送信時の記録。参照元の編集・削除では変わりません。"}</p>
    {!readOnly && <div className="record-actions"><button type="button" disabled={!eligible.length} onClick={() => setSelected(selected.length === eligible.length ? [] : eligible.map((t) => t.id))}>{selected.length === eligible.length && selected.length ? "選択を解除" : "チャット全体を選択"}</button><button type="button" disabled={!selected.length} onClick={() => setSharing(true)}>共有Projectへコピー（{selected.length}）</button><button type="button" onClick={async () => { try { const result = await client.invoke("knowledge.record.extract.v1", { projectId: page.projectId, pageId: page.id }); onNavigate(result.page.projectId, result.page.id); } catch (e) { setError(String(e.message || e)); } }}>Noteへ切り出す</button></div>}
    {error && <p role="alert">{error}</p>}
    {turns.map((turn) => <section className="record-block" id={`record-${turn.id}`} key={turn.id}>
      {!readOnly && <label className="record-turn-selection"><input type="checkbox" disabled={!eligible.some((t) => t.id === turn.id)} checked={selected.includes(turn.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, turn.id] : selected.filter((id) => id !== turn.id))} />この送信を選択</label>}
      <details open={targetBlockId === turn.id || turn.calls?.some((call) => call.id === targetBlockId) ? true : undefined}><summary>{turn.question} · {labels[turn.status] ?? "参照不可"}<small className="record-turn-meta">{turn.createdAt ? new Date(turn.createdAt).toLocaleString("ja-JP") : "日時不明"} · 参照 {turn.sources?.length ?? 0}件</small></summary>
        {!turn.unavailable && <TurnDetail turn={turn} client={client} onNavigate={onNavigate} targetBlockId={targetBlockId} />}
        {turn.legacy && <button type="button" onClick={() => onNavigate(turn.legacy.projectId, turn.legacy.pageId)}>旧Context Pageを開く</button>}
        {!page.context?.sharedCopy && <button type="button" onClick={() => onNavigate(page.context.conversationProjectId ?? page.projectId, page.context.conversationId, turn.messageId)}>会話の発言へ移動</button>}
      </details>
    </section>)}
    {sharing && <ShareRecordDialog page={page} turnIds={selected} client={client} desktop={desktop} onNavigate={onNavigate} onClose={() => setSharing(false)} onCopied={(copy) => { setSharing(false); onNavigate(copy.projectId, copy.id); }} />}
  </div>;
}
