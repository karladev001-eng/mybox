import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Plus, FileText, ChatsCircle, ImageSquare, FolderOpen, ArrowUpRight, Clock } from "@phosphor-icons/react";
import { createKnowledgeClient } from "./knowledge/client.js";

const kinds = { note: "ノート", conversation: "会話", context: "Context", file: "ファイル" };
export function WorkspaceHome({ desktop, appRuntime, profileId, ready, onSearch, onCreate, onOpenPage, onOpenProject, onImage, onChat, onSettings }) {
  const client = useMemo(() => createKnowledgeClient({ desktop, appRuntime, getProfileId: () => profileId }), [desktop, appRuntime, profileId]);
  const [data, setData] = useState({ projects: [], pages: [] }), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!ready) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { projects } = await client.listProjects();
      const results = await Promise.allSettled(projects.map(async (project) => {
        await client.prepareProjectSession(project.id);
        const result = await client.listPages(project.id, false);
        return result.pages.map((page) => ({ ...page, projectId: project.id, projectName: project.name }));
      }));
      if (!active) return;
      setData({ projects, pages: results.flatMap((result) => result.status === "fulfilled" ? result.value : []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 12) });
      setError(results.some((result) => result.status === "rejected") ? "一部のProjectを読み込めませんでした。Projectを開いて確認してください。" : "");
    })().catch((reason) => active && setError(reason.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [client, ready]);
  return <section className="workspace-home" aria-labelledby="workspace-title">
    <header className="workspace-intro"><span className="workspace-eyebrow">MYBOX / WORKSPACE</span><h1 id="workspace-title">あなたの記録</h1><p>ノート、会話、そのときのコンテキスト。</p></header>
    <div className="workspace-entry"><button className="workspace-search" onClick={onSearch} disabled={!ready}><MagnifyingGlass size={20} /><span>Page・Projectを検索</span><kbd>Ctrl P</kbd></button><button className="workspace-create" onClick={onCreate} disabled={!ready}><Plus size={17} /><span>新しいPage</span><kbd>Ctrl N</kbd></button></div>
    {!ready && <button className="workspace-setup" onClick={onSettings}>保存場所を選択して始める<ArrowUpRight size={16} /></button>}
    {error && <p className="workspace-notice" role="alert">{error}</p>}
    <div className="workspace-columns"><section className="workspace-recents"><header><h2><Clock size={15} />最近の記録</h2><button onClick={onSearch} disabled={!ready}>すべて見る<ArrowUpRight size={14} /></button></header>
      {loading ? <p role="status" className="workspace-empty">記録を読み込んでいます…</p> : data.pages.length ? <div className="workspace-records">{data.pages.map((page) => <button data-record-kind={page.kind ?? "note"} key={`${page.projectId}/${page.id}`} onClick={() => onOpenPage(page.projectId, page.id)}><FileText size={18} /><span><strong>{page.title}</strong><small>{page.projectName} <span>·</span> {kinds[page.kind ?? "note"] ?? "ノート"}</small></span>{page.updatedAt && <time dateTime={page.updatedAt}>{new Date(page.updatedAt).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}</time>}<ArrowUpRight size={14} /></button>)}</div> : <div className="workspace-empty"><FileText size={26} /><p>最初の記録を、ここから。</p><button onClick={onCreate} disabled={!ready}>新しいPageを作成<Plus size={15} /></button></div>}
    </section><aside className="workspace-side"><section><h2>Project</h2>{data.projects.map((project) => <button className="workspace-project" key={project.id} onClick={() => onOpenProject(project.id)}><FolderOpen size={16} /><span>{project.name}</span><ArrowUpRight size={14} /></button>)}</section><section className="workspace-tools"><h2>つくる・考える</h2><button className="workspace-chat-tool" onClick={onChat}><ChatsCircle size={17} /><span>AIと話す</span><ArrowUpRight size={14} /></button>{onImage && <button className="workspace-image-tool" onClick={onImage}><ImageSquare size={17} /><span>画像をつくる</span><ArrowUpRight size={14} /></button>}</section></aside></div>
  </section>;
}
