import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readChatImage } from "./desktop/agent-providers.js";
import {
  ArrowSquareOut,
  ArrowLeft,
  ChatCircleDots,
  DownloadSimple,
  GearSix,
  GlobeHemisphereWest,
  ImageSquare,
  MagicWand,
  MagnifyingGlass,
  NotePencil,
  PaperPlaneTilt,
  Plus,
  Robot,
  SidebarSimple,
  Sparkle,
  Trash,
  Wrench,
  UserCircle,
  X,
} from "@phosphor-icons/react";

const suggestions = [
  "今日やることを整理して",
  "アイデアを一緒に深掘りして",
  "文章を分かりやすく整えて",
];

function dateGroup(value) {
  const updated = new Date(value);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const updatedStart = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate());
  const days = Math.floor((todayStart - updatedStart) / 86_400_000);
  if (days <= 0) return "今日";
  if (days < 7) return "過去7日";
  return "以前";
}

function shortTime(value) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

function messageTime(value) {
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function ChatIconButton({ label, children, ...props }) {
  return <button type="button" className="chat-icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

async function openSource(url) {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function ChatGeneratedImage({ image, fallbackAlt }) {
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setDataUrl("");
    setError("");
    readChatImage(image.resourceId)
      .then((value) => active && setDataUrl(value))
      .catch((reason) => active && setError(String(reason)));
    return () => { active = false; };
  }, [image.resourceId]);

  const alt = image.revisedPrompt || fallbackAlt || "AIが生成した画像";
  return (
    <figure className="generated-image" aria-busy={!dataUrl && !error}>
      {dataUrl ? (
        <>
          <img src={dataUrl} alt={alt} />
          <a href={dataUrl} download={`mybox-${image.resourceId}`} aria-label="生成画像を保存" title="生成画像を保存">
            <DownloadSimple size={18} aria-hidden="true" />
          </a>
        </>
      ) : error ? (
        <p role="alert">画像を読み込めませんでした。</p>
      ) : (
        <span className="generated-image-placeholder"><ImageSquare size={28} aria-hidden="true" /></span>
      )}
      {image.revisedPrompt && <figcaption>{image.revisedPrompt}</figcaption>}
    </figure>
  );
}

export function ChatView({
  history,
  activeSessionId,
  value,
  busy,
  providerName,
  providerReady,
  providerLabels,
  persistenceReady,
  webSearchEnabled,
  webSearchSupported,
  onToggleWebSearch,
  skills,
  skillsSupported,
  skillsLoading,
  selectedSkillIds,
  onToggleSkill,
  imageGenerationEnabled,
  imageGenerationSupported,
  onToggleImageGeneration,
  onBack,
  onOpenSettings,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onChange,
  onSend,
}) {
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const messageListRef = useRef(null);
  const composerRef = useRef(null);
  const cancelRenameRef = useRef(false);
  const sessions = history.sessions;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const selectedToolCount = selectedSkillIds.length + (imageGenerationEnabled ? 1 : 0);
  const visibleSkills = useMemo(() => {
    const needle = skillQuery.trim().toLocaleLowerCase("ja-JP");
    if (!needle) return skills;
    return skills.filter((skill) => `${skill.displayName} ${skill.description}`.toLocaleLowerCase("ja-JP").includes(needle));
  }, [skillQuery, skills]);

  const groupedSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ja-JP");
    const filtered = needle
      ? sessions.filter((session) => session.title.toLocaleLowerCase("ja-JP").includes(needle)
        || session.messages.some((message) => message.content.toLocaleLowerCase("ja-JP").includes(needle)))
      : sessions;
    return ["今日", "過去7日", "以前"]
      .map((label) => ({ label, sessions: filtered.filter((session) => dateGroup(session.updatedAt) === label) }))
      .filter((group) => group.sessions.length);
  }, [query, sessions]);

  useEffect(() => {
    const node = messageListRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activeSessionId, activeSession?.messages.length, busy]);

  useEffect(() => {
    if (activeSession && activeSession.messages.length === 0) composerRef.current?.focus();
  }, [activeSession]);

  useEffect(() => {
    if (!toolPickerOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setToolPickerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [toolPickerOpen]);

  const submit = (event) => {
    event.preventDefault();
    if (!busy && value.trim()) {
      setToolPickerOpen(false);
      onSend(value.trim());
    }
  };

  const startRename = (session) => {
    cancelRenameRef.current = false;
    setEditingId(session.id);
    setDraftTitle(session.title);
  };

  const finishRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setEditingId(null);
      return;
    }
    const sessionId = editingId;
    const title = draftTitle.trim();
    setEditingId(null);
    if (sessionId && title) onRenameSession(sessionId, title);
  };

  const confirmDelete = (session) => {
    if (window.confirm(`「${session.title}」を削除しますか？`)) onDeleteSession(session.id);
  };

  return (
    <section className={`chat-view${sidebarOpen ? "" : " sidebar-closed"}`} aria-label="AIチャット">
      <aside className="chat-sidebar" id="chat-session-sidebar" aria-label="チャット履歴">
        <div className="chat-sidebar-heading">
          <div><Robot size={25} weight="duotone" aria-hidden="true" /><strong>AIチャット</strong></div>
          <ChatIconButton label="履歴を閉じる" onClick={() => setSidebarOpen(false)}><X size={20} /></ChatIconButton>
        </div>
        <button type="button" className="new-chat-button" onClick={onNewSession}>
          <NotePencil size={20} aria-hidden="true" /><span>新しいチャット</span><Plus size={17} aria-hidden="true" />
        </button>
        <label className="chat-search">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <span className="sr-only">会話を検索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="会話を検索" />
        </label>
        <div className="chat-session-list">
          {groupedSessions.map((group) => (
            <section key={group.label} className="chat-session-group" aria-labelledby={`chat-group-${group.label}`}>
              <h2 id={`chat-group-${group.label}`}>{group.label}</h2>
              {group.sessions.map((session) => (
                <div key={session.id} className={`chat-session-row${session.id === activeSessionId ? " active" : ""}`}>
                  {editingId === session.id ? (
                    <input
                      className="chat-title-input"
                      value={draftTitle}
                      autoFocus
                      aria-label="チャット名"
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={finishRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenameRef.current = true;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="chat-session-select"
                      aria-current={session.id === activeSessionId ? "page" : undefined}
                      onClick={() => { onSelectSession(session.id); if (window.innerWidth <= 760) setSidebarOpen(false); }}
                    >
                      <span>{session.title}</span>
                      <small>{session.messages.at(-1)?.content ?? "まだメッセージはありません"}</small>
                    </button>
                  )}
                  <time dateTime={session.updatedAt}>{shortTime(session.updatedAt)}</time>
                  <div className="chat-session-actions">
                    <ChatIconButton label={`${session.title}の名前を変更`} onClick={() => startRename(session)}><NotePencil size={17} /></ChatIconButton>
                    <ChatIconButton label={`${session.title}を削除`} onClick={() => confirmDelete(session)}><Trash size={17} /></ChatIconButton>
                  </div>
                </div>
              ))}
            </section>
          ))}
          {!groupedSessions.length && <p className="chat-history-empty">一致する会話はありません</p>}
        </div>
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <div className="chat-header-leading">
            <ChatIconButton label="アプリ一覧へ戻る" onClick={onBack}><ArrowLeft size={21} /></ChatIconButton>
            {!sidebarOpen && <ChatIconButton label="履歴を開く" aria-controls="chat-session-sidebar" aria-expanded={false} onClick={() => setSidebarOpen(true)}><SidebarSimple size={21} /></ChatIconButton>}
            <div>
              <h1>{activeSession?.title ?? "新しいチャット"}</h1>
              <span><span className={`provider-dot${providerReady ? "" : " disconnected"}`} aria-hidden="true" />{providerName}{providerReady ? "" : "・未接続"}</span>
            </div>
          </div>
          <button type="button" className="new-chat-compact" aria-label="新しいチャット" title="新しいチャット" onClick={onNewSession}><Plus size={19} aria-hidden="true" /><span>新規</span></button>
        </header>

        <div ref={messageListRef} className="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">
          {!activeSession?.messages.length ? (
            <div className="chat-welcome">
              <span><ChatCircleDots size={38} weight="duotone" aria-hidden="true" /></span>
              <h2>今日は何を一緒に進めますか？</h2>
              <p>会話はこのワークスペースに保存され、あとから続けられます。</p>
              <div className="chat-suggestions">
                {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => { onChange(suggestion); composerRef.current?.focus(); }}>{suggestion}</button>)}
              </div>
            </div>
          ) : (
            <div className="chat-message-column">
              {activeSession.messages.map((message) => (
                <article key={message.id} className={`chat-message ${message.role}${message.status === "error" ? " error" : ""}`}>
                  <span className="message-avatar" aria-hidden="true">
                    {message.role === "user" ? <UserCircle size={24} weight="fill" /> : <Sparkle size={22} weight="fill" />}
                  </span>
                  <div>
                    <header>
                      <strong>{message.role === "user" ? "あなた" : "MyBox AI"}</strong>
                      {message.role === "assistant" && message.providerId && <span>{providerLabels[message.providerId] ?? message.providerId}</span>}
                      <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
                    </header>
                    <p>{message.content}</p>
                    {(message.imageRequested || message.skills?.length > 0) && (
                      <div className="message-tools" aria-label="使用したツール">
                        {message.imageRequested && <span><ImageSquare size={14} aria-hidden="true" />画像生成</span>}
                        {message.skills?.map((skill) => <span key={skill.id}><MagicWand size={14} aria-hidden="true" />{skill.name}</span>)}
                      </div>
                    )}
                    {message.image && <ChatGeneratedImage image={message.image} fallbackAlt={message.content} />}
                    {message.sources?.length > 0 && (
                      <nav className="message-sources" aria-label="回答の出典">
                        <span><GlobeHemisphereWest size={15} aria-hidden="true" />出典</span>
                        <div>
                          {message.sources.map((source, index) => (
                            <button
                              type="button"
                              key={source.url}
                              title={source.url}
                              onClick={() => openSource(source.url)}
                            >
                              <span>{index + 1}</span>{source.title}<ArrowSquareOut size={14} aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </nav>
                    )}
                  </div>
                </article>
              ))}
              {busy && (
                <article className="chat-message assistant pending" aria-label="AIが回答を作成中">
                  <span className="message-avatar" aria-hidden="true"><Sparkle size={22} weight="fill" /></span>
                  <div><header><strong>MyBox AI</strong><span>{providerName}</span></header><p><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></p></div>
                </article>
              )}
            </div>
          )}
        </div>

        <form className="chat-composer" onSubmit={submit} aria-busy={busy}>
          {toolPickerOpen && (
            <section className="tool-picker" id="chat-tool-picker" aria-label="チャットツール">
              <header>
                <div><Wrench size={18} aria-hidden="true" /><strong>ツール</strong></div>
                <ChatIconButton label="ツールを閉じる" onClick={() => setToolPickerOpen(false)}><X size={17} /></ChatIconButton>
              </header>
              <button
                type="button"
                className={`tool-option image-option${imageGenerationEnabled ? " active" : ""}`}
                aria-pressed={imageGenerationEnabled}
                disabled={busy || !imageGenerationSupported}
                onClick={onToggleImageGeneration}
              >
                <span><ImageSquare size={21} weight={imageGenerationEnabled ? "fill" : "regular"} aria-hidden="true" /></span>
                <span><strong>画像生成</strong><small>{imageGenerationSupported ? "会話内に画像を生成" : "現在の接続では利用できません"}</small></span>
                <span aria-hidden="true">{imageGenerationEnabled ? "ON" : ""}</span>
              </button>
              <div className="skill-picker-heading">
                <span><MagicWand size={17} aria-hidden="true" />スキル</span>
                {selectedSkillIds.length > 0 && <small>{selectedSkillIds.length}/4</small>}
              </div>
              {skillsSupported && skills.length > 6 && (
                <label className="skill-search">
                  <MagnifyingGlass size={16} aria-hidden="true" />
                  <span className="sr-only">スキルを検索</span>
                  <input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="スキルを検索" />
                </label>
              )}
              <div className="skill-options">
                {skillsLoading ? <p>読み込み中…</p> : !skillsSupported ? <p>ChatGPT接続で利用できます。</p> : !visibleSkills.length ? <p>利用できるスキルがありません。</p> : visibleSkills.map((skill) => {
                  const selected = selectedSkillIds.includes(skill.id);
                  const selectionLimit = selectedSkillIds.length >= 4 && !selected;
                  return (
                    <button
                      type="button"
                      key={skill.id}
                      className={`tool-option skill-option${selected ? " active" : ""}`}
                      aria-pressed={selected}
                      disabled={busy || selectionLimit}
                      onClick={() => onToggleSkill(skill.id)}
                    >
                      <span><MagicWand size={18} weight={selected ? "fill" : "regular"} aria-hidden="true" /></span>
                      <span><strong>{skill.displayName}</strong><small>{skill.description || skill.scope}</small></span>
                      {skill.requiresTools && <span title="外部ツールを必要とする場合があります">連携</span>}
                    </button>
                  );
                })}
              </div>
              <p className="tool-picker-note">スキルは選択したターンだけ明示的に使用します。</p>
            </section>
          )}
          <label htmlFor="chat-message-input" className="sr-only">AIへのメッセージ</label>
          <textarea
            ref={composerRef}
            id="chat-message-input"
            value={value}
            rows={1}
            maxLength={64 * 1024}
            disabled={busy || !persistenceReady}
            placeholder={persistenceReady ? "メッセージを入力…" : "設定から保存場所を選択してください"}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="chat-composer-footer">
            <span>{providerName}</span>
            <button
              type="button"
              className={`tool-picker-toggle${selectedToolCount ? " active" : ""}`}
              aria-label={`ツールを${toolPickerOpen ? "閉じる" : "開く"}${selectedToolCount ? `、${selectedToolCount}件選択中` : ""}`}
              aria-expanded={toolPickerOpen}
              aria-controls="chat-tool-picker"
              title="スキルと画像生成"
              disabled={busy}
              onClick={() => setToolPickerOpen((open) => !open)}
            >
              <Wrench size={18} weight={selectedToolCount ? "fill" : "regular"} aria-hidden="true" />
              <span>ツール</span>
              {selectedToolCount > 0 && <b aria-hidden="true">{selectedToolCount}</b>}
            </button>
            <button
              type="button"
              className={`web-search-toggle${webSearchEnabled && webSearchSupported ? " active" : ""}`}
              aria-label={webSearchSupported ? `Web検索を${webSearchEnabled ? "無効" : "有効"}にする` : "このAIプロバイダーはWeb検索に未対応です"}
              aria-pressed={webSearchSupported ? webSearchEnabled : false}
              title={webSearchSupported ? `Web検索：${webSearchEnabled ? "オン" : "オフ"}` : "このAIプロバイダーはWeb検索に未対応です"}
              disabled={busy || !webSearchSupported}
              onClick={onToggleWebSearch}
            >
              <GlobeHemisphereWest size={18} weight={webSearchEnabled && webSearchSupported ? "fill" : "regular"} aria-hidden="true" />
              <span>Web</span>
            </button>
            <span className="composer-hint">Shift + Enterで改行</span>
            {!providerReady && <button type="button" className="chat-provider-settings" aria-label="AIプロバイダーを設定" title="AIプロバイダーを設定" onClick={onOpenSettings}><GearSix size={19} /><span>接続</span></button>}
            <button type="submit" aria-label="メッセージを送信" disabled={busy || !value.trim() || !persistenceReady}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <PaperPlaneTilt size={20} weight="fill" />}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
