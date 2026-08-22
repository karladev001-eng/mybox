import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowUDownLeft,
  CaretRight,
  Check,
  ClockCounterClockwise,
  DotsSixVertical,
  FileText,
  FolderSimplePlus,
  Gear,
  Image as ImageIcon,
  Link as LinkIcon,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  Palette,
  PencilSimple,
  Plus,
  Robot,
  ShieldCheck,
  SidebarSimple,
  Tag,
  UsersThree,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
  Trash,
  X,
} from "@phosphor-icons/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ThemedSelect } from "../ThemedSelect.jsx";
import { LOCAL_PROFILE_ID } from "../core/account-identity.js";
import { AUTHOR_COLOR_PALETTE, authorColorFor } from "./author-color.js";
import { createKnowledgeClient } from "./client.js";
import { decodeInviteLink, encodeInviteLink } from "./invite-link.js";
import { createSharedProject } from "./shared-project.js";
import {
  applyColorWrap,
  buildInlineNodes,
  groupedListEnter,
  indentTextSelection,
  isGroupedListType,
  markdownConversion,
  parsePastedBlocks,
  splitListItems,
  toggleInlineWrap,
} from "./editor-behavior.js";
import { filterUsedTagCandidates, hasTagDelimiterAtEnd, isTagCommitKey, splitTagDraft } from "./tag-behavior.js";
import { filterPageSearchCandidates, pageSearchKeyAction } from "./search-behavior.js";
import "./knowledge.css";

const TEXT_COLOR_PRESETS = Object.freeze(["ff6b6b", "ffa94d", "ffd43b", "69db7c", "4dabf7", "748ffc", "b197fc", "f783ac"]);

const blockLabels = Object.freeze({
  paragraph: "本文",
  "heading-1": "見出し1",
  "heading-2": "見出し2",
  "heading-3": "見出し3",
  "bulleted-list": "箇条書き",
  "numbered-list": "番号付き",
  checklist: "チェック",
  quote: "引用",
  code: "コード",
  divider: "区切り",
  math: "数式",
  "url-embed": "URL",
  image: "画像",
});

function displayError(error) {
  const messages = {
    PAGE_TITLE_CONFLICT: "同じタイトルのPageが、このProjectまたはTrashにあります。",
    REVISION_CONFLICT: "別の変更が先に保存されました。Pageを読み直して再度お試しください。",
    PROJECT_ROLE_REQUIRED: "現在のProject roleでは、この操作を実行できません。",
    PAGE_IN_TRASH: "編集する前にPageを復元してください。",
    INVALID_PAGE_TITLE: "Pageタイトルを入力してください。",
  };
  return messages[error?.code] ?? `操作を完了できません：${error?.message ?? String(error)}`;
}

function normalized(value) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("ja-JP");
}

/** The card shows a hostname even for a URL too malformed to open; `text` is untrusted input. */
function urlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

const IMAGE_MIN_WIDTH_PERCENT = 10;

