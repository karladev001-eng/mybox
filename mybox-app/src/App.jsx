import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { chooseWorkspace, getCurrentWorkspace, isDesktopRuntime } from "./desktop/workspace.js";
import { ChatView } from "./ChatView.jsx";
import { ThemedSelect } from "./ThemedSelect.jsx";
import { WorkflowHistoryView, WorkflowView } from "./WorkflowView.jsx";
import {
  appendChatMessage,
  buildConversationPrompt,
  createChatSession,
  createEmptyChatHistory,
  deleteChatSession,
  renameChatSession,
  sumSessionTokenUsage,
} from "./core/chat-history.js";
import { getChatHistoryStore } from "./desktop/chat-history.js";
import { createAggregateAgentHost, hasRegisteredAgentHosts } from "./core/agent-host-registry.js";
import { AgentRuntime } from "./core/agent-runtime.js";
import { getProfilePreferencesStore } from "./desktop/profile-preferences.js";
import { createDefaultProfilePreferences } from "./core/profile-preferences.js";
import { createSharedAppRuntime } from "./core/app-runtime.js";
import { resolveHostSession } from "./core/host-session.js";
import { getHostSessionStore } from "./desktop/host-session.js";
import { createCustomAppDefinition, createMyBoxAppRegistry } from "./apps/registry.js";
import { createDeviceAppInstallationsStore } from "./desktop/app-installations.js";
import { getHostUpdaterClient } from "./desktop/app-updater.js";
import { exitMyBox, getWorkflowBackgroundSettings, listenWorkflowNotifications, setWorkflowBackground } from "./desktop/workflow-background.js";
import { beginGitHubSignIn, completeGitHubSignIn, getAccountSession, signOutAccount } from "./desktop/accounts.js";
import { resolveProfilePresentation, signedOutSession } from "./core/account-identity.js";
import { openExternalUrl } from "./desktop/open-url.js";
import { compareAppVersions, isAppUpdateAvailable } from "./core/app-version.js";
import { buildCommandPaletteCommands, resolveAppKeyboardShortcut, resolveHostKeyboardShortcut } from "./core/keyboard-shortcuts.js";
import {
  CODEX_SUBSCRIPTION_PROVIDER_ID,
  LOCAL_LLM_PROVIDER_ID,
  OPENAI_API_PROVIDER_ID,
  codexSubscriptionProvider,
  configureLocalLlm,
  configureOpenAiApi,
  connectCodexSubscription,
  disconnectLocalLlm,
  disconnectOpenAiApi,
  getAgentProviderSettings,
  getCodexSubscriptionStatus,
  listCodexSkills,
  nativeAgentProviders,
  selectAgentProvider,
} from "./desktop/agent-providers.js";
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsClockwise,
  Bell,
  Check,
  ClockCounterClockwise,
  Code,
  Cube,
  Database,
  DotsThree,
  FlowArrow,
  FolderSimple,
  GearSix,
  GithubLogo,
  Globe,
  GlobeHemisphereWest,
  House,
  Image as ImageIcon,
  Keyboard,
  MagicWand,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimpleLine,
  Plus,
  Power,
  Robot,
  SignOut,
  SlidersHorizontal,
  Star,
  Trash,
  UserCircle,
  X,
} from "@phosphor-icons/react";

const iconMap = {
  image: ImageIcon,
  note: PencilSimpleLine,
  folder: FolderSimple,
  convert: ArrowsClockwise,
  publish: Globe,
  code: Code,
  data: Database,
  alert: Bell,
};

const navItems = [
  { id: "workflows", label: "ワークフロー", icon: FlowArrow },
  { id: "history", label: "履歴", icon: ClockCounterClockwise },
  { id: "settings", label: "設定", icon: GearSix },
];

const initialProviderSettings = {
  activeProviderId: CODEX_SUBSCRIPTION_PROVIDER_ID,
  openaiApi: { configured: false, model: "gpt-5.6" },
  localLlm: { configured: false, baseUrl: null, model: null },
};

/** How far the assistant may act before asking (ADR 0016), shown in the composer beside the other per-turn controls. */
const confirmationLevelOptions = [
  { id: "review", label: "確認", description: "Review：変更案を確認" },
  { id: "recoverable", label: "復旧可能", description: "Recoverable：復元可能な変更" },
  { id: "autonomous", label: "自律", description: "Autonomous：破壊的操作も許可" },
];

function confirmationLabel(levelId) {
  return confirmationLevelOptions.find((level) => level.id === levelId)?.label ?? levelId;
}

const providerLabels = Object.fromEntries(
  Object.entries(nativeAgentProviders).map(([id, provider]) => [id, provider.descriptor.name]),
);

const lazyAppSurfaces = new Map();

function resolveLazyAppSurface(app) {
  if (app.surface.kind !== "module") return null;
  if (!lazyAppSurfaces.has(app.id)) {
    lazyAppSurfaces.set(app.id, lazy(async () => {
      const module = await app.surface.load();
      const Component = module[app.surface.exportName];
      if (typeof Component !== "function") throw new Error(`${app.id} App surface export is invalid`);
      return { default: Component };
    }));
  }
  return lazyAppSurfaces.get(app.id);
}

function AppGlyph({ icon, color, size = 108 }) {
  const Icon = iconMap[icon] ?? Cube;
  return (
    <span className="app-glyph" style={{ "--app-color": color, "--glyph-box": `${size + 4}px` }} aria-hidden="true">
      <Icon size={size} weight="duotone" />
    </span>
  );
}

function IconButton({ label, children, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} data-tooltip={label} {...props}>
      {children}
    </button>
  );
}

function AppTile({ app, installedVersion, onOpen, onMenu, menuOpen, onDelete, onFavorite, onUpdate, updating }) {
  const versionComparison = compareAppVersions(installedVersion, app.version);
  const updateAvailable = versionComparison < 0;
  const installedAhead = versionComparison > 0;
  const launchBlocked = versionComparison !== 0 || updating;
  return (
    <article className="app-launcher" style={{ "--app-color": app.color }}>
      <button className="launcher-open-area" disabled={launchBlocked} onClick={() => onOpen(app)} aria-label={launchBlocked ? `${app.name}はバージョンを一致させてから開けます` : `${app.name}を開く`}>
        <AppGlyph icon={app.icon} color={app.color} size={34} />
        <span className="launcher-copy">
          <strong>{app.name}</strong>
          <small>{app.hint}</small>
          <span className="launcher-version">
            v{installedVersion}
            {updateAvailable ? <em>v{app.version} 利用可能</em> : <em className="current">{installedAhead ? "Registryより新しい版" : "最新版"}</em>}
          </span>
        </span>
      </button>
      <div className="launcher-actions">
        {updateAvailable && (
          <IconButton className="launcher-update-button" type="button" disabled={updating} onClick={() => onUpdate(app)} label={updating ? `${app.name}を更新中` : `${app.name}をバージョン${app.version}へ更新`}>
            <ArrowsClockwise size={17} aria-hidden="true" />
          </IconButton>
        )}
        <IconButton className="launcher-menu-button" label={`${app.name}のメニュー`} aria-expanded={menuOpen} onClick={() => onMenu(app.id)}>
          <DotsThree size={24} weight="bold" />
        </IconButton>
      </div>
      {menuOpen && (
        <div className="context-menu" role="menu">
          <button role="menuitem" onClick={() => onFavorite(app)}><Star size={19} />固定</button>
          <button className="danger" role="menuitem" onClick={() => onDelete(app)}><Trash size={19} />削除</button>
        </div>
      )}
    </article>
  );
}