/** An image Block reuses `text` for an opaque resource ID, optionally suffixed with `?w=<percent>` to record a chosen display width. */
function parseImageBlockText(text) {
  const [resourceId, widthQuery] = (text || "").split("?w=");
  const parsed = Number(widthQuery);
  const widthPercent = Number.isFinite(parsed) && parsed > 0
    ? Math.min(100, Math.max(IMAGE_MIN_WIDTH_PERCENT, Math.round(parsed)))
    : 100;
  return { resourceId, widthPercent };
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderMathHtml(source) {
  try {
    return katex.renderToString(source || "", { throwOnError: false, output: "html" });
  } catch {
    return String(source ?? "");
  }
}

function InlineMath({ source, display = false }) {
  const html = useMemo(() => renderMathHtml(source), [source]);
  const Tag = display ? "div" : "span";
  return <Tag className={`knowledge-inline-math${display ? " display" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderInlineText(text, links, onOpenPage) {
  const nodes = buildInlineNodes(text, links);
  if (!nodes.length) return <span className="knowledge-empty-copy">入力して書き始める</span>;
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case "link":
        return (
          <button
            key={key}
            type="button"
            className="knowledge-inline-link"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPage(node.targetPageId);
            }}
          >
            <LinkIcon size={15} aria-hidden="true" />
            {node.value}
          </button>
        );
      case "bold":
        return <strong key={key}>{node.value}</strong>;
      case "italic":
        return <em key={key}>{node.value}</em>;
      case "underline":
        return <u key={key}>{node.value}</u>;
      case "strike":
        return <s key={key}>{node.value}</s>;
      case "color":
        return <span key={key} style={{ color: node.color }}>{node.value}</span>;
      case "math":
        return <InlineMath key={key} source={node.value} />;
      default:
        return <span key={key}>{node.value}</span>;
    }
  });
}

function ConfirmDialog({ title, description, actionLabel, onConfirm, onClose }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="knowledge-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="knowledge-dialog" role="alertdialog" aria-modal="true" aria-labelledby="knowledge-dialog-title" aria-describedby="knowledge-dialog-description">
        <div className="knowledge-dialog-icon"><Trash size={25} aria-hidden="true" /></div>
        <h2 id="knowledge-dialog-title">{title}</h2>
        <p id="knowledge-dialog-description">{description}</p>
        <div className="knowledge-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onClose}>キャンセル</button>
          <button type="button" className="knowledge-danger-button" onClick={onConfirm}><Trash size={18} aria-hidden="true" />{actionLabel}</button>
        </div>
      </section>
    </div>
  );
}

/**
 * Setting up sharing. The server secret proves the caller operates the server
 * and is used once to claim a Project; an invite admits everyone else without
 * ever revealing that secret.
 */
function ShareDialog({
  mode,
  busy,
  invite,
  inviteEndpoint,
  inviteProjectId,
  projectName,
  onConnect,
  onJoin,
  onInvite,
  onClose,
  onCloudflareStatus,
  onSaveCloudflareCredentials,
  onClearCloudflareCredentials,
  onDeployShare,
  onDeleteWorker,
}) {
  const [endpoint, setEndpoint] = useState("");
  const [secret, setSecret] = useState("");
  const [sharedProjectId, setSharedProjectId] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [joinLink, setJoinLink] = useState("");
  const [joinManual, setJoinManual] = useState(false);
  const [joinLinkError, setJoinLinkError] = useState("");
  const [connectManual, setConnectManual] = useState(false);
  const [cfStatus, setCfStatus] = useState(null);
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfSavingCredentials, setCfSavingCredentials] = useState(false);
  const [cfDeleting, setCfDeleting] = useState(false);
  const [cfError, setCfError] = useState("");

  useEffect(() => {
    if (mode !== "connect") return undefined;
    let active = true;
    onCloudflareStatus()
      .then((result) => { if (active) setCfStatus(result); })
      .catch(() => { if (active) setCfStatus({ configured: false, workerUrl: null }); });
    return () => { active = false; };
  }, [mode, onCloudflareStatus]);

  const saveCloudflareCredentials = async (event) => {
    event.preventDefault();
    setCfSavingCredentials(true);
    setCfError("");
    try {
      await onSaveCloudflareCredentials(cfAccountId.trim(), cfApiToken.trim());
      setCfApiToken("");
      setCfStatus({ configured: true, workerUrl: null });
    } catch (nextError) {
      setCfError(String(nextError?.message ?? nextError));
    } finally {
      setCfSavingCredentials(false);
    }
  };

  const deployAndShare = async () => {
    setCfError("");
    try {
      await onDeployShare();
    } catch (nextError) {
      setCfError(String(nextError?.message ?? nextError));
    }
  };

  const deleteWorker = async () => {
    setCfDeleting(true);
    setCfError("");
    try {
      await onDeleteWorker();
      setCfStatus((current) => current && { ...current, workerUrl: null });
    } catch (nextError) {
      setCfError(String(nextError?.message ?? nextError));
    } finally {
      setCfDeleting(false);
    }
  };

  /** Forgets the stored Account ID and API token so a different one can be entered. */
  const changeCloudflareCredentials = async () => {
    setCfError("");
    try {
      await onClearCloudflareCredentials();
      setCfAccountId("");
      setCfApiToken("");
      setCfStatus({ configured: false, workerUrl: null });
    } catch (nextError) {
      setCfError(String(nextError?.message ?? nextError));
    }
  };

  const titles = {
    connect: "このProjectを共有する",
    join: "招待から参加する",
    invite: "メンバーを招待する",
  };

  const inviteLink = invite && inviteEndpoint && inviteProjectId
    ? encodeInviteLink({ endpoint: inviteEndpoint, projectId: inviteProjectId, invite })
    : "";

  const submitJoinLink = (event) => {
    event.preventDefault();
    const decoded = decodeInviteLink(joinLink);
    if (!decoded) {
      setJoinLinkError("招待リンクを確認してください。相手からもう一度送ってもらうか、下の手動入力を使ってください。");
      return;
    }
    onJoin(decoded);
  };

  return (
    <div className="knowledge-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="knowledge-dialog knowledge-share-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-share-title">
        <h2 id="knowledge-share-title">{titles[mode]}</h2>

        {mode === "connect" && !connectManual && (
          <div>
            <p>「{projectName}」を同期サーバーに接続します。サーバーはあなたのCloudflareアカウントで動き、MyBoxは一切保持しません。</p>
            {cfStatus === null && <small className="form-note">Cloudflareの設定を確認中…</small>}
            {cfStatus?.configured ? (
              <>
                {cfStatus.workerUrl && <small className="form-note">既存のサーバー：{cfStatus.workerUrl}</small>}
                {cfError && <small className="form-note form-note-error">{cfError}</small>}
                <div className="knowledge-dialog-actions knowledge-dialog-actions-split">
                  <div>
                    <button type="button" className="knowledge-link-button" onClick={() => setConnectManual(true)}>サーバーURL・合言葉を個別に入力</button>
                    <button type="button" className="knowledge-link-button" onClick={changeCloudflareCredentials}>Cloudflareの設定を変更</button>
                  </div>
                  <div>
                    <button type="button" onClick={onClose}>キャンセル</button>
                    <button type="button" className="knowledge-primary-button" disabled={busy} onClick={deployAndShare}>{busy ? "デプロイ中…" : "共有を開始"}</button>
                  </div>
                </div>
                {cfStatus.workerUrl && (
                  <button type="button" className="knowledge-danger-link" disabled={cfDeleting} onClick={deleteWorker}>
                    {cfDeleting ? "削除中…" : "Workerを削除（このアカウントの全Projectで同期が止まります）"}
                  </button>
                )}
              </>
            ) : cfStatus && (
              <form onSubmit={saveCloudflareCredentials}>
                <label htmlFor="cf-account-id">Cloudflare Account ID</label>
                <input id="cf-account-id" autoFocus value={cfAccountId} onChange={(event) => setCfAccountId(event.target.value)} required />
                <label htmlFor="cf-api-token">Cloudflare APIトークン</label>
                <input id="cf-api-token" type="password" value={cfApiToken} onChange={(event) => setCfApiToken(event.target.value)} placeholder="Workers編集権限を持つトークン" required />
                <small className="form-note">Cloudflareダッシュボードで発行し、Workers ScriptsとDurable Objectsの編集権限だけを与えてください。この端末にのみ保存されます。</small>
                {cfError && <small className="form-note form-note-error">{cfError}</small>}
                <div className="knowledge-dialog-actions knowledge-dialog-actions-split">
                  <button type="button" className="knowledge-link-button" onClick={() => setConnectManual(true)}>サーバーURL・合言葉を個別に入力</button>
                  <div>
                    <button type="button" onClick={onClose}>キャンセル</button>
                    <button type="submit" className="knowledge-primary-button" disabled={cfSavingCredentials || !cfAccountId.trim() || !cfApiToken.trim()}>{cfSavingCredentials ? "保存中…" : "設定して共有を開始"}</button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {mode === "connect" && connectManual && (
          <form onSubmit={(event) => { event.preventDefault(); onConnect({ endpoint, secret }); }}>
            <p>「{projectName}」をあなたが用意した同期サーバーに接続します。サーバーはあなたのCloudflareアカウントで動き、MyBoxは一切保持しません。</p>
            <label htmlFor="share-endpoint">サーバーURL</label>
            <input id="share-endpoint" autoFocus value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://mybox-sync.you.workers.dev" required />
            <label htmlFor="share-secret">サーバーの合言葉</label>
            <input id="share-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="wrangler secret put で設定した値" required />
            <small className="form-note">合言葉はこの接続にのみ使い、保存しません。招待される側には不要です。</small>
            <div className="knowledge-dialog-actions knowledge-dialog-actions-split">
              <button type="button" className="knowledge-link-button" onClick={() => setConnectManual(false)}>Cloudflareで自動デプロイする</button>
              <div>
                <button type="button" onClick={onClose}>キャンセル</button>
                <button type="submit" className="knowledge-primary-button" disabled={busy || !endpoint || !secret}>{busy ? "接続中…" : "接続"}</button>
              </div>
            </div>
          </form>
        )}

        {mode === "join" && !joinManual && (
          <form onSubmit={submitJoinLink}>
            <p>相手から受け取った招待リンクを貼り付けます。</p>
            <label htmlFor="join-link">招待リンク</label>
            <input id="join-link" autoFocus value={joinLink} onChange={(event) => { setJoinLink(event.target.value); setJoinLinkError(""); }} placeholder="mbx1.…" required />
            {joinLinkError && <small className="form-note form-note-error">{joinLinkError}</small>}
            <div className="knowledge-dialog-actions knowledge-dialog-actions-split">
              <button type="button" className="knowledge-link-button" onClick={() => setJoinManual(true)}>サーバーURL・Project ID・コードを個別に入力</button>
              <div>
                <button type="button" onClick={onClose}>キャンセル</button>
                <button type="submit" className="knowledge-primary-button" disabled={busy || !joinLink}>{busy ? "参加中…" : "参加"}</button>
              </div>
            </div>
          </form>
        )}

        {mode === "join" && joinManual && (
          <form onSubmit={(event) => { event.preventDefault(); onJoin({ endpoint, sharedProjectId, invite: inviteCode }); }}>
            <p>相手から受け取ったサーバーURL・Project ID・招待コードを入力します。</p>
            <label htmlFor="join-endpoint">サーバーURL</label>
            <input id="join-endpoint" autoFocus value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://mybox-sync.friend.workers.dev" required />
            <label htmlFor="join-project">Project ID</label>
            <input id="join-project" value={sharedProjectId} onChange={(event) => setSharedProjectId(event.target.value)} required />
            <label htmlFor="join-invite">招待コード</label>
            <input id="join-invite" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required />
            <div className="knowledge-dialog-actions knowledge-dialog-actions-split">
              <button type="button" className="knowledge-link-button" onClick={() => setJoinManual(false)}>招待リンクを貼り付ける</button>
              <div>
                <button type="button" onClick={onClose}>キャンセル</button>
                <button type="submit" className="knowledge-primary-button" disabled={busy || !endpoint || !sharedProjectId || !inviteCode}>{busy ? "参加中…" : "参加"}</button>
              </div>
            </div>
          </form>
        )}

        {mode === "invite" && (
          <div>
            <p>招待リンクは一度きり有効です。相手に渡すと、その人のアカウントがメンバーとして記録され、後から個別に解除できます。</p>
            {invite ? (
              <div className="device-code invite-code">
                <code>{inviteLink || invite}</code>
                <button type="button" onClick={async () => {
                  try { await navigator.clipboard.writeText(inviteLink || invite); setCopied(true); } catch { setCopied(false); }
                }}>{copied ? "コピーしました" : "コピー"}</button>
              </div>
            ) : (
              <div className="knowledge-share-roles">
                <button type="button" disabled={busy} onClick={() => onInvite("editor")}>編集者として招待</button>
                <button type="button" disabled={busy} onClick={() => onInvite("viewer")}>閲覧者として招待</button>
              </div>
            )}
            <div className="knowledge-dialog-actions">
              <button type="button" onClick={onClose}>閉じる</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * A Project's name, membership summary, and storage location. The server
 * only exposes the member list and removal to its Owner, so those stay
 * gated the same way here. Changing a member's role has no server route yet.
 */
function ProjectSettingsDialog({ project, activeProfileId, syncInfo, busy, onSave, onDeleteRequest, onListMembers, onListMemberColors, onRemoveMember, onClose }) {
  const [name, setName] = useState(project.name);
  const [saved, setSaved] = useState(false);
  const [members, setMembers] = useState(null);
  const [initialColors, setInitialColors] = useState({});
  const [membersError, setMembersError] = useState("");
  const [removingId, setRemovingId] = useState(null);
  const isOwner = project.role === "owner";
  const isShared = Boolean(syncInfo);
  const canListMembers = isOwner && isShared;

  useEffect(() => {
    setName(project.name);
    setSaved(false);
  }, [project.id, project.name]);

  useEffect(() => {
    let active = true;
    setMembersError("");
    Promise.all([
      canListMembers ? onListMembers(project.id) : Promise.resolve([]),
      onListMemberColors(project.id),
    ])
      .then(([serverMembers, colorResult]) => {
        if (!active) return;
        const colorMembers = colorResult.members ?? [];
        const knownColors = Object.fromEntries(colorMembers.map((member) => [member.profileId, member.color]));
        const source = serverMembers.length
          ? serverMembers
          : colorMembers.some((member) => member.profileId === activeProfileId)
            ? colorMembers
            : [...colorMembers, { profileId: activeProfileId, role: project.role }];
        const merged = source.map((member) => ({
          ...member,
          color: authorColorFor(member.profileId, knownColors[member.profileId] ?? member.color),
        }));
        setMembers(merged);
        setInitialColors(Object.fromEntries(merged.map((member) => [member.profileId, member.color])));
      })
      .catch((nextError) => { if (active) setMembersError(String(nextError?.message ?? nextError)); });
    return () => { active = false; };
  }, [activeProfileId, canListMembers, project.id, project.role, onListMemberColors, onListMembers]);

  const submitSettings = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const colors = Object.fromEntries((members ?? []).map((member) => [member.profileId, member.color]));
    await onSave({ name: trimmed, colors });
    setInitialColors(colors);
    setSaved(true);
  };

  const removeMember = async (profileId) => {
    setRemovingId(profileId);
    setMembersError("");
    try {
      await onRemoveMember(project.id, profileId);
      setMembers((current) => current?.filter((member) => member.profileId !== profileId) ?? current);
    } catch (nextError) {
      setMembersError(String(nextError?.message ?? nextError));
    } finally {
      setRemovingId(null);
    }
  };

  const colorChanged = (members ?? []).some((member) => initialColors[member.profileId] !== member.color);
  const hasChanges = name.trim() !== project.name || colorChanged;

  return (
    <div className="knowledge-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="knowledge-dialog knowledge-share-dialog knowledge-project-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-project-settings-title">
        <h2 id="knowledge-project-settings-title">Project設定</h2>
        <form onSubmit={submitSettings} className="knowledge-project-settings-form">
          <div className="knowledge-project-settings-body">
            <div>
              <label htmlFor="project-settings-name">Project名</label>
              <input id="project-settings-name" value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} disabled={!isOwner || busy} maxLength={120} required />
              {!isOwner && <small className="form-note">Owner権限がないため変更できません。</small>}
            </div>

            <div className="knowledge-settings-section">
              <h3>メンバーと基本色</h3>
              <p>自分のRole：{project.role}</p>
              {isShared
                ? <small className="form-note">接続先：{syncInfo.endpoint}</small>
                : <small className="form-note">このProjectはこの端末だけにあります。</small>}
              {membersError && <small className="form-note form-note-error">{membersError}</small>}
              {members === null && !membersError && <small className="form-note">読み込み中…</small>}
              {members && (members.length ? (
                <ul className="knowledge-member-list">
                  {members.map((member) => (
                    <li key={member.profileId}>
                      <div className="knowledge-member-summary">
                        <span className="knowledge-author-dot" style={{ backgroundColor: member.color }} aria-hidden="true" />
                        <span className="knowledge-member-id">{member.profileId}</span>
                        <span className="knowledge-member-role">{member.role ?? "member"}</span>
                        {canListMembers && member.role !== "owner" && (
                          <button type="button" className="knowledge-danger-link" disabled={removingId === member.profileId} onClick={() => removeMember(member.profileId)}>
                            {removingId === member.profileId ? "削除中…" : "削除"}
                          </button>
                        )}
                      </div>
                      <div className="knowledge-author-color-options" role="group" aria-label={`${member.profileId}の基本色`}>
                        {AUTHOR_COLOR_PALETTE.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={member.color === color ? "selected" : ""}
                            aria-label={`${member.profileId}の基本色 ${color}`}
                            aria-pressed={member.color === color}
                            disabled={(!isOwner && member.profileId !== activeProfileId) || busy}
                            style={{ "--member-color": color }}
                            onClick={() => {
                              setMembers((current) => current.map((item) => item.profileId === member.profileId ? { ...item, color } : item));
                              setSaved(false);
                            }}
                          />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <small className="form-note">メンバーがいません。</small>)}
              <small className="form-note">基本色はNoteの最終編集者表示に使われます。Roleの変更、招待の発行、共有停止は別の操作です。</small>
            </div>

            <div className="knowledge-settings-section">
              <h3>保存場所</h3>
              <small className="form-note">現在のバージョンでは全ProjectがMyBoxアプリ内の共通ストレージに保存されます。Project専用フォルダの選択は今後のリリースで対応予定です。</small>
            </div>

            {isOwner && (
              <div className="knowledge-settings-section">
                <h3>危険な操作</h3>
                <button type="button" className="knowledge-danger-link" disabled={isShared} title={isShared ? "削除する前に共有を停止してください" : undefined} onClick={onDeleteRequest}>
                  <Trash size={15} aria-hidden="true" />Projectを削除
                </button>
              </div>
            )}
          </div>

          <div className="knowledge-dialog-actions knowledge-project-settings-actions">
            {saved && <span role="status">保存しました</span>}
            <button type="button" onClick={onClose}>閉じる</button>
            <button type="submit" className="knowledge-primary-button" disabled={busy || !name.trim() || !hasChanges}>{busy ? "保存中…" : "保存"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function profileInitials(displayName) {
  return [...String(displayName || "共同編集者").trim()].slice(0, 2).join("").toLocaleUpperCase("ja-JP");
}

function OnlineProfileAvatar({ profile }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [profile.avatarUrl]);
  const label = `${profile.displayName}・オンライン`;
  return (
    <span className="knowledge-online-avatar" role="img" aria-label={label} title={label}>
      {profile.avatarUrl && !imageFailed
        ? <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        : <span aria-hidden="true">{profileInitials(profile.displayName)}</span>}
      <i aria-hidden="true" />
    </span>
  );
}

function BlockRow({
  block,
  authorColor,
  authorName,
  showAuthor,
  blockIndex,
  blockCount,
  autoEdit,
  linkCandidates,
  readOnly,
  onCommit,
  onAddAfter,
  onPasteBlocks,
  onRemove,
  onOpenPage,
  onOpenUrl,
  onReadImage,
  onAutoEditHandled,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnterBlock,
  onDropBlock,
  onDragEnd,
}) {
  const [editing, setEditing] = useState(Boolean(autoEdit && !readOnly));
  const [text, setText] = useState(block.text);
  const [blockType, setBlockType] = useState(block.type);
  const [checked, setChecked] = useState(block.checked);
  const [activeOption, setActiveOption] = useState(0);
  const [dismissedMarker, setDismissedMarker] = useState(null);
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [imageDataUri, setImageDataUri] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [resizingWidthPercent, setResizingWidthPercent] = useState(null);
  const textareaRef = useRef(null);
  const imageWrapRef = useRef(null);

  const { resourceId: imageResourceId, widthPercent: imageWidthPercent } = block.type === "image"
    ? parseImageBlockText(block.text)
    : { resourceId: null, widthPercent: 100 };
  const displayWidthPercent = resizingWidthPercent ?? imageWidthPercent;

  /** Tracks the corner handle drag with window-level listeners so the pointer can leave the image while resizing, and commits once on release rather than on every pixel of movement. */
  const startImageResize = (event) => {
    if (readOnly || !imageResourceId) return;
    event.preventDefault();
    event.stopPropagation();
    const wrap = imageWrapRef.current;
    const container = wrap?.parentElement;
    if (!wrap || !container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const startWidth = wrap.getBoundingClientRect().width;
    const startX = event.clientX;
    const onMove = (moveEvent) => {
      const nextWidth = startWidth + (moveEvent.clientX - startX);
      const percent = Math.round(Math.min(100, Math.max(IMAGE_MIN_WIDTH_PERCENT, (nextWidth / containerWidth) * 100)));
      setResizingWidthPercent(percent);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizingWidthPercent((current) => {
        if (current !== null) commit({ text: current === 100 ? imageResourceId : `${imageResourceId}?w=${current}` });
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (block.type !== "image" || !imageResourceId) {
      setImageDataUri(null);
      return undefined;
    }
    let active = true;
    setImageError(false);
    onReadImage(imageResourceId)
      .then((dataUri) => { if (active) setImageDataUri(dataUri); })
      .catch(() => { if (active) setImageError(true); });
    return () => { active = false; };
  }, [block.type, imageResourceId, onReadImage]);
  const noFormatTypes = new Set(["code", "math", "divider", "url-embed", "image"]);
  const canFormat = editing && !readOnly && !noFormatTypes.has(blockType);
  const hasSelection = canFormat && selectionRange.end > selectionRange.start;

  useEffect(() => {
    if (editing) return;
    setText(block.text);
    setBlockType(block.type);
    setChecked(block.checked);
  }, [block, editing]);

  useEffect(() => {
    if (!autoEdit || readOnly) return;
    setEditing(true);
    onAutoEditHandled?.();
  }, [autoEdit, onAutoEditHandled, readOnly]);

  const markerStart = text.lastIndexOf("[[");
  const markerQuery = markerStart >= 0 ? text.slice(markerStart + 2) : "";
  const markerOpen = editing
    && markerStart >= 0
    && !markerQuery.includes("]]" )
    && dismissedMarker !== markerStart;
  const filteredCandidates = markerOpen
    ? linkCandidates.filter((page) => normalized(page.title).includes(normalized(markerQuery))).slice(0, 7)
    : [];
  const exactCandidate = filteredCandidates.find((page) => normalized(page.title) === normalized(markerQuery));
  const options = markerOpen
    ? [...filteredCandidates, ...(!exactCandidate && markerQuery.trim() ? [{ id: "__create__", title: markerQuery.trim(), state: "create" }] : [])]
    : [];

  useEffect(() => setActiveOption(0), [markerQuery]);

  const commit = (override = {}) => {
    if (readOnly) return;
    const nextText = override.text ?? text;
    const nextType = override.blockType ?? blockType;
    const nextChecked = override.checked ?? checked;
    if (nextText === block.text && nextType === block.type && nextChecked === block.checked) return;
    onCommit({
      type: "block-update",
      blockId: block.id,
      text: nextText,
      blockType: nextType,
      checked: nextChecked,
    });
  };

  const changeText = (value) => {
    setText(value);
    setDismissedMarker(null);
    const conversion = markdownConversion(value);
    if (!conversion) return;
    setText(conversion.text);
    setBlockType(conversion.blockType);
    setChecked(conversion.checked ?? false);
    commit(conversion);
  };

  const trackSelection = () => {
    const node = textareaRef.current;
    if (!node) return;
    setSelectionRange({ start: node.selectionStart, end: node.selectionEnd });
  };

  const applyMark = (mark) => {
    const node = textareaRef.current;
    if (!node) return;
    const result = toggleInlineWrap(text, node.selectionStart, node.selectionEnd, mark);
    if (!result) return;
    setText(result.text);
    commit({ text: result.text });
    window.setTimeout(() => {
      node.focus();
      node.setSelectionRange(result.start, result.end);
      trackSelection();
    }, 0);
  };

  const applyColor = (hex) => {
    const node = textareaRef.current;
    if (!node) return;
    const result = applyColorWrap(text, node.selectionStart, node.selectionEnd, hex);
    setColorPickerOpen(false);
    if (!result) return;
    setText(result.text);
    commit({ text: result.text });
    window.setTimeout(() => {
      node.focus();
      node.setSelectionRange(result.start, result.end);
      trackSelection();
    }, 0);
  };

  const selectLink = (option) => {
    const token = `[[${option.title}]]`;
    const nextText = `${text.slice(0, markerStart)}${token}`;
    setText(nextText);
    setDismissedMarker(markerStart);
    onCommit({
      type: "link-add",
      blockId: block.id,
      ...(option.state === "create" ? { createTitle: option.title } : { targetPageId: option.id }),
      text,
      markerStart,
      markerEnd: text.length,
    });
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const onKeyDown = (event) => {
    if (markerOpen && options.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveOption((current) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return (current + delta + options.length) % options.length;
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        selectLink(options[activeOption]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedMarker(markerStart);
        return;
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const result = indentTextSelection(
        text,
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
        event.shiftKey,
      );
      setText(result.text);
      commit({ text: result.text });
      window.setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(result.start, result.end);
        trackSelection();
      }, 0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && blockType !== "code") {
      if (isGroupedListType(blockType)) {
        event.preventDefault();
        const result = groupedListEnter(text, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
        setText(result.text);
        commit({ text: result.text });
        if (result.exitList) {
          onAddAfter(block.id, "paragraph");
        } else {
          window.setTimeout(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(result.cursor, result.cursor);
          }, 0);
        }
        return;
      }
      event.preventDefault();
      commit();
      onAddAfter(block.id);
    } else if (event.key === "Backspace" && !text && blockCount > 1) {
      event.preventDefault();
      onRemove(block.id);
    } else if (event.key === "Escape") {
      commit();
      setEditing(false);
    }
  };

  const onPaste = (event) => {
    // Image clipboard items belong to the document-level image handler. Code
    // and math intentionally keep embedded newlines inside their one Block.
    const clipboard = event.clipboardData;
    if (!clipboard || [...(clipboard.items ?? [])].some((item) => item.type.startsWith("image/"))) return;
    if (blockType === "code" || blockType === "math" || blockType === "image") return;

    const markdownFile = [...(clipboard.files ?? [])].find((file) => (
      file.type === "text/markdown" || /\.(?:md|markdown)$/i.test(file.name)
    ));
    const clipboardText = clipboard.getData("text/markdown") || clipboard.getData("text/plain");
    // A normal single-line paste retains native caret and undo behavior. A
    // Markdown file is parsed even when it contains only one line.
    if (!markdownFile && !/[\r\n]/.test(clipboardText)) return;

    event.preventDefault();
    const sourceText = text;
    const selectionStart = event.currentTarget.selectionStart;
    const selectionEnd = event.currentTarget.selectionEnd;
    const applyPaste = (pastedText) => {
      const pasted = parsePastedBlocks(pastedText);
      if (!pasted.length) return;
      setEditing(false);
      onPasteBlocks({
        type: "block-paste",
        blockId: block.id,
        text: pastedText,
        sourceText,
        selectionStart,
        selectionEnd,
      }, {
        pastedBlockCount: pasted.length,
        hasPrefix: Boolean(sourceText.slice(0, selectionStart)),
      });
    };

    if (markdownFile) markdownFile.text().then(applyPaste).catch(() => {});
    else applyPaste(clipboardText);
  };

  const populatedListItems = splitListItems(block.text).filter((item) => item.trim());
  const listItems = populatedListItems.length ? populatedListItems : [""];
  const renderListItem = (item, index) => (
    <li key={`${block.id}-item-${index}`}>
      {renderInlineText(item, block.links.filter((link) => item.includes(link.token)), onOpenPage)}
    </li>
  );
  const preview = blockType === "divider"
    ? <hr />
    : blockType === "code"
      ? <pre>{block.text || "code"}</pre>
      : blockType === "math"
        ? <InlineMath source={block.text} display />
        : blockType === "url-embed"
          ? (block.text
            ? (
              <button type="button" className="knowledge-url-embed" onClick={() => onOpenUrl(block.text)}>
                <ArrowSquareOut size={16} aria-hidden="true" />
                <span><strong>{urlHost(block.text)}</strong><small>{block.text}</small></span>
              </button>
            )
            : <span className="knowledge-empty-copy">URLを入力</span>)
          : blockType === "image"
            ? (imageError
              ? <span className="knowledge-empty-copy">画像を読み込めません</span>
              : imageDataUri
                ? (
                  <div ref={imageWrapRef} className="knowledge-image-embed-wrap" style={{ width: `${displayWidthPercent}%` }}>
                    <img className="knowledge-image-embed" src={imageDataUri} alt="埋め込み画像" draggable={false} />
                    {!readOnly && (
                      <button
                        type="button"
                        className="knowledge-image-resize-handle"
                        aria-label="画像の大きさを変更"
                        onMouseDown={startImageResize}
                      />
                    )}
                  </div>
                )
                : <span className="knowledge-empty-copy">読み込み中…</span>)
          : blockType === "bulleted-list"
          ? <ul className="knowledge-structured-list">{listItems.map(renderListItem)}</ul>
          : blockType === "numbered-list"
            ? <ol className="knowledge-structured-list">{listItems.map(renderListItem)}</ol>
      : (
        <div className="knowledge-block-preview-copy">
          {blockType === "checklist" && <span className={`knowledge-check${block.checked ? " checked" : ""}`} aria-hidden="true">{block.checked && <Check size={13} weight="bold" />}</span>}
          <span>{renderInlineText(block.text, block.links, onOpenPage)}</span>
        </div>
      );

  return (
    <article
      className={`knowledge-block type-${blockType}${editing ? " editing" : ""}${isDragging ? " dragging" : ""}${isDragOver ? " drag-over" : ""}${showAuthor && block.updatedBy ? " authored" : ""}`}
      style={showAuthor && block.updatedBy ? { "--author-color": authorColor } : undefined}
      onDragOver={(event) => {
        // A real OS file drag also fires this on every Block underneath it; leave
        // it unhandled here (readable by `.knowledge-blocks`' own file-drop
        // handler) and only claim an in-page reorder drag, which carries no
        // "Files" type. `stopPropagation` keeps that container-level handler —
        // which exists to keep the cursor valid over the gaps *between*
        // Blocks — from re-handling a drag that is already over one.
        if (readOnly || event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        onDragEnterBlock?.(block.id);
      }}
      onDrop={(event) => {
        if (readOnly || event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        onDropBlock?.(block.id);
      }}
    >
      <div className="knowledge-block-rail" aria-label={`${blockLabels[blockType]}の操作`}>
        <span className="knowledge-block-kind">{blockLabels[blockType]}</span>
        {!readOnly && <>
          <button
            type="button"
            className="knowledge-drag-handle"
            aria-label={`Blockを移動（${blockIndex + 1}/${blockCount}）`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              onDragStart?.(block.id);
            }}
            onDragEnd={() => onDragEnd?.()}
          >
            <DotsSixVertical size={16} />
          </button>
          <button type="button" aria-label="Blockを削除" onClick={() => onRemove(block.id)}><X size={15} /></button>
        </>}
      </div>
      {showAuthor && block.updatedBy && (
        <span className="knowledge-block-author" title={`最終編集：${authorName}`}>
          <span className="knowledge-author-dot" aria-hidden="true" />
          <span>{authorName}</span>
        </span>
      )}
      {editing && !readOnly ? (
        <div className="knowledge-block-editor-wrap">
          {blockType === "bulleted-list" && <span className="knowledge-list-editor-kind" title="箇条書き"><ListBullets size={18} aria-hidden="true" /></span>}
          {blockType === "numbered-list" && <span className="knowledge-list-editor-kind" title="番号付きリスト"><ListNumbers size={18} aria-hidden="true" /></span>}
          {blockType === "checklist" && (
            <button
              type="button"
              className={`knowledge-check-button${checked ? " checked" : ""}`}
              aria-label={checked ? "チェックを外す" : "チェックする"}
              aria-pressed={checked}
              onClick={() => {
                setChecked((current) => !current);
                commit({ checked: !checked });
              }}
            >
              {checked && <Check size={14} weight="bold" />}
            </button>
          )}
          <textarea
            ref={textareaRef}
            autoFocus
            rows={Math.max(1, Math.min(12, text.split("\n").length))}
            aria-label={`${blockLabels[blockType]}を編集`}
            value={text}
            placeholder={blockType === "paragraph" ? "Markdown記号または / で入力…" : blockLabels[blockType]}
            onChange={(event) => changeText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onSelect={trackSelection}
            onClick={trackSelection}
            onKeyUp={trackSelection}
            onBlur={(event) => {
              if (event.relatedTarget?.closest?.(".knowledge-link-picker, .knowledge-format-toolbar")) return;
              if (isGroupedListType(blockType)) {
                const normalizedText = splitListItems(text).filter((item) => item.trim()).join("\n");
                setText(normalizedText);
                commit({ text: normalizedText });
              } else {
                commit();
              }
              setSelectionRange({ start: 0, end: 0 });
              setColorPickerOpen(false);
              setEditing(false);
            }}
          />
          {hasSelection && (
            <div className="knowledge-format-toolbar" role="toolbar" aria-label="文字装飾">
              <button type="button" aria-label="太字" onMouseDown={(event) => event.preventDefault()} onClick={() => applyMark("bold")}><TextB size={15} weight="bold" /></button>
              <button type="button" aria-label="斜体" onMouseDown={(event) => event.preventDefault()} onClick={() => applyMark("italic")}><TextItalic size={15} /></button>
              <button type="button" aria-label="下線" onMouseDown={(event) => event.preventDefault()} onClick={() => applyMark("underline")}><TextUnderline size={15} /></button>
              <button type="button" aria-label="取り消し線" onMouseDown={(event) => event.preventDefault()} onClick={() => applyMark("strike")}><TextStrikethrough size={15} /></button>
              <span className="knowledge-format-divider" aria-hidden="true" />
              <button
                type="button"
                aria-label="文字色"
                aria-expanded={colorPickerOpen}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setColorPickerOpen((value) => !value)}
              >
                <Palette size={15} />
              </button>
              {colorPickerOpen && (
                <div className="knowledge-color-picker" onMouseDown={(event) => event.preventDefault()}>
                  {TEXT_COLOR_PRESETS.map((hex) => (
                    <button key={hex} type="button" aria-label={`文字色 #${hex}`} className="knowledge-color-swatch" style={{ background: `#${hex}` }} onClick={() => applyColor(hex)} />
                  ))}
                  <label className="knowledge-color-custom" aria-label="文字色をカスタム選択">
                    <input type="color" onChange={(event) => applyColor(event.target.value.slice(1))} />
                  </label>
                </div>
              )}
            </div>
          )}
          {markerOpen && (
            <div className="knowledge-link-picker" role="listbox" aria-label="リンクするPage">
              <div className="knowledge-link-picker-heading"><LinkIcon size={16} aria-hidden="true" /><span>Pageへリンク</span></div>
              {options.length ? options.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeOption}
                  className={index === activeOption ? "selected" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectLink(option)}
                >
                  {option.state === "create" ? <Plus size={17} /> : <FileText size={17} />}
                  <span><strong>{option.title}</strong><small>{option.state === "trash" ? "Trashから復元してリンク" : option.state === "create" ? "新しいPageを作成" : "Active Page"}</small></span>
                </button>
              )) : <p>一致するPageがありません</p>}
            </div>
          )}
        </div>
      ) : (
        <div
          className="knowledge-block-preview"
          onClick={(event) => {
            if (!readOnly && blockType !== "image" && !event.target.closest("button")) setEditing(true);
          }}
        >
          {!readOnly && blockType !== "image" && (
            <button type="button" className="knowledge-block-edit-trigger" aria-label={`${blockLabels[blockType]}を編集`} onClick={() => setEditing(true)}>
              <PencilSimple size={14} aria-hidden="true" />
            </button>
          )}
          {preview}
        </div>
      )}
    </article>
  );
}

function TagsEditor({ tags, candidates, readOnly, onCommit }) {
  const [labels, setLabels] = useState(tags);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef(null);
  const composingRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const labelsRef = useRef(tags);
  const tagsSignature = tags.map(normalized).join("\u0000");

  useEffect(() => {
    labelsRef.current = tags;
    setLabels(tags);
  }, [tagsSignature]);

  const commitLabels = (nextLabels) => {
    labelsRef.current = nextLabels;
    setLabels(nextLabels);
    onCommit(nextLabels);
  };

  const addLabels = (values) => {
    const currentLabels = labelsRef.current;
    const next = [...currentLabels];
    const used = new Set(currentLabels.map(normalized));
    for (const value of values.map((label) => label.trim()).filter(Boolean)) {
      const key = normalized(value);
      if (used.has(key)) continue;
      used.add(key);
      next.push(value);
    }
    if (next.length !== currentLabels.length) commitLabels(next);
    setDraft("");
  };

  const addLabel = (label) => addLabels([label]);

  const removeLabel = (label) => {
    commitLabels(labelsRef.current.filter((item) => item !== label));
  };

  const keepInputFocused = () => window.setTimeout(() => inputRef.current?.focus(), 0);

  const filteredCandidates = filterUsedTagCandidates(candidates, labels, draft);

  return (
    <div className="knowledge-tags-field">
      <span><Tag size={16} aria-hidden="true" />Tags</span>
      <div className="knowledge-tags-editor">
        <div className="knowledge-tags-chips">
          {labels.map((label) => (
            <span key={label} className="knowledge-tag-chip">
              {label}
              {!readOnly && <button type="button" aria-label={`${label}を削除`} onClick={() => removeLabel(label)}><X size={11} /></button>}
            </span>
          ))}
          {!readOnly && (
            <input
              ref={inputRef}
              value={draft}
              placeholder={labels.length ? "" : "例：設計 アイデア"}
              role="combobox"
              aria-label="Tagを追加"
              aria-autocomplete="list"
              aria-describedby="knowledge-tags-hint"
              aria-expanded={open && filteredCandidates.length > 0}
              aria-controls="knowledge-tag-picker"
              onChange={(event) => {
                const value = event.target.value;
                if (!composingRef.current && hasTagDelimiterAtEnd(value)) {
                  addLabels(splitTagDraft(value));
                  keepInputFocused();
                } else {
                  setDraft(value);
                }
                setOpen(true);
                setHighlightedIndex(-1);
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                const value = event.currentTarget.value;
                if (hasTagDelimiterAtEnd(value)) {
                  addLabels(splitTagDraft(value));
                  setOpen(true);
                  setHighlightedIndex(-1);
                  keepInputFocused();
                }
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                const hasHighlight = open && highlightedIndex >= 0 && filteredCandidates[highlightedIndex];
                if (event.key === "Tab" && open && filteredCandidates.length > 0) {
                  // Cycles the picker so an existing Tag can be reached without the mouse; Space commits it below.
                  event.preventDefault();
                  setHighlightedIndex((current) => (event.shiftKey
                    ? (current <= 0 ? filteredCandidates.length - 1 : current - 1)
                    : (current + 1) % filteredCandidates.length));
                  return;
                }
                if ((event.key === " " || event.key === "　" || event.key === "Spacebar" || event.code === "Space") && isTagCommitKey(event)) {
                  if (!draft.trim() && !hasHighlight) return;
                  event.preventDefault();
                  if (hasHighlight) addLabel(filteredCandidates[highlightedIndex].label);
                  else addLabels(splitTagDraft(draft));
                  setHighlightedIndex(-1);
                  keepInputFocused();
                  return;
                }
                if (event.key === "Enter" && isTagCommitKey(event)) {
                  event.preventDefault();
                  skipBlurCommitRef.current = true;
                  if (hasHighlight) addLabel(filteredCandidates[highlightedIndex].label);
                  else addLabels(splitTagDraft(draft));
                  setHighlightedIndex(-1);
                  setOpen(false);
                  window.setTimeout(() => inputRef.current?.blur(), 0);
                  return;
                }
                if (event.key === "," && isTagCommitKey(event)) {
                  event.preventDefault();
                  if (hasHighlight) addLabel(filteredCandidates[highlightedIndex].label);
                  else addLabels(splitTagDraft(draft));
                  setHighlightedIndex(-1);
                  keepInputFocused();
                } else if (event.key === "Backspace" && !draft && labels.length) {
                  removeLabel(labels[labels.length - 1]);
                } else if (event.key === "Escape") {
                  setOpen(false);
                  setHighlightedIndex(-1);
                }
              }}
              onBlur={(event) => {
                if (event.relatedTarget?.closest?.(".knowledge-tag-picker")) return;
                if (skipBlurCommitRef.current) skipBlurCommitRef.current = false;
                else if (draft.trim()) addLabels(splitTagDraft(draft));
                setOpen(false);
                setHighlightedIndex(-1);
              }}
            />
          )}
        </div>
        {!readOnly && <small id="knowledge-tags-hint" className="knowledge-tags-hint">Spaceで追加・Enterで入力を完了</small>}
        {!readOnly && open && filteredCandidates.length > 0 && (
          <div id="knowledge-tag-picker" className="knowledge-tag-picker" role="listbox" aria-label="既存のTag">
            {filteredCandidates.map((tag, index) => (
              <button
                key={tag.id}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => {
                  addLabel(tag.label);
                  setHighlightedIndex(-1);
                  inputRef.current?.focus();
                }}
              >
                <Tag size={13} aria-hidden="true" />
                <span>{tag.label}</span>
                <small>{tag.pageCount}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeView({
  desktop = false,
  profileId = LOCAL_PROFILE_ID,
  profile = null,
  shortcutCommand = null,
  persistenceReady = true,
  onClose,
  onOpenSettings,
  onToggleAssistant,
  assistantOpen = false,
  onContextChange,
  onToast = () => {},
  appRuntime = null,
}) {
  const clientRef = useRef(null);
  // Read through a ref so a sign-in applies to the next Operation without
  // rebuilding the client and losing view state.
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;
  if (!clientRef.current) {
    clientRef.current = createKnowledgeClient({ desktop, getProfileId: () => profileIdRef.current, appRuntime });
  }
  const client = clientRef.current;
  const activeProfile = useMemo(() => ({
    profileId,
    displayName: typeof profile?.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : "ローカルユーザー",
    avatarUrl: typeof profile?.avatarUrl === "string" && /^https:\/\//.test(profile.avatarUrl) ? profile.avatarUrl : null,
  }), [profileId, profile?.displayName, profile?.avatarUrl]);
  const pageRef = useRef(null);
  const operationQueue = useRef(Promise.resolve());
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [pages, setPages] = useState([]);
  const [linkCandidates, setLinkCandidates] = useState([]);
  const [tagCandidates, setTagCandidates] = useState([]);
  const [memberColors, setMemberColors] = useState({});
  const [memberProfiles, setMemberProfiles] = useState({});
  const [onlineProfiles, setOnlineProfiles] = useState({});
  const [syncByProject, setSyncByProject] = useState({});
  const [shareMode, setShareMode] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareInvite, setShareInvite] = useState("");
  const [syncStatus, setSyncStatus] = useState("idle");
  const sharedRef = useRef(null);
  // Bumped whenever the shared document moves, so the editor re-reads it.
  const [sharedRevision, setSharedRevision] = useState(0);
  const [dragBlockId, setDragBlockId] = useState(null);
  const [dragOverBlockId, setDragOverBlockId] = useState(null);
  const [selectedPageId, setSelectedPageId] = useState(null);
  const [pageData, setPageData] = useState(null);
  const [query, setQuery] = useState("");
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [activeSearchSuggestion, setActiveSearchSuggestion] = useState(0);
  const [includeTrash, setIncludeTrash] = useState(false);
  const [searchScope, setSearchScope] = useState("current");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsBusy, setProjectSettingsBusy] = useState(false);
  const [autoEditBlockId, setAutoEditBlockId] = useState(null);
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const shareMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const presenceAcknowledgedRef = useRef(new Set());

  pageRef.current = pageData?.page ?? null;
  const currentProject = projects.find((project) => project.id === projectId) ?? null;
  const readOnly = currentProject?.role === "viewer" || pageData?.page.state === "trash";
  const isCurrentProjectShared = Boolean(syncByProject[projectId]);
  const profileNameFor = (actorId) => (
    onlineProfiles[actorId]?.displayName
    ?? memberProfiles[actorId]?.displayName
    ?? (actorId === activeProfile.profileId ? activeProfile.displayName : "共同編集者")
  );
  const visibleOnlineProfiles = Object.values(onlineProfiles)
    .sort((left, right) => Number(right.profileId === activeProfile.profileId) - Number(left.profileId === activeProfile.profileId));
  const searchCandidates = useMemo(() => filterPageSearchCandidates(pages, query), [pages, query]);
  const searchSuggestionsVisible = searchSuggestionsOpen && Boolean(query.trim());

  useEffect(() => {
    setActiveSearchSuggestion((index) => Math.min(index, Math.max(searchCandidates.length - 1, 0)));
  }, [searchCandidates.length]);

  useEffect(() => {
    if (shortcutCommand?.shortcutId !== "page-search") return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
    setSearchSuggestionsOpen(Boolean(query.trim()));
  }, [shortcutCommand?.sequence, shortcutCommand?.shortcutId]);

  // A popup closes on outside pointer input and on Escape, returning focus to
  // its trigger, per the popup rules in FRONTEND.md.
  useEffect(() => {
    if (!sharePopoverOpen) return undefined;
    const onPointerDown = (event) => {
      if (!shareMenuRef.current?.contains(event.target)) setSharePopoverOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setSharePopoverOpen(false);
      shareMenuRef.current?.querySelector("button")?.focus();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sharePopoverOpen]);

  const projectOptions = projects.map((project) => ({
    id: project.id,
    label: project.name,
    description: `${project.role}・${project.activePageCount} Pages`,
  }));

  const scopeOptions = [
    { id: "current", label: "現在のProject", description: currentProject?.name ?? "" },
    { id: "all", label: "すべてのProject", description: "閲覧可能なProjectを横断" },
  ];

  const loadProjects = async (preferredId) => {
    const result = await client.listProjects();
    setProjects(result.projects);
    const nextId = preferredId && result.projects.some((project) => project.id === preferredId)
      ? preferredId
      : projectId && result.projects.some((project) => project.id === projectId)
        ? projectId
        : result.projects[0]?.id ?? "";
    setProjectId(nextId);
    return { projects: result.projects, projectId: nextId };
  };

  const loadPage = async (nextProjectId, pageId) => {
    if (!nextProjectId || !pageId) {
      setPageData(null);
      return null;
    }
    // knowledge.page.read resolves a shared Project from its document itself.
    const result = await client.readPage(nextProjectId, pageId);
    setPageData(result);
    setSelectedPageId(pageId);
    return result;
  };

  const loadPageLists = async (nextProjectId = projectId, nextProjects = projects) => {
    if (!nextProjectId) return;
    // knowledge.page.list resolves a shared Project from its document itself.
    const candidatesResult = await client.listPages(nextProjectId, true);
    setLinkCandidates(candidatesResult.pages);
    if (sharedRef.current && nextProjectId === projectId) {
      // Tags and cross-Project search still read the local model, which a
      // shared document does not populate, so filter the list here instead.
      const needle = normalized(query);
      setPages(query.trim()
        ? candidatesResult.pages.filter((page) => normalized(page.title).includes(needle) || normalized(page.excerpt).includes(needle))
        : candidatesResult.pages);
      return candidatesResult.pages;
    }
    const tagsResult = await client.listTags(nextProjectId);
    setTagCandidates(tagsResult.tags);
    if (query.trim()) {
      const projectIds = searchScope === "all" ? nextProjects.map((project) => project.id) : [nextProjectId];
      const result = await client.search({ query, projectIds, includeTrash });
      const seen = new Set();
      setPages(result.results.filter((item) => !seen.has(item.pageId) && seen.add(item.pageId)).map((item) => ({
        id: item.pageId,
        projectId: item.projectId,
        title: item.pageTitle,
        state: item.pageState,
        revision: item.pageRevision,
        excerpt: item.excerpt,
      })));
    } else {
      const result = await client.listPages(nextProjectId, includeTrash);
      setPages(result.pages);
    }
    return candidatesResult.pages;
  };

  const loadMemberColors = async (nextProjectId = projectId) => {
    if (!nextProjectId) {
      setMemberColors({});
      return {};
    }
    const result = await client.listMemberColors(nextProjectId);
    const colors = Object.fromEntries((result.members ?? []).map((member) => [member.profileId, member.color]));
    setMemberColors(colors);
    return colors;
  };

  useEffect(() => {
    if (!persistenceReady) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    // A signed-in account must inherit what the local profile already owns, or
    // the User signs in and finds their own Pages unreachable. It is idempotent.
    const ready = profileId === LOCAL_PROFILE_ID
      ? Promise.resolve()
      : client.linkAccount(profileId);
    ready
      .then(() => loadProjects())
      .then(async (projectResult) => {
        if (!active) return;
        await Promise.all([
          loadPageLists(projectResult.projectId, projectResult.projects),
          loadMemberColors(projectResult.projectId),
        ]);
      })
      .catch((nextError) => active && setError(displayError(nextError)))
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => { active = false; };
  }, [persistenceReady, profileId]);

  useEffect(() => {
    if (!persistenceReady || !projectId) return;
    const timer = window.setTimeout(() => {
      loadPageLists().catch((nextError) => setError(displayError(nextError)));
    }, query ? 160 : 0);
    return () => window.clearTimeout(timer);
  }, [projectId, query, includeTrash, searchScope]);

  useEffect(() => {
    if (!persistenceReady || !projectId) return;
    loadMemberColors(projectId).catch(() => {});
  }, [projectId, sharedRevision]);

  // Kept current so the event subscription below never closes over a stale
  // loader, without resubscribing on every render.
  const reloadAfterExternalChangeRef = useRef(() => {});
  reloadAfterExternalChangeRef.current = async () => {
    const current = pageRef.current;
    const loaded = await loadProjects(projectId);
    await loadPageLists(loaded.projectId, loaded.projects);
    if (current) await loadPage(current.projectId, current.id);
  };

  /**
   * The assistant invokes the same AppHost this View does (ADR 0025), so a
   * Page it edits changes underneath an open editor. Without this the write
   * lands in storage while the screen keeps showing the previous revision,
   * which reads as "the AI said it edited but nothing happened".
   *
   * A shared Project is excluded: its document already streams its own updates.
   */
  useEffect(() => {
    if (!persistenceReady) return undefined;
    let timer = null;
    const onExternalChange = (envelope) => {
      if (sharedRef.current) return;
      const { pageId, revision } = envelope.payload ?? {};
      window.clearTimeout(timer);
      // Debounced so this View's own writes, which reload themselves, settle
      // first and are then recognised as already-applied rather than redone.
      timer = window.setTimeout(() => {
        const current = pageRef.current;
        if (current && pageId === current.id && revision === current.revision) return;
        reloadAfterExternalChangeRef.current().catch((nextError) => setError(displayError(nextError)));
      }, 180);
    };
    const unsubscribes = [
      "knowledge.page.changed",
      "knowledge.page.purged",
      "knowledge.project.created",
      "knowledge.project.deleted",
    ].map((eventId) => client.subscribe(eventId, onExternalChange));
    return () => {
      window.clearTimeout(timer);
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [client, persistenceReady]);

  /**
   * One write path for every caller. A shared Project is handled inside the
   * Operation now, so the editor no longer reaches past the Host to the
   * document — which is what left the assistant's writes invisible here.
   */
  const runMutation = (mutation, successMessage) => {
    setSaving(true);
    setError("");
    const queued = operationQueue.current.then(async () => {
      const current = pageRef.current;
      if (!current) return null;
      const result = await client.updatePage(current.projectId, current.id, current.revision, mutation);
      await loadPage(current.projectId, result.page.id);
      const loaded = await loadProjects(current.projectId);
      await loadPageLists(current.projectId, loaded.projects);
      if (successMessage) onToast(successMessage);
      return result;
    });
    operationQueue.current = queued.catch(() => {});
    queued.catch((nextError) => setError(displayError(nextError))).finally(() => setSaving(false));
    return queued;
  };

  const createUntitledPage = async () => {
    setError("");
    try {
      const allPages = await client.listPages(projectId, true);
      const titles = new Set(allPages.pages.map((page) => normalized(page.title)));
      let title = "無題";
      let suffix = 2;
      while (titles.has(normalized(title))) title = `無題 ${suffix++}`;
      const result = await client.createPage(projectId, title);
      await loadProjects(projectId);
      await loadPageLists(projectId);
      await loadPage(projectId, result.page.id);
      onToast("Pageを作成しました");
    } catch (nextError) {
      setError(displayError(nextError));
    }
  };

  const addBlockAfter = async (afterBlockId, blockType = "paragraph") => {
    const previousIds = new Set(pageRef.current?.blocks.map((block) => block.id) ?? []);
    const result = await runMutation({ type: "block-add", afterBlockId, blockType });
    const added = result?.page.blocks.find((block) => !previousIds.has(block.id));
    if (added) setAutoEditBlockId(added.id);
  };

  const pasteBlocks = async (mutation, { pastedBlockCount, hasPrefix }) => {
    const sourceIndex = pageRef.current?.blocks.findIndex((block) => block.id === mutation.blockId) ?? -1;
    const result = await runMutation(mutation);
    if (!result || sourceIndex < 0) return result;
    const focusIndex = sourceIndex + (hasPrefix ? 1 : 0) + pastedBlockCount - 1;
    const focusBlock = result.page.blocks[focusIndex];
    if (focusBlock) setAutoEditBlockId(focusBlock.id);
    return result;
  };

  /** Shared by the picker, native OS drop, and clipboard paste — each only differs in how it gets a resource ID. */
  const insertImageBlock = (resourceId) => {
    const afterBlockId = pageRef.current?.blocks.at(-1)?.id;
    return runMutation({ type: "block-add", afterBlockId, blockType: "image", text: resourceId }, "画像を追加しました");
  };

  const addImageBlock = async () => {
    try {
      const resourceId = await client.pickImage();
      if (!resourceId) return;
      await insertImageBlock(resourceId);
    } catch (nextError) {
      setError(String(nextError?.message ?? nextError));
    }
  };

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const storeImageFile = async (file) => {
    try {
      const resourceId = await client.storeImageBytes(await fileToBase64(file));
      await insertImageBlock(resourceId);
    } catch (nextError) {
      setError(String(nextError?.message ?? nextError));
    }
  };

  const pasteImage = async (event) => {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith("image/"));
    if (!item) return;
    event.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    await storeImageFile(file);
  };

  /**
   * The window disables Tauri's native `dragDropEnabled` (see
   * `tauri.conf.json`) so it never intercepts HTML5 drag-and-drop out from
   * under Block reordering, which means a dropped file arrives here as an
   * ordinary `dataTransfer.files` list instead of a native path event.
   */
  const dropImageFiles = async (fileList) => {
    const files = [...fileList].filter((file) => file.type.startsWith("image/"));
    for (const file of files) {
      await storeImageFile(file);
    }
  };

  useEffect(() => {
    // `paste` only reaches a listener on the DOM subtree the focused element
    // bubbles through; with no Block focused there may be nothing under
    // `.knowledge-blocks` to bubble from at all. A document-level listener,
    // active only while an editable Page is actually open, catches a paste
    // regardless of what (if anything) currently has focus.
    if (!desktop || readOnly || !pageData?.page) return undefined;
    document.addEventListener("paste", pasteImage);
    return () => document.removeEventListener("paste", pasteImage);
  }, [desktop, readOnly, pageData?.page, pasteImage]);

  const refreshSyncEndpoints = async () => {
    const endpoints = await client.listSync();
    setSyncByProject(Object.fromEntries(endpoints.map((item) => [item.projectId, item])));
  };

  useEffect(() => {
    if (!desktop) return;
    refreshSyncEndpoints().catch(() => {});
  }, [desktop]);

  /**
   * A shared Project is edited through its Yjs document instead of the JSON
   * store, so the session lives as long as that Project is selected.
   */
  useEffect(() => {
    const endpoint = syncByProject[projectId];
    if (!endpoint?.token) {
      sharedRef.current?.dispose();
      sharedRef.current = null;
      client.setSharedSession(projectId, null);
      setSyncStatus("idle");
      setMemberProfiles({});
      setOnlineProfiles({});
      presenceAcknowledgedRef.current.clear();
      return undefined;
    }

    presenceAcknowledgedRef.current.clear();
    const shared = createSharedProject({
      endpoint: endpoint.endpoint,
      projectId,
      token: endpoint.token,
      onChange: () => setSharedRevision((value) => value + 1),
      onStatus: ({ status }) => {
        setSyncStatus(status);
        // A transient failure right after a fresh deploy (the workers.dev route
        // still propagating) recovers on the next automatic retry; do not leave
        // its banner up once the socket is actually connected again.
        if (status === "connected") {
          setError((current) => (current.startsWith("同期エラー") ? "" : current));
          setOnlineProfiles((current) => ({ ...current, [activeProfile.profileId]: activeProfile }));
          shared.sendPresence({ displayName: activeProfile.displayName, avatarUrl: activeProfile.avatarUrl });
        } else if (status === "offline" || status === "idle") {
          setOnlineProfiles({});
        }
      },
      onError: (nextError) => setError(`同期エラー：${nextError.message}`),
      onPresence: ({ profileId: peerProfileId, state }) => {
        if (typeof peerProfileId !== "string" || !peerProfileId) return;
        if (!state) presenceAcknowledgedRef.current.delete(peerProfileId);
        setOnlineProfiles((current) => {
          if (!state) {
            const next = { ...current };
            delete next[peerProfileId];
            return next;
          }
          const displayName = typeof state.displayName === "string" && state.displayName.trim()
            ? state.displayName.trim().slice(0, 120)
            : "共同編集者";
          const avatarUrl = typeof state.avatarUrl === "string" && /^https:\/\//.test(state.avatarUrl) && state.avatarUrl.length <= 2048
            ? state.avatarUrl
            : null;
          return { ...current, [peerProfileId]: { profileId: peerProfileId, displayName, avatarUrl } };
        });
        // Older deployed Workers do not replay existing awareness to a
        // newcomer. Answer each newly seen peer once so both sides become
        // visible without creating an awareness echo loop.
        if (state && peerProfileId !== activeProfile.profileId && !presenceAcknowledgedRef.current.has(peerProfileId)) {
          presenceAcknowledgedRef.current.add(peerProfileId);
          shared.sendPresence({ displayName: activeProfile.displayName, avatarUrl: activeProfile.avatarUrl });
        }
      },
    });
    sharedRef.current = shared;
    // Every caller of knowledge.page.* now reaches this document, the assistant
    // included, instead of writing to the JSON store the editor stopped reading.
    client.setSharedSession(projectId, shared);
    shared.setMemberProfile(activeProfile, profileId);
    // Pages written before this Project was shared must reach the others.
    client.listPages(projectId, false)
      .then(async ({ pages }) => {
        const full = await Promise.all(pages.map((page) => client.readPage(projectId, page.id)));
        shared.adopt(full.map((item) => item.page));
      })
      .catch(() => {})
      .finally(() => shared.connect());

    return () => {
      shared.dispose();
      sharedRef.current = null;
      client.setSharedSession(projectId, null);
      setSyncStatus("idle");
      setOnlineProfiles({});
      presenceAcknowledgedRef.current.clear();
    };
  }, [projectId, syncByProject[projectId]?.token, syncByProject[projectId]?.endpoint, activeProfile.displayName, activeProfile.avatarUrl, profileId]);

  /**
   * Re-reads the shared document after it moves, whether the edit came from
   * this device or a peer. A Block being typed into keeps its own text until
   * it loses focus, so a collaborator's update never yanks the caret away.
   */
  useEffect(() => {
    const shared = sharedRef.current;
    if (!shared || !sharedRevision) return;
    const sharedPages = shared.listPages();
    setMemberProfiles(Object.fromEntries(shared.listMemberProfiles().map((item) => [item.profileId, item])));
    setLinkCandidates(sharedPages);
    setPages(sharedPages);
    if (selectedPageId) {
      const next = shared.readPage(selectedPageId);
      if (next) setPageData(next);
    }
  }, [sharedRevision, selectedPageId]);

  /** Claims this Project on a server the User operates. */
  const connectShare = async ({ endpoint, secret }) => {
    setShareBusy(true);
    setError("");
    try {
      await client.connectSync({ projectId, endpoint, secret });
      await refreshSyncEndpoints();
      setShareMode(null);
      onToast("このProjectを共有サーバーに接続しました");
    } catch (nextError) {
      setError(String(nextError?.message ?? nextError));
    } finally {
      setShareBusy(false);
    }
  };

  const getCloudflareStatus = () => client.cloudflareStatus();

  const saveCloudflareCredentials = (accountId, apiToken) => client.setCloudflareCredentials(accountId, apiToken);

  const clearCloudflareCredentials = () => client.clearCloudflareCredentials();

  /** Deploys (or redeploys) this account's one Worker, then claims this Project on it. */
  const deployAndShare = async () => {
    setShareBusy(true);
    try {
      const { endpoint, secret } = await client.deploySyncServer();
      await client.connectSync({ projectId, endpoint, secret });
      await refreshSyncEndpoints();
      setShareMode(null);
      onToast("Cloudflareにデプロイして共有を開始しました");
    } finally {
      setShareBusy(false);
    }
  };

  const deleteWorker = async () => {
    await client.deleteSyncServer();
    onToast("Workerを削除しました");
  };

  /** Joins a Project already shared on someone else's server. */
  const joinShare = async ({ endpoint, sharedProjectId, invite }) => {
    setShareBusy(true);
    setError("");
    try {
      await client.joinSync({ projectId: sharedProjectId, endpoint, invite });
      await refreshSyncEndpoints();
      setShareMode(null);
      onToast("共有Projectに参加しました");
    } catch (nextError) {
      setError(String(nextError?.message ?? nextError));
    } finally {
      setShareBusy(false);
    }
  };

  const issueInvite = async (role) => {
    setShareBusy(true);
    setError("");
    try {
      setShareInvite(await client.createInvite({ projectId, role }));
    } catch (nextError) {
      setError(String(nextError?.message ?? nextError));
    } finally {
      setShareBusy(false);
    }
  };

  const stopSharing = async () => {
    setShareBusy(true);
    try {
      await client.disconnectSync(projectId);
      await refreshSyncEndpoints();
      setShareMode(null);
      onToast("この端末での同期を停止しました");
    } catch (nextError) {
      setError(String(nextError?.message ?? nextError));
    } finally {
      setShareBusy(false);
    }
  };

  const dropBlock = (beforeBlockId) => {
    const blockId = dragBlockId;
    setDragBlockId(null);
    setDragOverBlockId(null);
    if (!blockId || blockId === beforeBlockId) return;
    runMutation({ type: "block-move", blockId, beforeBlockId });
  };

  const createNewProject = async (event) => {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const result = await client.createProject(newProjectName.trim());
      const loaded = await loadProjects(result.project.id);
      setNewProjectName("");
      setNewProjectOpen(false);
      setSelectedPageId(null);
      setPageData(null);
      await loadPageLists(loaded.projectId, loaded.projects);
      onToast("Projectを作成しました");
    } catch (nextError) {
      setError(displayError(nextError));
    }
  };

  const saveProjectSettings = async ({ name, colors }) => {
    setProjectSettingsBusy(true);
    setError("");
    try {
      if (name !== currentProject?.name) await client.renameProject(projectId, name);
      const changedColors = Object.entries(colors).filter(([memberProfileId, color]) => memberColors[memberProfileId] !== color);
      for (const [memberProfileId, color] of changedColors) {
        await client.setMemberColor(projectId, memberProfileId, color);
      }
      await Promise.all([loadProjects(projectId), loadMemberColors(projectId)]);
      onToast("Project設定を保存しました");
    } catch (nextError) {
      setError(displayError(nextError));
      throw nextError;
    } finally {
      setProjectSettingsBusy(false);
    }
  };

  const listProjectMembers = useCallback((targetProjectId) => client.listMembers(targetProjectId), [client]);
  const listProjectMemberColors = useCallback((targetProjectId) => client.listMemberColors(targetProjectId), [client]);

  const removeProjectMember = async (targetProjectId, memberProfileId) => {
    await client.removeMember(targetProjectId, memberProfileId);
    onToast("メンバーを削除しました");
  };

  const deleteCurrentProject = async () => {
    if (!projectId) return;
    try {
      await client.deleteProject(projectId);
      setConfirmDeleteProject(false);
      setProjectSettingsOpen(false);
      setSelectedPageId(null);
      setPageData(null);
      const loaded = await loadProjects();
      await loadPageLists(loaded.projectId, loaded.projects);
      onToast("Projectを削除しました");
    } catch (nextError) {
      setConfirmDeleteProject(false);
      setError(displayError(nextError));
    }
  };

  const selectPage = async (nextProjectId, pageId) => {
    setError("");
    try {
      if (nextProjectId !== projectId) setProjectId(nextProjectId);
      await loadPage(nextProjectId, pageId);
    } catch (nextError) {
      setError(displayError(nextError));
    }
  };

  const openSearchCandidate = async (candidate) => {
    if (!candidate) return;
    setSearchSuggestionsOpen(false);
    setQuery("");
    await selectPage(candidate.projectId ?? projectId, candidate.id);
    window.setTimeout(() => document.getElementById("knowledge-editor")?.focus(), 0);
  };

  const handleSearchKeyDown = (event) => {
    if (!searchSuggestionsVisible) return;
    const action = pageSearchKeyAction(event, activeSearchSuggestion, searchCandidates.length);
    if (!action) return;
    event.preventDefault();
    if (action.type === "move") setActiveSearchSuggestion(action.index);
    if (action.type === "close") setSearchSuggestionsOpen(false);
    if (action.type === "open") openSearchCandidate(searchCandidates[action.index]);
  };

  const moveToTrash = async () => {
    const page = pageRef.current;
    if (!page) return;
    try {
      await client.moveToTrash(page.projectId, page.id, page.revision);
      setPageData(null);
      setSelectedPageId(null);
      await loadProjects(page.projectId);
      await loadPageLists(page.projectId);
      onToast("PageをTrashへ移動しました");
    } catch (nextError) {
      setError(displayError(nextError));
    }
  };

  const restoreCurrentPage = async () => {
    const page = pageRef.current;
    if (!page) return;
    try {
      const result = await client.restorePage(page.projectId, page.id, page.revision);
      await loadPage(page.projectId, result.page.id);
      await loadProjects(page.projectId);
      await loadPageLists(page.projectId);
      onToast("Pageを復元しました");
    } catch (nextError) {
      setError(displayError(nextError));
    }
  };

  const purgeCurrentPage = async () => {
    const page = pageRef.current;
    if (!page) return;
    try {
      await client.purgePage(page.projectId, page.id, page.revision);
      setConfirmPurge(false);
      setPageData(null);
      setSelectedPageId(null);
      await loadProjects(page.projectId);
      await loadPageLists(page.projectId);
      onToast("Pageを完全に削除しました");
    } catch (nextError) {
      setConfirmPurge(false);
      setError(displayError(nextError));
    }
  };

  const openHistory = async () => {
    const page = pageRef.current;
    if (!page) return;
    try {
      const result = await client.readHistory(page.projectId, page.id);
      setHistoryEntries(result.entries);
      setHistoryOpen(true);
    } catch (nextError) {
      setError(displayError(nextError));
    }
  };

  const restoreHistoryEntry = async (historyId) => {
    const page = pageRef.current;
    if (!page) return;
    try {
      const result = await client.restoreHistory(page.projectId, page.id, page.revision, historyId);
      await loadPage(page.projectId, result.page.id);
      const history = await client.readHistory(page.projectId, page.id);
      setHistoryEntries(history.entries);
      onToast("以前の版を新しいrevisionとして復元しました");
    } catch (nextError) {
      setError(displayError(nextError));
    }
  };

  const activeTagLabels = pageData?.tags.map((tag) => tag.label) ?? [];
  const pageTitle = pageData?.page.title ?? "Pageを選択";
  const pageState = pageData?.page.state ?? null;
  const selectedListPage = pages.find((page) => page.id === selectedPageId);

  useEffect(() => {
    const page = pageData?.page;
    onContextChange?.({
      label: page ? `${currentProject?.name ?? "Project"} / ${page.title}` : currentProject?.name ?? "Note",
      // Only a specific open Page carries enough identity (Project ID, Page
      // ID, revision) for the assistant to construct valid Operation input;
      // browsing a Project list alone reports a label but no context (ADR 0025).
      appId: page ? "knowledge" : null,
      operationContext: page ? {
        projectId: page.projectId,
        pageId: page.id,
        title: page.title,
        revision: page.revision,
        blocks: page.blocks.map((block) => ({ id: block.id, type: block.type, text: block.text })),
      } : null,
    });
  }, [currentProject?.name, onContextChange, pageData?.page?.id, pageData?.page?.title, pageData?.page?.revision, pageData?.page?.blocks]);

  if (!persistenceReady) {
    return (
      <section className="knowledge-shell knowledge-setup" aria-labelledby="knowledge-setup-title">
        <div>
          <ShieldCheck size={42} weight="duotone" aria-hidden="true" />
          <h1 id="knowledge-setup-title">保存場所を設定してください</h1>
          <p>ローカルWorkspaceが必要です。</p>
          <div><button type="button" onClick={onClose}>戻る</button><button type="button" className="knowledge-primary-button" onClick={onOpenSettings}>設定を開く</button></div>
        </div>
      </section>
    );
  }

  return (
    <section className={`knowledge-shell${selectedPageId ? " page-open" : ""}`} aria-label="Knowledge App">
      <header className="knowledge-topbar">
        <button type="button" className="knowledge-icon-button" aria-label="MyBoxへ戻る" data-tooltip="MyBoxへ戻る" onClick={onClose}><ArrowLeft size={22} /></button>
        <div className="knowledge-brand"><FileText size={23} weight="duotone" aria-hidden="true" /><span><strong>Note</strong><small>Knowledge</small></span></div>
        <ThemedSelect id="knowledge-project" label="現在のProject" options={projectOptions} value={projectId} onChange={(value) => {
          setProjectId(value);
          setSelectedPageId(null);
          setPageData(null);
        }} placement="bottom" className="knowledge-project-select" />
        <div className="knowledge-search-wrap">
          <label className="knowledge-search">
            <span className="sr-only">Pageを検索</span>
            <MagnifyingGlass size={18} aria-hidden="true" />
            <input
              ref={searchInputRef}
              role="combobox"
              value={query}
              onFocus={() => setSearchSuggestionsOpen(Boolean(query.trim()))}
              onBlur={() => setSearchSuggestionsOpen(false)}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveSearchSuggestion(0);
                setSearchSuggestionsOpen(Boolean(event.target.value.trim()));
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="PageとBlockを検索"
              aria-keyshortcuts="Control+P"
              aria-autocomplete="list"
              aria-expanded={searchSuggestionsVisible}
              aria-controls="knowledge-search-suggestions"
              aria-activedescendant={searchSuggestionsVisible && searchCandidates.length ? `knowledge-search-option-${activeSearchSuggestion}` : undefined}
              aria-describedby="knowledge-search-help"
            />
            {!query && <kbd aria-hidden="true">Ctrl P</kbd>}
            {query && <button type="button" aria-label="検索をクリア" onMouseDown={(event) => event.preventDefault()} onClick={() => {
              setQuery("");
              setSearchSuggestionsOpen(false);
              searchInputRef.current?.focus();
            }}><X size={16} /></button>}
          </label>
          <span id="knowledge-search-help" className="sr-only">候補はTabで次へ、ShiftとTabで前へ移動し、EnterでPageを開きます。</span>
          {searchSuggestionsVisible && (
            <div id="knowledge-search-suggestions" className="knowledge-search-suggestions" role="listbox" aria-label="Page検索候補">
              {searchCandidates.length ? searchCandidates.map((candidate, index) => {
                const candidateProject = projects.find((project) => project.id === (candidate.projectId ?? projectId));
                const selected = index === activeSearchSuggestion;
                return (
                  <button
                    id={`knowledge-search-option-${index}`}
                    key={`${candidate.projectId ?? projectId}-${candidate.id}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    className={selected ? "selected" : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSearchSuggestion(index)}
                    onClick={() => openSearchCandidate(candidate)}
                  >
                    <FileText size={17} weight={selected ? "fill" : "regular"} aria-hidden="true" />
                    <span>
                      <strong>{candidate.title}</strong>
                      <small>{candidateProject?.name ?? currentProject?.name ?? "Project"}{candidate.state === "trash" ? " · Trash" : ""}{candidate.excerpt ? ` · ${candidate.excerpt}` : ""}</small>
                    </span>
                    {selected && <CaretRight size={16} weight="bold" aria-hidden="true" />}
                  </button>
                );
              }) : (
                <div className="knowledge-search-empty">一致するPageがありません</div>
              )}
              <div className="knowledge-search-keys" aria-hidden="true"><kbd>Tab</kbd> 選択 <kbd>Enter</kbd> 開く <kbd>Esc</kbd> 閉じる</div>
            </div>
          )}
        </div>
        <span className={`knowledge-save-state${saving ? " saving" : ""}`} role="status">{saving ? "保存中…" : "保存済み"}</span>
        {/* One grid track holds every trailing control, so adding or removing an
            action never rewrites the topbar's responsive column lists. */}
        <div className="knowledge-topbar-actions">
        <div className="knowledge-share-menu" ref={shareMenuRef}>
          <button
            type="button"
            className={`knowledge-icon-button${sharePopoverOpen ? " active" : ""}`}
            aria-label={isCurrentProjectShared ? `共有設定（共有中・${syncByProject[projectId].role}）` : "共有"}
            aria-haspopup="menu"
            aria-expanded={sharePopoverOpen}
            data-tooltip="共有"
            onClick={() => setSharePopoverOpen((open) => !open)}
          >
            <UsersThree size={21} weight={isCurrentProjectShared ? "fill" : "regular"} />
            {isCurrentProjectShared && <span className="knowledge-share-dot" aria-hidden="true" />}
          </button>
          {sharePopoverOpen && (
            <div className="knowledge-share-popover" role="menu" aria-label="共有">
              {isCurrentProjectShared ? (
                <>
                  <p><UsersThree size={16} aria-hidden="true" />共有中・{syncByProject[projectId].role}</p>
                  <small className={syncStatus === "connected" ? "knowledge-sync-live" : undefined}>
                    {syncStatus === "connected" ? "同期中" : syncStatus === "connecting" ? "接続中…" : "オフライン（編集はこの端末に保存されます）"}
                  </small>
                  <small>{syncByProject[projectId].endpoint}</small>
                  <div>
                    <button type="button" role="menuitem" disabled={shareBusy || syncByProject[projectId].role !== "owner"} onClick={() => { setShareInvite(""); setShareMode("invite"); setSharePopoverOpen(false); }}>招待</button>
                    <button type="button" role="menuitem" disabled={shareBusy} onClick={() => { stopSharing(); setSharePopoverOpen(false); }}>停止</button>
                  </div>
                </>
              ) : (
                <>
                  <small>{desktop ? "このProjectはこの端末だけにあります。" : "共有はデスクトップ版で利用できます。"}</small>
                  <div>
                    <button type="button" role="menuitem" disabled={!desktop || shareBusy} onClick={() => { setShareMode("connect"); setSharePopoverOpen(false); }}>共有を開始</button>
                    <button type="button" role="menuitem" disabled={!desktop || shareBusy} onClick={() => { setShareMode("join"); setSharePopoverOpen(false); }}>招待から参加</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <button type="button" className="knowledge-icon-button" aria-label="Project設定" data-tooltip="Project設定" disabled={!currentProject} onClick={() => setProjectSettingsOpen(true)}><Gear size={21} /></button>
        <button type="button" className={`knowledge-icon-button knowledge-assistant-toggle${assistantOpen ? " active" : ""}`} aria-label={assistantOpen ? "AIアシスタントを閉じる" : "AIアシスタントを開く"} aria-pressed={assistantOpen} aria-controls="assistant-panel" data-tooltip="AIアシスタント" onClick={onToggleAssistant}><Robot size={21} weight={assistantOpen ? "fill" : "regular"} /></button>
        <button type="button" className="knowledge-icon-button knowledge-close" aria-label="閉じる" data-tooltip="閉じる" onClick={onClose}><X size={22} /></button>
        </div>
      </header>

      <aside className="knowledge-sidebar" aria-label="Projectナビゲーション">
        <nav className="knowledge-nav" aria-label="Pageの状態">
          <button type="button" className={!includeTrash ? "active" : ""} aria-pressed={!includeTrash} onClick={() => setIncludeTrash(false)}><FileText size={18} />Active<span>{currentProject?.activePageCount ?? 0}</span></button>
          <button type="button" className={includeTrash ? "active" : ""} aria-pressed={includeTrash} onClick={() => setIncludeTrash(true)}><Trash size={18} />Trashを含む<span>{currentProject?.trashPageCount ?? 0}</span></button>
        </nav>

        <div className="knowledge-sidebar-section">
          <div className="knowledge-sidebar-heading"><span>検索範囲</span></div>
          <ThemedSelect id="knowledge-search-scope" label="検索するProject" options={scopeOptions} value={searchScope} onChange={setSearchScope} placement="bottom" className="knowledge-scope-select" />
        </div>

        <div className="knowledge-sidebar-section knowledge-project-section">
          <div className="knowledge-sidebar-heading"><span>Projects</span><button type="button" aria-label="Projectを追加" onClick={() => setNewProjectOpen((value) => !value)}><FolderSimplePlus size={18} /></button></div>
          {projects.map((project) => (
            <button key={project.id} type="button" className={project.id === projectId ? "knowledge-project-row active" : "knowledge-project-row"} aria-current={project.id === projectId ? "true" : undefined} onClick={() => {
              setProjectId(project.id);
              setSelectedPageId(null);
              setPageData(null);
            }}>
              <span className="knowledge-project-dot" aria-hidden="true" />
              <span><strong>{project.name}</strong><small>{syncByProject[project.id] ? `${project.role}・共有中` : project.role}</small></span>
              {syncByProject[project.id]
                ? <UsersThree size={15} aria-label="共有Project" />
                : <span>{project.activePageCount}</span>}
            </button>
          ))}
          {newProjectOpen && (
            <form className="knowledge-new-project" onSubmit={createNewProject}>
              <label htmlFor="knowledge-project-name">新しいProject名</label>
              <input id="knowledge-project-name" autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
              <div><button type="button" onClick={() => setNewProjectOpen(false)}>取消</button><button type="submit" disabled={!newProjectName.trim()}>作成</button></div>
            </form>
          )}
        </div>

      </aside>

      <section className="knowledge-page-list" aria-labelledby="knowledge-pages-title">
        <div className="knowledge-page-list-header">
          <div><h1 id="knowledge-pages-title">{query ? "検索結果" : includeTrash ? "Active + Trash" : "Pages"}</h1><span>{pages.length}</span></div>
          <button type="button" aria-label="新しいPage" data-tooltip="新しいPage" onClick={createUntitledPage}><Plus size={19} /></button>
        </div>
        {loading ? <div className="knowledge-list-status"><span className="spinner" />読み込み中…</div> : pages.length ? (
          <ul className="knowledge-pages">
            {pages.map((page) => (
              <li key={`${page.projectId}-${page.id}`}>
                <button type="button" className={page.id === selectedPageId ? "knowledge-page-row active" : "knowledge-page-row"} aria-current={page.id === selectedPageId ? "page" : undefined} onClick={() => selectPage(page.projectId ?? projectId, page.id)}>
                  <FileText size={18} weight={page.id === selectedPageId ? "fill" : "regular"} aria-hidden="true" />
                  <span><strong>{page.title}</strong><small>{page.excerpt || "空のPage"}</small></span>
                  {page.state === "trash" ? <span className="knowledge-trash-badge">Trash</span> : <CaretRight size={16} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="knowledge-list-empty"><FileText size={28} aria-hidden="true" /><strong>{query ? "一致するPageがありません" : "まだPageがありません"}</strong>{!query && <button type="button" onClick={createUntitledPage}><Plus size={17} />Pageを作成</button>}</div>
        )}
      </section>

      <main className="knowledge-editor" id="knowledge-editor" tabIndex={-1}>
        {error && <div className="knowledge-error" role="alert"><span>{error}</span><button type="button" aria-label="エラーを閉じる" onClick={() => setError("")}><X size={17} /></button></div>}
        {pageData ? (
          <>
            <div className="knowledge-mobile-editor-back"><button type="button" onClick={() => {
              setSelectedPageId(null);
              setPageData(null);
            }}><ArrowLeft size={18} />Page一覧</button></div>
            <article className="knowledge-page">
              <header className="knowledge-page-header">
                <div className="knowledge-page-meta">
                  <span>{currentProject?.name}</span><CaretRight size={13} aria-hidden="true" /><span>revision {pageData.page.revision}</span>
                  {pageState === "trash" && <span className="knowledge-trash-badge">Trash</span>}
                </div>
                <div className="knowledge-page-actions">
                  {isCurrentProjectShared && visibleOnlineProfiles.length > 0 && (
                    <div className="knowledge-online-users" aria-label="オンラインユーザー">
                      {visibleOnlineProfiles.map((onlineProfile) => <OnlineProfileAvatar key={onlineProfile.profileId} profile={onlineProfile} />)}
                    </div>
                  )}
                  <button type="button" aria-label="Page履歴" data-tooltip="履歴" onClick={openHistory}><ClockCounterClockwise size={18} /></button>
                  {pageState === "active" ? (
                    <button type="button" aria-label="PageをTrashへ移動" data-tooltip="Trashへ" disabled={currentProject?.role === "viewer"} onClick={moveToTrash}><Trash size={18} /></button>
                  ) : (
                    <button type="button" aria-label="Pageを復元" data-tooltip="復元" disabled={currentProject?.role === "viewer"} onClick={restoreCurrentPage}><ArrowUDownLeft size={18} /></button>
                  )}
                  {currentProject?.role === "owner" && <button type="button" className="danger" aria-label="Pageを完全に削除" data-tooltip="完全削除" onClick={() => setConfirmPurge(true)}><Trash size={18} /></button>}
                </div>
              </header>

              <label className="knowledge-title-field">
                <span>Page title</span>
                <input
                  key={`${pageData.page.id}-${pageData.page.revision}-title`}
                  defaultValue={pageData.page.title}
                  readOnly={readOnly}
                  onBlur={(event) => {
                    const title = event.target.value.trim();
                    if (title && title !== pageRef.current?.title) runMutation({ type: "rename", title }, "タイトルを保存しました");
                  }}
                />
              </label>

              <TagsEditor
                key={`${pageData.page.id}-tags`}
                tags={activeTagLabels}
                candidates={tagCandidates}
                readOnly={readOnly}
                onCommit={(labels) => {
                  if (labels.join("|") !== activeTagLabels.join("|")) runMutation({ type: "tags-set", labels });
                }}
              />

              {pageState === "trash" && <div className="knowledge-trash-notice"><Trash size={19} aria-hidden="true" /><div><strong>このPageはTrashにあります</strong><p>内容は読み取り専用です。編集するには復元してください。</p></div></div>}

              <div
                className="knowledge-blocks"
                aria-label={`${pageTitle}のBlocks`}
                onDragOver={(event) => {
                  if (readOnly) return;
                  // Each Block claims its own dragover and stops it from bubbling
                  // here, so an event reaching this container is over a gap
                  // *between* Blocks (their margins) rather than over one. Without
                  // claiming it too, the browser falls back to a "not allowed"
                  // cursor the instant the pointer crosses that gap during an
                  // in-page reorder drag, even though dropping is still valid.
                  if (event.dataTransfer?.types?.includes("Files")) {
                    if (desktop) event.preventDefault();
                    return;
                  }
                  if (dragBlockId) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (readOnly) return;
                  if (event.dataTransfer?.types?.includes("Files")) {
                    if (!desktop) return;
                    event.preventDefault();
                    dropImageFiles(event.dataTransfer.files);
                    return;
                  }
                  if (dragBlockId) {
                    event.preventDefault();
                    dropBlock(dragOverBlockId === "__end__" ? null : dragOverBlockId);
                  }
                }}
              >
                {pageData.page.blocks.map((block, index) => (
                  <BlockRow
                    key={block.id}
                    block={block}
                    authorColor={authorColorFor(block.updatedBy, memberColors[block.updatedBy])}
                    authorName={profileNameFor(block.updatedBy)}
                    showAuthor={isCurrentProjectShared}
                    blockIndex={index}
                    blockCount={pageData.page.blocks.length}
                    autoEdit={autoEditBlockId === block.id}
                    linkCandidates={linkCandidates}
                    readOnly={readOnly}
                    onCommit={runMutation}
                    onAddAfter={addBlockAfter}
                    onPasteBlocks={pasteBlocks}
                    onRemove={(blockId) => runMutation({ type: "block-remove", blockId })}
                    onOpenPage={(targetId) => selectPage(projectId, targetId)}
                    onOpenUrl={(url) => client.openExternalUrl(url).catch((nextError) => setError(String(nextError?.message ?? nextError)))}
                    onReadImage={(resourceId) => client.readImage(resourceId)}
                    onAutoEditHandled={() => setAutoEditBlockId(null)}
                    isDragging={dragBlockId === block.id}
                    isDragOver={dragOverBlockId === block.id && dragBlockId !== block.id}
                    onDragStart={setDragBlockId}
                    onDragEnterBlock={setDragOverBlockId}
                    onDropBlock={dropBlock}
                    onDragEnd={() => {
                      setDragBlockId(null);
                      setDragOverBlockId(null);
                    }}
                  />
                ))}
                {!readOnly && dragBlockId && (
                  <div
                    className={`knowledge-block-dropzone${dragOverBlockId === "__end__" ? " drag-over" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragOverBlockId("__end__");
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      dropBlock(null);
                    }}
                  />
                )}
                {!readOnly && (
                  <div className="knowledge-add-block-row">
                    <button type="button" className="knowledge-add-block" aria-label="Blockを追加" data-tooltip="Blockを追加" onClick={() => addBlockAfter(pageData.page.blocks.at(-1)?.id)}><Plus size={17} /></button>
                    <button type="button" className="knowledge-add-block" aria-label="画像を追加" data-tooltip={desktop ? "画像を追加" : "デスクトップ版で利用できます"} disabled={!desktop} onClick={addImageBlock}><ImageIcon size={17} /></button>
                  </div>
                )}
              </div>

              <section className="knowledge-backlinks" aria-labelledby="knowledge-backlinks-title">
                <h2 id="knowledge-backlinks-title"><LinkIcon size={18} aria-hidden="true" />被リンク <span>{pageData.backlinks.length}</span></h2>
                {pageData.backlinks.length ? pageData.backlinks.map((backlink) => (
                  <button key={`${backlink.pageId}-${backlink.blockId}`} type="button" onClick={() => selectPage(projectId, backlink.pageId)}><FileText size={17} /><span><strong>{backlink.pageTitle}</strong><small>{backlink.excerpt}</small></span><CaretRight size={16} /></button>
                )) : <p>このPageを参照しているActive Pageはありません。</p>}
              </section>
            </article>
          </>
        ) : (
          <div className="knowledge-editor-empty">
            <div><SidebarSimple size={42} weight="duotone" aria-hidden="true" /><h2>{selectedListPage?.title ?? "Pageを選択"}</h2></div>
          </div>
        )}
      </main>

      {historyOpen && (
        <aside className="knowledge-history" aria-labelledby="knowledge-history-title">
          <header><div><ClockCounterClockwise size={21} aria-hidden="true" /><h2 id="knowledge-history-title">Page履歴</h2></div><button type="button" aria-label="履歴を閉じる" onClick={() => setHistoryOpen(false)}><X size={20} /></button></header>
          <div>{historyEntries.length ? historyEntries.map((entry) => (
            <article key={entry.id}><div><strong>{entry.snapshot.title}</strong><time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time></div><small className="knowledge-history-author"><span className="knowledge-author-dot" style={{ backgroundColor: authorColorFor(entry.actorId, memberColors[entry.actorId]) }} aria-hidden="true" />{profileNameFor(entry.actorId)}・revision {entry.pageRevision}</small><button type="button" aria-label={`revision ${entry.pageRevision}を復元`} data-tooltip="この版を復元" disabled={readOnly} onClick={() => restoreHistoryEntry(entry.id)}><ClockCounterClockwise size={16} /></button></article>
          )) : <div className="knowledge-history-empty">復元できる履歴はまだありません。</div>}</div>
        </aside>
      )}

      {projectSettingsOpen && currentProject && (
        <ProjectSettingsDialog
          project={currentProject}
          activeProfileId={profileId}
          syncInfo={syncByProject[projectId]}
          busy={projectSettingsBusy}
          onSave={saveProjectSettings}
          onDeleteRequest={() => setConfirmDeleteProject(true)}
          onListMembers={listProjectMembers}
          onListMemberColors={listProjectMemberColors}
          onRemoveMember={removeProjectMember}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}

      {shareMode && (
        <ShareDialog
          mode={shareMode}
          busy={shareBusy}
          invite={shareInvite}
          inviteEndpoint={syncByProject[projectId]?.endpoint}
          inviteProjectId={projectId}
          projectName={currentProject?.name ?? ""}
          onConnect={connectShare}
          onJoin={joinShare}
          onInvite={issueInvite}
          onClose={() => { setShareMode(null); setShareInvite(""); }}
          onCloudflareStatus={getCloudflareStatus}
          onSaveCloudflareCredentials={saveCloudflareCredentials}
          onClearCloudflareCredentials={clearCloudflareCredentials}
          onDeployShare={deployAndShare}
          onDeleteWorker={deleteWorker}
        />
      )}

      {confirmPurge && (
        <ConfirmDialog
          title="Pageを完全に削除"
          description={`「${pageTitle}」のBlocksと履歴を削除し、タイトルを再利用可能にします。この操作は元に戻せません。`}
          actionLabel="完全に削除"
          onConfirm={purgeCurrentPage}
          onClose={() => setConfirmPurge(false)}
        />
      )}

      {confirmDeleteProject && (
        <ConfirmDialog
          title="Projectを削除"
          description={`「${currentProject?.name ?? ""}」とすべてのPage・Tag・履歴を削除します。この操作は元に戻せません。`}
          actionLabel="完全に削除"
          onConfirm={deleteCurrentProject}
          onClose={() => setConfirmDeleteProject(false)}
        />
      )}
    </section>
  );
}