function Modal({ title, onClose, children, className = "", backdropClassName = "" }) {
  const closeRef = useRef(null);
  const modalRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const preferredFocus = modalRef.current?.querySelector("[data-modal-initial-focus], [autofocus]");
    if (preferredFocus) preferredFocus.focus(); else closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...modalRef.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])")];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus?.();
    };
  }, []);

  return (
    <div className={`modal-backdrop ${backdropClassName}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={modalRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton ref={closeRef} label="閉じる" onClick={onClose}><X size={22} /></IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

const shortcutIcons = {
  "toggle-assistant": Robot,
  "command-palette": MagicWand,
  "new-chat": Plus,
  apps: Cube,
  workflows: FlowArrow,
  history: ClockCounterClockwise,
  settings: GearSix,
  chat: Robot,
  "add-app": Plus,
  "shortcut-menu": Keyboard,
  home: House,
};

function CommandPalette({ apps, activeApp, onClose, onRun }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
  const commands = buildCommandPaletteCommands(apps, activeApp).filter((command) => (
    !normalizedQuery
    || `${command.label} ${command.group} ${command.searchText ?? ""} ${command.displayKeys.join(" ")}`
      .toLocaleLowerCase("ja-JP")
      .includes(normalizedQuery)
  ));
  const groups = [...new Set(commands.map((shortcut) => shortcut.group))];
  return (
    <Modal title="コマンドパレット" onClose={onClose} className="shortcut-modal" backdropClassName="shortcut-backdrop">
      <div className="shortcut-search">
        <MagnifyingGlass size={18} aria-hidden="true" />
        <input
          autoFocus
          data-modal-initial-focus="true"
          aria-label="コマンドを検索"
          placeholder="コマンドを検索…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !commands.length) return;
            event.preventDefault();
            onRun(commands[0].id);
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <p className="shortcut-intro">検索してEnter、またはTabで項目へ移動して実行できます。</p>
      <div className="shortcut-groups">
        {groups.map((group) => (
          <section key={group} className="shortcut-group" aria-labelledby={`shortcut-${group}`}>
            <h3 id={`shortcut-${group}`}>{group}</h3>
            <div className="shortcut-list">
              {commands.filter((shortcut) => shortcut.group === group).map((shortcut, index) => {
                const Icon = shortcutIcons[shortcut.id] ?? iconMap[shortcut.appIcon] ?? Keyboard;
                const keyLabel = shortcut.displayKeys.map((key) => key === "Ctrl" ? "Control" : key).join("+");
                return (
                  <button
                    key={shortcut.id}
                    type="button"
                    onClick={() => onRun(shortcut.id)}
                    aria-keyshortcuts={keyLabel || undefined}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>{shortcut.label}</span>
                    {shortcut.displayKeys.length > 0 && (
                      <span className="shortcut-keys" aria-hidden="true">
                        {shortcut.displayKeys.map((key) => <kbd key={key}>{key}</kbd>)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {!commands.length && <p className="shortcut-empty">該当するコマンドはありません。</p>}
      </div>
    </Modal>
  );
}

function AddAppModal({ catalog, installedVersions, updatingAppId, onClose, onAdd, onUpdate }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("code");
  const colors = ["#67d7c4", "#8a74ff", "#ff796f", "#ffc45b", "#5f91ff"];
  const [color, setColor] = useState(colors[0]);

  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd(createCustomAppDefinition({ name: name.trim(), icon, color }));
  };

  return (
    <Modal title="アプリを追加" onClose={onClose} className="add-app-modal">
      <section className="app-catalog" aria-labelledby="registered-apps-title">
        <div className="app-catalog-heading"><div><h3 id="registered-apps-title">登録済みApp</h3><p>App Registryから安全に追加します</p></div><span>{catalog.length}</span></div>
        <div className="app-catalog-list">
          {catalog.map((app) => {
            const installedVersion = installedVersions[app.id];
            const installed = Boolean(installedVersion);
            const updateAvailable = installed && isAppUpdateAvailable(installedVersion, app.version);
            const updating = updatingAppId === app.id;
            return (
              <article key={app.id} style={{ "--app-color": app.color }}>
                <AppGlyph icon={app.icon} color={app.color} size={30} />
                <span>
                  <strong>{app.name}</strong>
                  <small>{app.hint}</small>
                  <span className={updateAvailable ? "catalog-version update" : "catalog-version"}>
                    {updateAvailable ? `v${installedVersion} → v${app.version}` : `v${installedVersion ?? app.version}`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={installed && !updateAvailable || updating}
                  onClick={() => updateAvailable ? onUpdate(app) : onAdd(app)}
                >
                  {updating ? "更新中…" : updateAvailable ? "更新" : installed ? "追加済み" : "追加"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
      <form className="add-form" onSubmit={submit}>
        <div className="app-form-heading"><h3>新しいAppの雛形</h3><p>汎用Surfaceを登録します</p></div>
        <label htmlFor="app-name">名前</label>
        <input id="app-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例：ログ解析" />
        <fieldset>
          <legend>アイコン</legend>
          <div className="choice-row">
            {Object.entries(iconMap).slice(0, 8).map(([key, Icon]) => (
              <button key={key} type="button" className={icon === key ? "choice selected" : "choice"} onClick={() => setIcon(key)} aria-label={`${key}アイコン`} aria-pressed={icon === key}>
                <Icon size={25} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>カラー</legend>
          <div className="choice-row">
            {colors.map((value) => (
              <button key={value} type="button" className={color === value ? "color-choice selected" : "color-choice"} style={{ "--choice-color": value }} onClick={() => setColor(value)} aria-label={`${value}を選択`} aria-pressed={color === value} />
            ))}
          </div>
        </fieldset>
        <button className="primary-button" type="submit" disabled={!name.trim()}><Plus size={20} />追加する</button>
      </form>
    </Modal>
  );
}

function AppWorkspace({ app, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      onDone(`${app.name}の処理が完了しました`);
    }, 900);
  };
  return (
    <Modal title={app.name} onClose={onClose} className="workspace-modal">
      <div className="workspace-body">
        <AppGlyph icon={app.icon} color={app.color} size={72} />
        <p>{app.hint}</p>
        <button className="drop-zone" onClick={run} disabled={busy}>
          {busy ? <span className="spinner" /> : <MagicWand size={30} />}
          <strong>{busy ? "処理中…" : "ここから始める"}</strong>
          <span>クリックしてサンプル処理を実行</span>
        </button>
      </div>
    </Modal>
  );
}

function RegisteredAppWorkspace({ app, desktop, profile, appRuntime, shortcutCommand, persistenceReady, assistantOpen, onToggleAssistant, onContextChange, onClose, onOpenSettings, onDone }) {
  const Surface = resolveLazyAppSurface(app);
  if (!Surface) return <AppWorkspace app={app} onClose={onClose} onDone={onDone} />;
  return (
    <Suspense fallback={<div className="modal-backdrop"><div className="workspace-body" role="status"><span className="spinner" /><strong>{app.name} Appを読み込んでいます…</strong></div></div>}>
      <Surface
        desktop={desktop}
        appRuntime={appRuntime}
        profileId={profile.profileId}
        profile={profile}
        shortcutCommand={shortcutCommand}
        persistenceReady={persistenceReady}
        assistantOpen={assistantOpen}
        onToggleAssistant={onToggleAssistant}
        onContextChange={onContextChange}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
        onToast={onDone}
      />
    </Suspense>
  );
}

function agentPlanLabel(status) {
  if (!status?.connected) return status?.available ? "未接続" : "要Codex";
  if (!status.planType) return "接続済み";
  return status.planType
    .split(/[-_]/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function ProviderRow({ icon: Icon, title, detail, badge, active, disabled, onSelect, onConfigure }) {
  return (
    <div className={active ? "provider-row active" : "provider-row"}>
      <button className="provider-select" onClick={onSelect} disabled={disabled}>
        <span className="settings-row-icon"><Icon size={24} weight="duotone" aria-hidden="true" /></span>
        <span className="settings-row-copy"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
      </button>
      {/* Without a gear the badge takes the gear's column too, so its right
          edge lines up with the buttons on every other Settings row. */}
      <span className={`settings-row-status${active ? " active" : ""}${onConfigure ? "" : " full-width"}`}>{badge}</span>
      {onConfigure && <IconButton label={`${title}を設定`} className="provider-config" onClick={onConfigure} disabled={disabled}><GearSix size={20} /></IconButton>}
    </div>
  );
}

function AccountRow({ desktop, session, busy, onSignIn, onSignOut }) {
  const detail = !desktop
    ? "デスクトップのみ"
    : busy ? "処理中…"
    : session.signedIn ? session.displayName
    : "共有時のみ";
  return (
    <div className={session.signedIn ? "provider-row active" : "provider-row"}>
      <button className="provider-select" onClick={session.signedIn ? undefined : onSignIn} disabled={!desktop || busy || session.signedIn}>
        <span className="settings-row-icon">
          {session.avatarUrl
            ? <img className="account-avatar" src={session.avatarUrl} alt="" width="24" height="24" />
            : <UserCircle size={24} weight="duotone" aria-hidden="true" />}
        </span>
        <span className="settings-row-copy"><strong>アカウント</strong><small>{detail}</small></span>
      </button>
      {session.signedIn
        ? <IconButton type="button" className="account-action" label="サインアウト" onClick={onSignOut} disabled={busy}><SignOut size={18} /></IconButton>
        : <IconButton type="button" className="account-action" label="GitHubでサインイン" onClick={onSignIn} disabled={!desktop || busy}><GithubLogo size={18} /></IconButton>}
    </div>
  );
}

function DeviceLoginModal({ login, onClose }) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(login.userCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal title="GitHubでサインイン" onClose={onClose}>
      <div className="device-login">
        <p>ブラウザで次のコードを入力してください。完了すると自動的にサインインします。</p>
        <div className="device-code" role="group" aria-label="確認コード">
          <code>{login.userCode}</code>
          <button type="button" onClick={copyCode}>{copied ? "コピーしました" : "コピー"}</button>
        </div>
        <button type="button" className="device-link" onClick={() => openExternalUrl(login.verificationUri)}>
          <ArrowSquareOut size={17} aria-hidden="true" />{login.verificationUri}
        </button>
        <p className="form-note">MyBoxはパスワードを受け取りません。認証はGitHub上で完結します。</p>
        <div className="provider-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The Confirmation-level gate `AgentRuntime` pauses at (ADR 0025) before a
 * write beyond the User's current level. Shows the exact Operation and input
 * the model chose, not just its name, so approval is an informed decision.
 */
function AgentApprovalModal({ request, onApprove, onReject }) {
  return (
    <Modal title="AIがProjectを更新しようとしています" onClose={onReject} className="confirm-modal">
      <div className="confirm-body">
        <Robot size={40} weight="duotone" aria-hidden="true" />
        <p><strong>{request.title}</strong></p>
        <p className="form-note">{request.reason}</p>
        <pre className="agent-approval-preview">{JSON.stringify(request.input, null, 2)}</pre>
        <div className="confirm-actions">
          <button onClick={onReject}>却下</button>
          <button className="danger-button" onClick={onApprove}><Robot size={19} />承認して実行</button>
        </div>
      </div>
    </Modal>
  );
}

function WorkflowBackgroundModal({ onChoose, onClose }) {
  return (
    <Modal title="バックグラウンド実行" onClose={onClose} className="confirm-modal">
      <div className="confirm-body workflow-background-prompt">
        <FlowArrow size={38} weight="duotone" aria-hidden="true" />
        <p>ウィンドウを閉じてもスケジュールを実行します。</p>
        <div className="confirm-actions stacked">
          <button type="button" onClick={() => onChoose(false)}>MyBox起動中のみ</button>
          <button type="button" className="primary-button" onClick={() => onChoose(true)}>PC起動時に開始</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Owns update state once so the Settings row and the corner prompt cannot
 * disagree about what is downloading or ready.
 */
function useHostUpdater(desktop) {
  const updaterRef = useRef(null);
  if (!updaterRef.current) updaterRef.current = getHostUpdaterClient();
  const updater = updaterRef.current;
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("idle");
  const [pending, setPending] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!desktop) return undefined;
    let active = true;
    updater.currentVersion().then((value) => active && setVersion(value ?? "")).catch(() => {});
    return () => { active = false; };
  }, [desktop]);

  const check = async ({ silent = false } = {}) => {
    if (!silent) {
      setStatus("checking");
      setError("");
    }
    try {
      const result = await updater.check();
      if (result.available) {
        setPending(result.update);
        setStatus("available");
      } else if (!silent) {
        setStatus("up-to-date");
      }
    } catch (nextError) {
      // A silent startup check must not shout at a User who is simply offline.
      if (silent) return;
      setError(String(nextError?.message ?? nextError));
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!desktop) return;
    check({ silent: true });
  }, [desktop]);

  const install = async () => {
    if (!pending) return;
    setStatus("downloading");
    setProgress({ downloaded: 0, total: 0 });
    try {
      await updater.downloadAndInstall(pending, setProgress);
      setStatus("ready");
    } catch (nextError) {
      setError(String(nextError?.message ?? nextError));
      setStatus("error");
    }
  };

  const progressPercent = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null;

  return {
    version,
    status,
    pending,
    error,
    progressPercent,
    dismissed,
    dismiss: () => setDismissed(true),
    check,
    install,
    relaunch: () => updater.relaunch(),
  };
}

function UpdatePrompt({ updater }) {
  const { status, pending, version, progressPercent, dismissed, dismiss, install, relaunch } = updater;
  if (dismissed || !["available", "downloading", "ready"].includes(status)) return null;
  const ready = status === "ready";
  const downloading = status === "downloading";
  return (
    <aside className="update-prompt" role="status" aria-live="polite">
      <span className="update-prompt-icon"><ArrowsClockwise size={20} aria-hidden="true" /></span>
      <span className="update-prompt-copy">
        <strong>{ready ? "更新の準備ができました" : `MyBox v${pending?.version} が利用できます`}</strong>
        <small>{downloading ? `ダウンロード中…${progressPercent !== null ? ` ${progressPercent}%` : ""}` : ready ? "再起動すると適用されます" : version ? `現在 v${version}` : ""}</small>
      </span>
      <span className="update-prompt-actions">
        <button type="button" className="update-prompt-later" onClick={dismiss}>あとで</button>
        <button type="button" className="update-prompt-apply" disabled={downloading} onClick={ready ? relaunch : install}>
          <span>{ready ? "再起動" : downloading ? "取得中…" : "更新"}</span>
        </button>
      </span>
    </aside>
  );
}

function HostUpdateRow({ desktop, updater }) {
  const { version, status, pending, error, progressPercent, check, install, relaunch } = updater;
  const busy = status === "checking" || status === "downloading";
  const detail = !desktop
    ? "デスクトップ版で利用できます"
    : status === "checking" ? "確認中…"
    : status === "available" ? `v${pending?.version} が利用可能です`
    : status === "downloading" ? `ダウンロード中…${progressPercent !== null ? ` ${progressPercent}%` : ""}`
    : status === "ready" ? "再起動して適用してください"
    : status === "error" ? error
    : status === "up-to-date" ? "最新版です"
    : version ? `現在 v${version}` : "確認してください";
  const controlLabel = status === "ready" ? "再起動" : status === "available" ? "更新" : status === "checking" ? "確認中…" : status === "downloading" ? "取得中…" : "確認";
  const onClick = status === "ready" ? relaunch : status === "available" ? install : () => check();

  return (
    <button type="button" className="workspace-action" onClick={onClick} disabled={!desktop || busy}>
      <span className="settings-row-icon"><ArrowsClockwise size={22} aria-hidden="true" /></span>
      <span className="settings-row-copy"><strong>MyBoxの更新</strong><small>{detail}</small></span>
      <span className="settings-row-control">{controlLabel}</span>
    </button>
  );
}

function SettingsView({
  desktop,
  workspace,
  workspaceBusy,
  onChooseWorkspace,
  agentStatus,
  agentBusy,
  onConnectAgent,
  providerSettings,
  onSelectProvider,
  onConfigureOpenAi,
  onConfigureLocal,
  accountSession,
  accountBusy,
  onSignIn,
  onSignOut,
  hostUpdater,
  workflowBackground,
  onWorkflowBackgroundChange,
  onExit,
}) {
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const agentDetail = agentStatus?.connected
    ? `${agentPlanLabel(agentStatus)}${agentStatus.accountEmail ? ` · ${agentStatus.accountEmail}` : ""}`
    : agentStatus?.authMode
      ? "ChatGPTへの切替が必要"
      : agentStatus?.error ?? (desktop ? "未接続" : "デスクトップのみ");
  return (
    <section className="secondary-view" aria-labelledby="settings-heading">
      <div className="view-title"><GearSix size={24} aria-hidden="true" /><h1 id="settings-heading">設定</h1></div>
      <div className="settings-list">
        <AccountRow
          desktop={desktop}
          session={accountSession}
          busy={accountBusy}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
        />
        <ProviderRow
          icon={Robot}
          title="ChatGPT"
          detail={agentBusy ? "確認中…" : agentDetail}
          badge={providerSettings.activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID ? "使用中" : agentPlanLabel(agentStatus)}
          active={providerSettings.activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID}
          disabled={!desktop || agentBusy}
          onSelect={onConnectAgent}
        />
        <ProviderRow
          icon={Database}
          title="OpenAI API"
          detail={providerSettings.openaiApi.configured ? providerSettings.openaiApi.model : "未設定"}
          badge={providerSettings.activeProviderId === OPENAI_API_PROVIDER_ID ? "使用中" : providerSettings.openaiApi.configured ? "選択" : ""}
          active={providerSettings.activeProviderId === OPENAI_API_PROVIDER_ID}
          disabled={!desktop || agentBusy}
          onSelect={providerSettings.openaiApi.configured ? () => onSelectProvider(OPENAI_API_PROVIDER_ID) : onConfigureOpenAi}
          onConfigure={onConfigureOpenAi}
        />
        <ProviderRow
          icon={Cube}
          title="Local LLM"
          detail={providerSettings.localLlm.configured ? `${providerSettings.localLlm.model} · このPC` : "未設定"}
          badge={providerSettings.activeProviderId === LOCAL_LLM_PROVIDER_ID ? "使用中" : providerSettings.localLlm.configured ? "選択" : ""}
          active={providerSettings.activeProviderId === LOCAL_LLM_PROVIDER_ID}
          disabled={!desktop || agentBusy}
          onSelect={providerSettings.localLlm.configured ? () => onSelectProvider(LOCAL_LLM_PROVIDER_ID) : onConfigureLocal}
          onConfigure={onConfigureLocal}
        />
        <HostUpdateRow desktop={desktop} updater={hostUpdater} />
        <button className="workspace-action" onClick={onChooseWorkspace} disabled={!desktop || workspaceBusy} title={workspace?.path ?? ""}>
          <span className="settings-row-icon"><FolderSimple size={22} aria-hidden="true" /></span>
          <span className="settings-row-copy"><strong>保存場所</strong><small>{workspace?.name ?? (desktop ? "未選択" : "Webプレビュー")}</small></span>
          <span className="settings-row-control">{workspaceBusy ? "確認中…" : workspace ? "変更" : desktop ? "選択" : "Desktop"}</span>
        </button>
        <button role="switch" aria-checked={confirmDelete} onClick={() => setConfirmDelete(!confirmDelete)}><span className="settings-row-icon"><Trash size={22} aria-hidden="true" /></span><span className="settings-row-copy"><strong>削除前に確認</strong></span><span className="settings-row-control"><span className={confirmDelete ? "switch on" : "switch"}><span /></span></span></button>
        <button role="switch" aria-checked={reduceMotion} onClick={() => setReduceMotion(!reduceMotion)}><span className="settings-row-icon"><SlidersHorizontal size={22} aria-hidden="true" /></span><span className="settings-row-copy"><strong>動きを抑える</strong></span><span className="settings-row-control"><span className={reduceMotion ? "switch on" : "switch"}><span /></span></span></button>
        <button role="switch" aria-checked={workflowBackground.background} disabled={!desktop} onClick={() => onWorkflowBackgroundChange({ background: !workflowBackground.background, autostart: workflowBackground.background ? false : workflowBackground.autostart })}><span className="settings-row-icon"><FlowArrow size={22} aria-hidden="true" /></span><span className="settings-row-copy"><strong>バックグラウンド実行</strong><small>{workflowBackground.background ? "ウィンドウを閉じても実行" : "MyBox起動中のみ"}</small></span><span className="settings-row-control"><span className={workflowBackground.background ? "switch on" : "switch"}><span /></span></span></button>
        <button role="switch" aria-checked={workflowBackground.autostart} disabled={!desktop || !workflowBackground.background} onClick={() => onWorkflowBackgroundChange({ background: true, autostart: !workflowBackground.autostart })}><span className="settings-row-icon"><Power size={22} aria-hidden="true" /></span><span className="settings-row-copy"><strong>PC起動時に開始</strong></span><span className="settings-row-control"><span className={workflowBackground.autostart ? "switch on" : "switch"}><span /></span></span></button>
        <button className="text-danger" disabled={!desktop} onClick={onExit}><span className="settings-row-icon"><Power size={22} aria-hidden="true" /></span><span className="settings-row-copy"><strong>MyBoxを終了</strong></span><span className="settings-row-control">終了</span></button>
      </div>
    </section>
  );
}

function OpenAiConfigModal({ settings, busy, onClose, onSave, onDisconnect }) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings.model || "gpt-5.6");
  const [error, setError] = useState("");
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const result = await onSave({ apiKey: apiKey.trim(), model: model.trim() });
    if (result.ok) onClose(); else setError(result.error);
  };
  const remove = async () => {
    setError("");
    const result = await onDisconnect();
    if (result.ok) onClose(); else setError(result.error);
  };
  return (
    <Modal title="OpenAI API" onClose={onClose}>
      <form className="add-form provider-form" onSubmit={submit}>
        {error && <p ref={errorRef} className="form-error" role="alert" tabIndex="-1">{error}</p>}
        <label htmlFor="openai-key">API key</label>
        <input id="openai-key" type="password" autoComplete="off" autoFocus value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.configured ? "変更するときだけ入力" : "sk-…"} required={!settings.configured} />
        <label htmlFor="openai-model">Model</label>
        <input id="openai-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5.6" required />
        <small className="form-note">キーはOSの資格情報ストアへ保存され、画面へ読み戻しません。</small>
        <div className="provider-form-actions">
          {settings.configured && <button className="text-danger" type="button" onClick={remove} disabled={busy}><Trash size={18} />解除</button>}
          <button className="primary-button" type="submit" disabled={busy || !model.trim()}><Check size={19} />{busy ? "保存中…" : "保存して使用"}</button>
        </div>
      </form>
    </Modal>
  );
}

function LocalLlmConfigModal({ settings, busy, onClose, onSave, onDisconnect }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || "http://127.0.0.1:11434/v1");
  const [model, setModel] = useState(settings.model || "");
  const [error, setError] = useState("");
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const result = await onSave({ baseUrl: baseUrl.trim(), model: model.trim() });
    if (result.ok) onClose(); else setError(result.error);
  };
  const remove = async () => {
    setError("");
    const result = await onDisconnect();
    if (result.ok) onClose(); else setError(result.error);
  };
  return (
    <Modal title="Local LLM" onClose={onClose}>
      <form className="add-form provider-form" onSubmit={submit}>
        {error && <p ref={errorRef} className="form-error" role="alert" tabIndex="-1">{error}</p>}
        <label htmlFor="local-url">Endpoint</label>
        <input id="local-url" autoFocus value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:11434/v1" required />
        <label htmlFor="local-model">Model</label>
        <input id="local-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="qwen3:8b" required />
        <small className="form-note">このPCのループバック接続だけを許可します。</small>
        <div className="provider-form-actions">
          {settings.configured && <button className="text-danger" type="button" onClick={remove} disabled={busy}><Trash size={18} />解除</button>}
          <button className="primary-button" type="submit" disabled={busy || !baseUrl.trim() || !model.trim()}><Check size={19} />{busy ? "保存中…" : "保存して使用"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function App() {
  const desktop = isDesktopRuntime();
  const confirmationLevelRef = useRef("review");
  const activeUserIdRef = useRef("local-user");
  const [appRuntime] = useState(() => createSharedAppRuntime({
    desktop,
    getConfirmationLevel: () => confirmationLevelRef.current,
    getUserId: () => activeUserIdRef.current,
  }));
  const [appRegistry] = useState(createMyBoxAppRegistry);
  const defaultInstalledApps = useMemo(() => appRegistry.listDefaultInstalled(), [appRegistry]);
  const [apps, setApps] = useState(defaultInstalledApps);
  const [installedVersions, setInstalledVersions] = useState(() => Object.fromEntries(defaultInstalledApps.map((app) => [app.id, app.version])));
  const [appInstallations] = useState(() => createDeviceAppInstallationsStore(defaultInstalledApps, appRegistry.list()));
  const [updatingAppId, setUpdatingAppId] = useState(null);
  const [view, setView] = useState("apps");
  const [hostSessionReady, setHostSessionReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [shortcutMenuOpen, setShortcutMenuOpen] = useState(false);
  const [appShortcutCommand, setAppShortcutCommand] = useState(null);
  const [surfaceContext, setSurfaceContext] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  // The Confirmation level governs every App's agent writes (ADR 0016), and
  // ADR 0025 made those Operations reachable from the assistant panel
  // regardless of which App is open, so the Host owns this control rather than
  // any one App's sidebar.
  const [profilePreferences, setProfilePreferences] = useState(createDefaultProfilePreferences);
  const [aiText, setAiText] = useState("");
  const [toast, setToast] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [providerSettings, setProviderSettings] = useState(initialProviderSettings);
  const [providerModal, setProviderModal] = useState(null);
  const [backgroundPromptOpen, setBackgroundPromptOpen] = useState(false);
  const [workflowBackground, setWorkflowBackgroundState] = useState({ background: false, autostart: false, desktop });
  const [notificationRunId, setNotificationRunId] = useState(null);
  useEffect(() => { if (view !== "history") setNotificationRunId(null); }, [view]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [accountSession, setAccountSession] = useState(signedOutSession);
  const [deviceLogin, setDeviceLogin] = useState(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState(createEmptyChatHistory);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(false);
  const [availableSkills, setAvailableSkills] = useState([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [modelSelections, setModelSelections] = useState({});
  const [reasoningSelections, setReasoningSelections] = useState({});
  const [subscriptionUsage, setSubscriptionUsage] = useState(null);
  const aiInput = useRef(null);
  const appShortcutSequence = useRef(0);
  const lastNonChatView = useRef("apps");
  const hostSessionStore = useRef(getHostSessionStore()).current;
  const chatStore = useRef(getChatHistoryStore()).current;
  const hostUpdater = useHostUpdater(desktop);
  const activeProfile = useMemo(() => resolveProfilePresentation(accountSession), [accountSession]);
  confirmationLevelRef.current = profilePreferences.confirmationLevel;
  activeUserIdRef.current = activeProfile.profileId;

  const pageTitle = useMemo(() => view === "apps" ? "アプリ" : view === "chat" ? "AIチャット" : navItems.find((item) => item.id === view)?.label, [view]);
  const assistantContextLabel = surfaceContext?.label || selectedApp?.name || pageTitle || "MyBox";
  const activeProviderId = providerSettings.activeProviderId;
  const activeProvider = nativeAgentProviders[activeProviderId] ?? codexSubscriptionProvider;
  const activeProviderName = activeProvider.descriptor.name;
  const webSearchSupported = activeProvider.descriptor.capabilities.webSearch === true;
  const skillsSupported = activeProvider.descriptor.capabilities.skills === true
    && activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID
    && agentStatus?.connected === true;
  const imageGenerationSupported = activeProvider.descriptor.capabilities.imageGeneration === true
    && activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID
    && agentStatus?.connected === true
    && agentStatus?.imageGeneration === true;
  const providerReady = Boolean(activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID
    ? agentStatus?.connected
    : activeProviderId === OPENAI_API_PROVIDER_ID
      ? providerSettings.openaiApi.configured
      : activeProviderId === LOCAL_LLM_PROVIDER_ID && providerSettings.localLlm.configured);
  const selectedModelId = modelSelections[activeProviderId] ?? "";
  const selectedModel = availableModels.find((model) => model.id === selectedModelId) ?? null;
  const reasoningEfforts = selectedModel?.supportedReasoningEfforts ?? [];
  const selectedReasoningEffort = reasoningSelections[activeProviderId] ?? "";
  const activeChatSession = chatHistory.sessions.find((session) => session.id === activeChatId) ?? null;
  const apiTokenUsage = sumSessionTokenUsage(activeChatSession, OPENAI_API_PROVIDER_ID);
  const providerUsage = activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID
    ? subscriptionUsage && { kind: "subscription", ...subscriptionUsage }
    : activeProviderId === OPENAI_API_PROVIDER_ID
      ? { kind: "api", ...apiTokenUsage }
      : null;
  const chatPersistenceReady = chatLoaded && (!desktop || Boolean(workspace));

  useEffect(() => {
    let active = true;
    (async () => {
      let installedApps = defaultInstalledApps;
      try {
        const snapshot = await appInstallations.load();
        if (!active) return;
        snapshot.customApps.forEach((definition) => {
          if (!appRegistry.get(definition.id)) appRegistry.register(definition);
        });
        installedApps = snapshot.installedApps.map(({ id }) => appRegistry.get(id)).filter(Boolean);
        setApps(installedApps);
        setInstalledVersions(Object.fromEntries(snapshot.installedApps.map(({ id, version }) => [id, version])));
      } catch (error) {
        if (active) setToast(`App一覧を復元できません：${String(error)}`);
      }
      try {
        const session = resolveHostSession(await hostSessionStore.load(), installedApps.map((app) => app.id));
        if (!active) return;
        setView(session.view);
        setSelectedApp(session.appId ? installedApps.find((app) => app.id === session.appId) ?? null : null);
      } catch (error) {
        if (active) setToast(`前回の画面を復元できません：${String(error)}`);
      } finally {
        if (active) setHostSessionReady(true);
      }
    })();
    return () => { active = false; };
  }, [appInstallations, appRegistry, defaultInstalledApps, hostSessionStore]);

  useEffect(() => {
    if (!hostSessionReady) return;
    hostSessionStore.save({ view, appId: selectedApp?.id ?? null })
      .catch((error) => setToast(`現在の画面を記憶できません：${String(error)}`));
  }, [hostSessionReady, hostSessionStore, selectedApp?.id, view]);

  useEffect(() => {
    appRuntime.syncInstalled(apps.map((app) => app.id));
    if (!desktop || workspace) appRuntime.start().then(async () => {
      if (desktop && appRuntime.workflows.hasEnabledSchedules()) {
        setWorkflowBackgroundState(await setWorkflowBackground({ background: true }));
      }
    }).catch((error) => setToast(`ワークフローを復元できません：${String(error)}`));
  }, [appRuntime, apps, desktop, workspace]);

  useEffect(() => {
    if (!desktop) return undefined;
    let active = true;
    let stop = () => {};
    getWorkflowBackgroundSettings().then((settings) => active && setWorkflowBackgroundState(settings)).catch(() => {});
    listenWorkflowNotifications((extra) => {
      setSelectedApp(null);
      setNotificationRunId(extra.runId ?? null);
      setView("history");
    }).then((listener) => { if (active) stop = listener; else listener(); }).catch(() => {});
    return () => { active = false; stop(); };
  }, [desktop]);

  const changeWorkflowBackground = async (settings) => {
    try {
      setWorkflowBackgroundState(await setWorkflowBackground(settings));
      setToast(settings.background ? "バックグラウンド実行を更新しました" : "バックグラウンド実行を停止しました");
    } catch (error) {
      setToast(`バックグラウンド設定を変更できません：${String(error?.message ?? error)}`);
    }
  };

  const chooseScheduleBackground = async (autostart) => {
    setBackgroundPromptOpen(false);
    await changeWorkflowBackground({ background: true, autostart });
  };

  useEffect(() => {
    if (view !== "chat") lastNonChatView.current = view;
  }, [view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setSurfaceContext(selectedApp ? { label: selectedApp.name, appId: null, operationContext: null } : null);
  }, [selectedApp]);

  useEffect(() => {
    let active = true;
    getProfilePreferencesStore().load()
      .then((loaded) => active && setProfilePreferences(loaded))
      .catch(() => {});
    return () => { active = false; };
  }, [desktop, workspace]);

  const changeConfirmationLevel = async (confirmationLevel) => {
    try {
      setProfilePreferences(await getProfilePreferencesStore().setConfirmationLevel(profilePreferences, confirmationLevel));
      setToast(`Agent権限を「${confirmationLabel(confirmationLevel)}」へ変更しました`);
    } catch (error) {
      setToast(`Agent権限を変更できません：${String(error?.message ?? error)}`);
    }
  };

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    setWorkspaceBusy(true);
    getCurrentWorkspace()
      .then((current) => active && setWorkspace(current))
      .catch((error) => active && setToast(`保存場所を確認できません：${String(error)}`))
      .finally(() => active && setWorkspaceBusy(false));
    return () => { active = false; };
  }, [desktop]);

  useEffect(() => {
    if (desktop && !workspace) {
      setChatLoaded(false);
      return;
    }
    let active = true;
    setChatLoaded(false);
    chatStore.load()
      .then((history) => {
        if (!active) return;
        setChatHistory(history);
        setActiveChatId((current) => history.sessions.some((session) => session.id === current)
          ? current
          : history.sessions[0]?.id ?? null);
      })
      .catch((error) => active && setToast(`チャット履歴を読み込めません：${String(error)}`))
      .finally(() => active && setChatLoaded(true));
    return () => { active = false; };
  }, [chatStore, desktop, workspace]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    getAgentProviderSettings()
      .then((settings) => active && setProviderSettings(settings))
      .catch((error) => active && setToast(`AI設定を確認できません：${String(error)}`));
    return () => { active = false; };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    getAccountSession()
      .then((session) => active && setAccountSession(session))
      .catch((error) => active && setToast(`アカウントを確認できません：${String(error)}`));
    return () => { active = false; };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) {
      setAgentStatus({ available: false, connected: false, planType: null, authMode: null, accountEmail: null, imageGeneration: false, error: "デスクトップ版で利用できます" });
      return;
    }
    let active = true;
    setAgentBusy(true);
    getCodexSubscriptionStatus()
      .then((status) => active && setAgentStatus(status))
      .catch((error) => active && setAgentStatus({ available: true, connected: false, planType: null, authMode: null, accountEmail: null, error: String(error) }))
      .finally(() => active && setAgentBusy(false));
    return () => { active = false; };
  }, [desktop]);

  useEffect(() => {
    if (!skillsSupported) {
      setAvailableSkills([]);
      setSelectedSkillIds([]);
      setSkillsLoading(false);
      return;
    }
    let active = true;
    setSkillsLoading(true);
    listCodexSkills()
      .then((skills) => {
        if (!active) return;
        setAvailableSkills(skills);
        setSelectedSkillIds((current) => current.filter((id) => skills.some((skill) => skill.id === id)));
      })
      .catch((error) => {
        if (!active) return;
        setAvailableSkills([]);
        setSelectedSkillIds([]);
        setToast(`スキルを読み込めません：${String(error)}`);
      })
      .finally(() => active && setSkillsLoading(false));
    return () => { active = false; };
  }, [skillsSupported]);

  useEffect(() => {
    if (!imageGenerationSupported) setImageGenerationEnabled(false);
  }, [imageGenerationSupported]);

  useEffect(() => {
    let active = true;
    setAvailableModels([]);
    if (!providerReady || typeof activeProvider.listModels !== "function") return () => { active = false; };
    activeProvider.listModels()
      .then((models) => {
        if (!active) return;
        const safeModels = Array.isArray(models) ? models : [];
        setAvailableModels(safeModels);
        setModelSelections((current) => {
          const currentId = current[activeProviderId];
          const chosen = safeModels.find((model) => model.id === currentId)
            ?? safeModels.find((model) => model.isDefault)
            ?? safeModels[0];
          if (!chosen) return { ...current, [activeProviderId]: "" };
          return { ...current, [activeProviderId]: chosen.id };
        });
      })
      .catch((error) => active && setToast(`モデルを読み込めません：${String(error)}`));
    return () => { active = false; };
  }, [activeProvider, activeProviderId, providerReady, agentStatus?.version, providerSettings.openaiApi.model, providerSettings.localLlm.model]);

  useEffect(() => {
    if (!selectedModel) return;
    setReasoningSelections((current) => {
      const supported = selectedModel.supportedReasoningEfforts ?? [];
      const currentEffort = current[activeProviderId];
      const nextEffort = supported.some((option) => option.id === currentEffort)
        ? currentEffort
        : selectedModel.defaultReasoningEffort || supported[0]?.id || "";
      if (currentEffort === nextEffort) return current;
      return { ...current, [activeProviderId]: nextEffort };
    });
  }, [activeProviderId, selectedModel]);

  useEffect(() => {
    let active = true;
    if (activeProviderId !== CODEX_SUBSCRIPTION_PROVIDER_ID || !providerReady || typeof activeProvider.getUsage !== "function") {
      setSubscriptionUsage(null);
      return () => { active = false; };
    }
    activeProvider.getUsage()
      .then((usage) => active && setSubscriptionUsage(usage))
      .catch(() => active && setSubscriptionUsage(null));
    return () => { active = false; };
  }, [activeProvider, activeProviderId, providerReady, agentStatus?.version]);

  const selectWorkspace = async () => {
    setWorkspaceBusy(true);
    try {
      const selected = await chooseWorkspace();
      if (selected) {
        setWorkspace(selected);
        setToast(`${selected.name}を保存場所に設定しました`);
      }
    } catch (error) {
      setToast(`保存場所を設定できません：${String(error)}`);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const addApp = async (app) => {
    const registered = appRegistry.get(app.id) ?? appRegistry.register(app);
    const next = apps.some((item) => item.id === registered.id) ? apps : [...apps, registered];
    const nextVersions = { ...installedVersions, [registered.id]: registered.version };
    try {
      await appInstallations.save(next, appRegistry.list(), nextVersions);
      setApps(next);
      setInstalledVersions(nextVersions);
      setAddOpen(false);
      setToast(`${app.name} v${registered.version}を追加しました`);
    } catch (error) {
      setToast(`App一覧を保存できません：${String(error)}`);
    }
  };

  const startSignIn = async () => {
    setAccountBusy(true);
    try {
      const start = await beginGitHubSignIn();
      setDeviceLogin(start);
      // Polling runs while the dialog shows the code; GitHub only issues the
      // token once the user finishes in the browser.
      const session = await completeGitHubSignIn({ deviceCode: start.deviceCode, interval: start.interval });
      setAccountSession(session);
      setDeviceLogin(null);
      setToast(`${session.displayName} でサインインしました`);
    } catch (error) {
      setDeviceLogin(null);
      setToast(`サインインできません：${String(error?.message ?? error)}`);
    } finally {
      setAccountBusy(false);
    }
  };

  const cancelSignIn = () => {
    setDeviceLogin(null);
    setAccountBusy(false);
  };

  const signOut = async () => {
    setAccountBusy(true);
    try {
      setAccountSession(await signOutAccount());
      setToast("サインアウトしました");
    } catch (error) {
      setToast(`サインアウトできません：${String(error?.message ?? error)}`);
    } finally {
      setAccountBusy(false);
    }
  };

  const updateApp = async (app) => {
    const installedVersion = installedVersions[app.id];
    if (!installedVersion || !isAppUpdateAvailable(installedVersion, app.version)) {
      setToast(`${app.name}は最新版です`);
      return true;
    }
    const nextVersions = { ...installedVersions, [app.id]: app.version };
    setUpdatingAppId(app.id);
    try {
      await appInstallations.save(apps, appRegistry.list(), nextVersions);
      setInstalledVersions(nextVersions);
      setMenuOpen(null);
      setToast(`${app.name}をv${app.version}へ更新しました`);
      return true;
    } catch (error) {
      setToast(`${app.name}を更新できません：${String(error)}`);
      return false;
    } finally {
      setUpdatingAppId(null);
    }
  };

  const deleteApp = async () => {
    const next = apps.filter((app) => app.id !== pendingDelete.id);
    const nextVersions = Object.fromEntries(Object.entries(installedVersions).filter(([id]) => id !== pendingDelete.id));
    try {
      await appInstallations.save(next, appRegistry.list(), nextVersions);
      setApps(next);
      setInstalledVersions(nextVersions);
      setPendingDelete(null);
      setMenuOpen(null);
      setToast("アプリを削除しました");
    } catch (error) {
      setToast(`App一覧を保存できません：${String(error)}`);
    }
  };

  const connectAgent = async () => {
    setAgentBusy(true);
    try {
      const status = agentStatus?.connected ? agentStatus : await connectCodexSubscription();
      setAgentStatus(status);
      const settings = await selectAgentProvider(CODEX_SUBSCRIPTION_PROVIDER_ID);
      setProviderSettings(settings);
      setToast(`ChatGPT ${agentPlanLabel(status)}を使用します`);
    } catch (error) {
      setToast(`ChatGPTに接続できません：${String(error)}`);
    } finally {
      setAgentBusy(false);
    }
  };

  const chooseAgentProvider = async (providerId) => {
    setAgentBusy(true);
    try {
      const settings = await selectAgentProvider(providerId);
      setProviderSettings(settings);
      setToast(`${nativeAgentProviders[providerId].descriptor.name}を使用します`);
    } catch (error) {
      setToast(`AIを切り替えられません：${String(error)}`);
    } finally {
      setAgentBusy(false);
    }
  };

  const saveOpenAi = async (values) => {
    setAgentBusy(true);
    try {
      setProviderSettings(await configureOpenAiApi(values));
      setToast("OpenAI APIを設定しました");
      return { ok: true };
    } catch (error) {
      const message = `OpenAI APIを設定できません：${String(error)}`;
      setToast(message);
      return { ok: false, error: message };
    } finally {
      setAgentBusy(false);
    }
  };

  const removeOpenAi = async () => {
    setAgentBusy(true);
    try {
      setProviderSettings(await disconnectOpenAiApi());
      setToast("OpenAI APIの資格情報を削除しました");
      return { ok: true };
    } catch (error) {
      const message = `OpenAI APIを解除できません：${String(error)}`;
      setToast(message);
      return { ok: false, error: message };
    } finally {
      setAgentBusy(false);
    }
  };

  const saveLocalLlm = async (values) => {
    setAgentBusy(true);
    try {
      setProviderSettings(await configureLocalLlm(values));
      setToast("Local LLMを設定しました");
      return { ok: true };
    } catch (error) {
      const message = `Local LLMを設定できません：${String(error)}`;
      setToast(message);
      return { ok: false, error: message };
    } finally {
      setAgentBusy(false);
    }
  };

  const removeLocalLlm = async () => {
    setAgentBusy(true);
    try {
      setProviderSettings(await disconnectLocalLlm());
      setToast("Local LLMの設定を削除しました");
      return { ok: true };
    } catch (error) {
      const message = `Local LLMを解除できません：${String(error)}`;
      setToast(message);
      return { ok: false, error: message };
    } finally {
      setAgentBusy(false);
    }
  };

  const activeProviderReady = () => {
    return providerReady;
  };

  const saveChatHistory = async (history) => {
    setChatHistory(history);
    const saved = await chatStore.save(history);
    setChatHistory(saved);
    return saved;
  };

  const createNewChat = async ({ openChat = true } = {}) => {
    if (!chatPersistenceReady) {
      setView("settings");
      setToast("先にチャットの保存場所を設定してください");
      return;
    }
    const created = createChatSession(chatHistory);
    setActiveChatId(created.session.id);
    if (openChat) setView("chat");
    try {
      await saveChatHistory(created.history);
    } catch (error) {
      setToast(`新しいチャットを保存できません：${String(error)}`);
    }
  };

  const selectChatSession = (sessionId, { openChat = true } = {}) => {
    setActiveChatId(sessionId);
    if (openChat) setView("chat");
  };

  const updateChatTitle = async (sessionId, title) => {
    try {
      await saveChatHistory(renameChatSession(chatHistory, sessionId, title));
    } catch (error) {
      setToast(`チャット名を変更できません：${String(error)}`);
    }
  };

  const removeChatSession = async (sessionId) => {
    const next = deleteChatSession(chatHistory, sessionId);
    setActiveChatId((current) => current === sessionId ? next.sessions[0]?.id ?? null : current);
    try {
      await saveChatHistory(next);
      setToast("チャットを削除しました");
    } catch (error) {
      setToast(`チャットを削除できません：${String(error)}`);
    }
  };

  const toggleChatSkill = (skillId) => {
    setSelectedSkillIds((current) => current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : current.length < 4 ? [...current, skillId] : current);
  };

  const toggleWebSearch = () => {
    setWebSearchEnabled((enabled) => {
      const next = !enabled;
      if (next) setImageGenerationEnabled(false);
      return next;
    });
  };

  const toggleImageGeneration = () => {
    setImageGenerationEnabled((enabled) => {
      const next = !enabled;
      if (next) setWebSearchEnabled(false);
      return next;
    });
  };

  const selectChatModel = (modelId) => {
    const model = availableModels.find((item) => item.id === modelId);
    if (!model) return;
    setModelSelections((current) => ({ ...current, [activeProviderId]: model.id }));
    setReasoningSelections((current) => {
      const supported = model.supportedReasoningEfforts ?? [];
      const currentEffort = current[activeProviderId];
      return {
        ...current,
        [activeProviderId]: supported.some((option) => option.id === currentEffort)
          ? currentEffort
          : model.defaultReasoningEffort || supported[0]?.id || "",
      };
    });
  };

  const selectChatReasoning = (effort) => {
    if (!reasoningEfforts.some((option) => option.id === effort)) return;
    setReasoningSelections((current) => ({ ...current, [activeProviderId]: effort }));
  };

  /** Pauses `AgentRuntime` for a write beyond the User's Confirmation level (ADR 0025). */
  const requestApproval = (details) => new Promise((resolve) => {
    setPendingApproval({ ...details, resolve });
  });

  const resolveApproval = (granted) => {
    pendingApproval?.resolve(granted);
    setPendingApproval(null);
  };

  /**
   * Runs one chat turn through the Operation-invoking decision loop instead
   * of free-form generation. Available whenever any installed App has
   * registered its host (ADR 0025) — not gated to whichever App's View
   * happens to be open. An open record's identity (Project/Page IDs, current
   * Blocks) is folded in as additive context when present, not a gate: the
   * model can still discover one itself through a read Operation.
   */
  const runAgentTurn = async ({ request, contextLabel, operationContext }) => {
    const preferences = await getProfilePreferencesStore().load();
    const agentHost = createAggregateAgentHost();
    const runtime = new AgentRuntime({ host: agentHost, providers: { get: () => activeProvider } });
    const goal = [
      request,
      "",
      `Current MyBox screen: ${contextLabel}.`,
      operationContext
        ? [
          `Open record: Project ID "${operationContext.projectId}", Page ID "${operationContext.pageId}", title "${operationContext.title}", current revision ${operationContext.revision}.`,
          `Current Blocks (id, type, text): ${JSON.stringify(operationContext.blocks)}`,
          "When an Operation needs projectId/pageId/expectedRevision for this open record, use exactly the values above. Prefer editing or adding a Block over guessing a new ID that does not exist.",
        ].join("\n")
        : "No specific record is open right now. If the request needs one, use a read Operation (list or search) to find it first.",
    ].join("\n");
    const runResult = await runtime.run(goal, {
      confirmationLevel: preferences.confirmationLevel,
      onApprovalNeeded: requestApproval,
      grant: { operationIds: ["*"] },
    });
    return { text: runResult.message };
  };

  const sendChatMessage = async (text, { openChat = true, contextLabel = null } = {}) => {
    const request = text.trim();
    if (!request || agentBusy) return;
    if (!chatPersistenceReady) {
      setView("settings");
      setToast("先にチャットの保存場所を設定してください");
      return;
    }
    let sessionId = activeChatId;
    let workingHistory = chatHistory;
    if (!sessionId || !workingHistory.sessions.some((session) => session.id === sessionId)) {
      const created = createChatSession(workingHistory);
      sessionId = created.session.id;
      workingHistory = created.history;
      setActiveChatId(sessionId);
    }
    const selectedSkills = availableSkills
      .filter((skill) => selectedSkillIds.includes(skill.id))
      .map((skill) => ({ id: skill.id, name: skill.displayName }));
    workingHistory = appendChatMessage(workingHistory, sessionId, {
      role: "user",
      content: request,
      skills: selectedSkills,
      imageRequested: imageGenerationSupported && imageGenerationEnabled,
    }).history;
    if (openChat) setView("chat");
    setAiText("");
    setAiOpen(false);
    const providerReady = activeProviderReady();
    setAgentBusy(providerReady);
    try {
      workingHistory = await saveChatHistory(workingHistory);
      if (!providerReady) {
        const message = "AIプロバイダーが接続されていません。右下の接続ボタンから設定してください。";
        workingHistory = appendChatMessage(workingHistory, sessionId, {
          role: "assistant",
          content: message,
          providerId: activeProviderId,
          status: "error",
        }).history;
        await saveChatHistory(workingHistory);
        setToast("AIプロバイダーを設定してください");
        return;
      }
      const session = workingHistory.sessions.find((item) => item.id === sessionId);
      const conversationPrompt = buildConversationPrompt(session);

      // Available once any installed App has registered its host (ADR
      // 0025), regardless of which screen is open. Image generation is an
      // explicit per-turn opt-in the Operation loop cannot serve, so a User
      // who turned it on for this message keeps the free-form path instead.
      const useAgentTurn = hasRegisteredAgentHosts() && !(imageGenerationSupported && imageGenerationEnabled);
      const result = useAgentTurn
        ? await runAgentTurn({ request, contextLabel: assistantContextLabel, operationContext: surfaceContext?.operationContext ?? null })
        : await activeProvider.generate({
          prompt: contextLabel
            ? `Current MyBox screen: ${contextLabel}. Use this label only as interface context; do not assume access to data or operations that were not explicitly provided.\n\n${conversationPrompt}`
            : conversationPrompt,
          model: selectedModelId || undefined,
          reasoningEffort: selectedReasoningEffort || undefined,
          webSearch: webSearchSupported && webSearchEnabled && !imageGenerationEnabled,
          imageGeneration: imageGenerationSupported && imageGenerationEnabled,
          skillIds: skillsSupported ? selectedSkillIds : [],
        });
      workingHistory = appendChatMessage(workingHistory, sessionId, {
        role: "assistant",
        content: result.text,
        providerId: activeProviderId,
        sources: result.sources,
        webSearchUsed: result.webSearchUsed,
        image: result.image,
        model: selectedModelId || null,
        reasoningEffort: selectedReasoningEffort || null,
        tokenUsage: result.usage,
      }).history;
      await saveChatHistory(workingHistory);
      if (activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID && typeof activeProvider.getUsage === "function") {
        activeProvider.getUsage().then(setSubscriptionUsage).catch(() => {});
      }
      setSelectedSkillIds([]);
      setImageGenerationEnabled(false);
    } catch (error) {
      const message = `AIを実行できません：${String(error)}`;
      if (sessionId && workingHistory.sessions.some((session) => session.id === sessionId)) {
        try {
          workingHistory = appendChatMessage(workingHistory, sessionId, {
            role: "assistant",
            content: message,
            providerId: activeProviderId,
            status: "error",
          }).history;
          await saveChatHistory(workingHistory);
        } catch {
          // The toast below remains the recovery path if history persistence also fails.
        }
      }
      setToast(message);
    } finally {
      setAgentBusy(false);
    }
  };

  const runAi = (event) => {
    event.preventDefault();
    setAssistantOpen(true);
    sendChatMessage(aiText, { openChat: false, contextLabel: assistantContextLabel });
  };

  const closeAssistantPanel = () => {
    setAssistantOpen(false);
    window.setTimeout(() => {
      const selector = selectedApp ? ".knowledge-assistant-toggle" : ".assistant-toggle";
      document.querySelector(selector)?.focus();
    }, 0);
  };

  const navigateWithKeyboard = (nextView) => {
    setSelectedApp(null);
    setMenuOpen(null);
    if (nextView === "chat") setAssistantOpen(false);
    setView(nextView);
  };

  const dispatchAppShortcut = (appId, shortcutId) => {
    if (selectedApp?.id !== appId) return;
    appShortcutSequence.current += 1;
    setAppShortcutCommand({ appId, shortcutId, sequence: appShortcutSequence.current });
  };

  const runHostShortcut = (shortcutId) => {
    switch (shortcutId) {
      case "toggle-assistant":
        if (view === "chat") {
          navigateWithKeyboard(lastNonChatView.current);
          window.setTimeout(() => document.querySelector(".assistant-toggle")?.focus(), 0);
        } else if (assistantOpen) {
          closeAssistantPanel();
        } else {
          setAssistantOpen(true);
        }
        break;
      case "command-palette":
        setShortcutMenuOpen((open) => !open);
        break;
      case "new-chat":
        setSelectedApp(null);
        setAssistantOpen(false);
        createNewChat();
        break;
      case "apps": navigateWithKeyboard("apps"); break;
      case "home": navigateWithKeyboard("apps"); break;
      case "connections": navigateWithKeyboard("workflows"); break;
      case "history": navigateWithKeyboard("history"); break;
      case "settings": navigateWithKeyboard("settings"); break;
      case "chat": navigateWithKeyboard("chat"); break;
      case "add-app":
        setSelectedApp(null);
        setAddOpen(true);
        break;
      case "shortcut-menu":
        setShortcutMenuOpen((open) => !open);
        break;
      default:
        if (shortcutId.startsWith("app-command:")) {
          const [, appId, appShortcutId] = shortcutId.split(":");
          dispatchAppShortcut(appId, appShortcutId);
          break;
        }
        if (shortcutId.startsWith("open-app:")) {
          const app = apps.find((candidate) => candidate.id === shortcutId.slice("open-app:".length));
          if (app) {
            setView("apps");
            setMenuOpen(null);
            const installedVersion = installedVersions[app.id] ?? app.version;
            if (isAppUpdateAvailable(installedVersion, app.version)) {
              setSelectedApp(null);
              void updateApp(app).then((updated) => updated && setSelectedApp(app));
            } else if (compareAppVersions(installedVersion, app.version) === 0 && updatingAppId !== app.id) {
              setSelectedApp(app);
            } else {
              setSelectedApp(null);
              setToast(`${app.name}はバージョンを一致させてから開けます`);
            }
          }
        }
        break;
    }
  };

  const blockingModalOpen = addOpen || Boolean(pendingDelete) || Boolean(pendingApproval) || backgroundPromptOpen
    || Boolean(deviceLogin) || Boolean(providerModal);

  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      const hostShortcut = resolveHostKeyboardShortcut(event);
      if (hostShortcut) {
        if (shortcutMenuOpen && hostShortcut.id !== "shortcut-menu" && hostShortcut.id !== "command-palette") return;
        if (blockingModalOpen) return;
        event.preventDefault();
        runHostShortcut(hostShortcut.id);
        return;
      }
      if (shortcutMenuOpen || blockingModalOpen || !selectedApp) return;
      const appShortcut = resolveAppKeyboardShortcut(selectedApp.shortcuts, event);
      if (!appShortcut) return;
      event.preventDefault();
      dispatchAppShortcut(selectedApp.id, appShortcut.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const runShortcutMenuCommand = (shortcutId) => {
    setShortcutMenuOpen(false);
    if (shortcutId !== "shortcut-menu" && shortcutId !== "command-palette") window.setTimeout(() => runHostShortcut(shortcutId), 0);
  };

  const sharedChatProps = {
    history: chatHistory,
    activeSessionId: activeChatId,
    value: aiText,
    busy: agentBusy,
    providerName: activeProviderName,
    providerReady: activeProviderReady(),
    providerLabels,
    models: availableModels,
    selectedModelId,
    onSelectModel: selectChatModel,
    reasoningEfforts,
    selectedReasoningEffort,
    onSelectReasoningEffort: selectChatReasoning,
    usage: providerUsage,
    persistenceReady: chatPersistenceReady,
    webSearchEnabled,
    webSearchSupported,
    onToggleWebSearch: toggleWebSearch,
    skills: availableSkills,
    skillsSupported,
    skillsLoading,
    selectedSkillIds,
    onToggleSkill: toggleChatSkill,
    imageGenerationEnabled,
    imageGenerationSupported,
    onToggleImageGeneration: toggleImageGeneration,
    onRenameSession: updateChatTitle,
    onDeleteSession: removeChatSession,
    onChange: setAiText,
    confirmationLevels: confirmationLevelOptions,
    confirmationLevel: profilePreferences.confirmationLevel,
    onSelectConfirmationLevel: changeConfirmationLevel,
  };

  return (
    <div className={`app-shell${view === "chat" ? " chat-mode" : ""}${assistantOpen && view !== "chat" ? " assistant-panel-open" : ""}${selectedApp ? " app-surface-mode" : ""}`} onClick={(e) => !e.target.closest(".context-menu, .tile-actions, .launcher-menu-button") && setMenuOpen(null)}>
      <header className="topbar">
        <button className="brand" aria-label="アプリ一覧へ" aria-keyshortcuts="Control+1" onClick={() => setView("apps")}><img className="brand-mark" src="/assets/mybox-mark.png" alt="" width="34" height="34" /><span>MyBox</span></button>
        <div className="topbar-actions">
          <IconButton label={`${assistantOpen ? "AIアシスタントを閉じる" : "AIアシスタントを開く"} (Ctrl+J)`} className={assistantOpen ? "assistant-toggle active" : "assistant-toggle"} aria-keyshortcuts="Control+J" aria-pressed={assistantOpen} aria-controls="assistant-panel" onClick={() => setAssistantOpen((open) => !open)}><Robot size={23} weight={assistantOpen ? "fill" : "regular"} /></IconButton>
          <IconButton label="コマンドパレット (Ctrl+K)" className={shortcutMenuOpen ? "shortcut-toggle active" : "shortcut-toggle"} aria-keyshortcuts="Control+K" aria-expanded={shortcutMenuOpen} onClick={() => setShortcutMenuOpen(true)}><Keyboard size={23} /></IconButton>
          <IconButton label="アプリを追加 (Ctrl+Shift+A)" aria-keyshortcuts="Control+Shift+A" onClick={() => setAddOpen(true)}><Plus size={22} /></IconButton>
          {accountSession.signedIn && (
            <IconButton label={`${accountSession.displayName}・アカウント設定`} className="profile-button" onClick={() => setView("settings")}>
              {accountSession.avatarUrl
                ? <img src={accountSession.avatarUrl} alt="" />
                : <UserCircle size={30} weight="duotone" />}
            </IconButton>
          )}
        </div>
      </header>

      <main className={`main-content${view === "chat" ? " chat-content" : ""}`}>
        {view !== "chat" && <form className={aiOpen ? "ai-command open" : "ai-command"} onSubmit={runAi} aria-busy={agentBusy}>
          <button type="button" className="ai-trigger" aria-label="AIアシスタントを開く" aria-controls="assistant-panel" aria-expanded={assistantOpen} onClick={() => setAssistantOpen(true)}><Robot size={30} weight="duotone" /></button>
          <input ref={aiInput} aria-label="AIへの依頼" value={aiText} onChange={(e) => setAiText(e.target.value)} onFocus={() => setAiOpen(true)} placeholder={agentBusy ? "考えています…" : "AIに頼む"} disabled={agentBusy} />
          {agentBusy ? <span className="ai-busy spinner" aria-label="AIが処理中" /> : aiOpen ? <button className="ai-send" type="submit" aria-label="依頼を送信"><PaperPlaneTilt size={21} /></button> : null}
        </form>}

        {view === "apps" && (
          <section className="apps-view" aria-labelledby="apps-heading">
            <h1 id="apps-heading">アプリ</h1>
            <div className="app-grid">
              {apps.map((app) => <AppTile key={app.id} app={app} installedVersion={installedVersions[app.id] ?? app.version} updating={updatingAppId === app.id} onUpdate={updateApp} onOpen={setSelectedApp} menuOpen={menuOpen === app.id} onMenu={(id) => setMenuOpen((current) => current === id ? null : id)} onDelete={setPendingDelete} onFavorite={(item) => { setToast(`${item.name}を固定しました`); setMenuOpen(null); }} />)}
            </div>
          </section>
        )}
        {view === "workflows" && <WorkflowView runtime={appRuntime} onToast={setToast} backgroundSettings={workflowBackground} onScheduleEnabled={() => desktop && !workflowBackground.background && setBackgroundPromptOpen(true)} />}
        {view === "history" && <WorkflowHistoryView runtime={appRuntime} onToast={setToast} targetRunId={notificationRunId} />}
        {view === "settings" && <SettingsView desktop={desktop} workspace={workspace} workspaceBusy={workspaceBusy} onChooseWorkspace={selectWorkspace} agentStatus={agentStatus} agentBusy={agentBusy} onConnectAgent={connectAgent} providerSettings={providerSettings} onSelectProvider={chooseAgentProvider} onConfigureOpenAi={() => setProviderModal("openai")} onConfigureLocal={() => setProviderModal("local")} accountSession={accountSession} accountBusy={accountBusy} onSignIn={startSignIn} onSignOut={signOut} hostUpdater={hostUpdater} workflowBackground={workflowBackground} onWorkflowBackgroundChange={changeWorkflowBackground} onExit={exitMyBox} />}
        {view === "chat" && <ChatView
          {...sharedChatProps}
          onBack={() => setView("apps")}
          onOpenSettings={() => setView("settings")}
          onNewSession={() => createNewChat()}
          onSelectSession={(sessionId) => selectChatSession(sessionId)}
          onSend={(text) => sendChatMessage(text)}
        />}
      </main>

      {view !== "chat" && <nav className="bottom-nav" aria-label="メインナビゲーション">
        {view !== "apps" && <button className="back-to-apps" onClick={() => setView("apps")} aria-label="アプリに戻る" aria-keyshortcuts="Control+1"><ArrowLeft size={22} /><span>アプリ</span></button>}
        {navItems.map(({ id, label, icon: Icon }, index) => <button key={id} className={view === id ? "active" : ""} aria-keyshortcuts={`Control+${index + 2}`} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><Icon size={32} weight={view === id ? "fill" : "regular"} /><span>{label}</span></button>)}
      </nav>}

      {shortcutMenuOpen && <CommandPalette apps={apps} activeApp={selectedApp} onClose={() => setShortcutMenuOpen(false)} onRun={runShortcutMenuCommand} />}
      {addOpen && <AddAppModal catalog={appRegistry.list()} installedVersions={installedVersions} updatingAppId={updatingAppId} onClose={() => setAddOpen(false)} onAdd={addApp} onUpdate={updateApp} />}
      {selectedApp && (
        <RegisteredAppWorkspace
          app={selectedApp}
          desktop={desktop}
          appRuntime={appRuntime}
          profile={activeProfile}
          shortcutCommand={appShortcutCommand?.appId === selectedApp.id ? appShortcutCommand : null}
          persistenceReady={!desktop || Boolean(workspace)}
          assistantOpen={assistantOpen}
          onToggleAssistant={() => setAssistantOpen((open) => !open)}
          onContextChange={setSurfaceContext}
          onClose={() => setSelectedApp(null)}
          onOpenSettings={() => {
            setSelectedApp(null);
            setView("settings");
          }}
          onDone={setToast}
        />
      )}
      {assistantOpen && view !== "chat" && <ChatView
        {...sharedChatProps}
        variant="panel"
        contextLabel={assistantContextLabel}
        onClose={closeAssistantPanel}
        onOpenFull={() => {
          setAssistantOpen(false);
          setSelectedApp(null);
          setView("chat");
        }}
        onOpenSettings={() => {
          setAssistantOpen(false);
          setSelectedApp(null);
          setView("settings");
        }}
        onNewSession={() => createNewChat({ openChat: false })}
        onSelectSession={(sessionId) => selectChatSession(sessionId, { openChat: false })}
        onSend={(text) => sendChatMessage(text, { openChat: false, contextLabel: assistantContextLabel })}
      />}
      {pendingDelete && <Modal title="アプリを削除" onClose={() => setPendingDelete(null)} className="confirm-modal"><div className="confirm-body"><AppGlyph icon={pendingDelete.icon} color={pendingDelete.color} size={52} /><p><strong>{pendingDelete.name}</strong>をMyBoxから削除しますか？</p><div className="confirm-actions"><button onClick={() => setPendingDelete(null)}>キャンセル</button><button className="danger-button" onClick={deleteApp}><Trash size={19} />削除</button></div></div></Modal>}
      {pendingApproval && <AgentApprovalModal request={pendingApproval} onApprove={() => resolveApproval(true)} onReject={() => resolveApproval(false)} />}
      {backgroundPromptOpen && <WorkflowBackgroundModal onChoose={chooseScheduleBackground} onClose={() => setBackgroundPromptOpen(false)} />}
      <UpdatePrompt updater={hostUpdater} />
      {deviceLogin && <DeviceLoginModal login={deviceLogin} onClose={cancelSignIn} />}
      {providerModal === "openai" && <OpenAiConfigModal settings={providerSettings.openaiApi} busy={agentBusy} onClose={() => setProviderModal(null)} onSave={saveOpenAi} onDisconnect={removeOpenAi} />}
      {providerModal === "local" && <LocalLlmConfigModal settings={providerSettings.localLlm} busy={agentBusy} onClose={() => setProviderModal(null)} onSave={saveLocalLlm} onDisconnect={removeLocalLlm} />}
      {toast && <div className="toast" role="status"><Check size={19} weight="bold" />{toast}</div>}
      <span className="sr-only" aria-live="polite">現在の画面：{pageTitle}</span>
    </div>
  );
}
