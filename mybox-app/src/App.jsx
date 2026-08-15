import { useEffect, useMemo, useRef, useState } from "react";
import { chooseWorkspace, getCurrentWorkspace, isDesktopRuntime } from "./desktop/workspace.js";
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
  Globe,
  GlobeHemisphereWest,
  Image as ImageIcon,
  LinkSimple,
  MagicWand,
  PaperPlaneTilt,
  PencilSimpleLine,
  Plus,
  Robot,
  SlidersHorizontal,
  Sparkle,
  Star,
  Trash,
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

const initialApps = [
  { id: "image", name: "画像", icon: "image", color: "#8a74ff", hint: "画像の整理と変換" },
  { id: "note", name: "メモ", icon: "note", color: "#ff796f", hint: "すばやく記録" },
  { id: "files", name: "ファイル", icon: "folder", color: "#5f91ff", hint: "ローカルファイルを管理" },
  { id: "convert", name: "変換", icon: "convert", color: "#ffc45b", hint: "形式をまとめて変換" },
  { id: "publish", name: "公開", icon: "publish", color: "#a68aff", hint: "成果物を公開" },
];

const navItems = [
  { id: "connections", label: "連携", icon: FlowArrow },
  { id: "history", label: "履歴", icon: ClockCounterClockwise },
  { id: "settings", label: "設定", icon: GearSix },
];

const initialProviderSettings = {
  activeProviderId: CODEX_SUBSCRIPTION_PROVIDER_ID,
  openaiApi: { configured: false, model: "gpt-5.6" },
  localLlm: { configured: false, baseUrl: null, model: null },
};

function AppGlyph({ icon, color, size = 108 }) {
  const Icon = iconMap[icon] ?? Cube;
  return (
    <span className="app-glyph" style={{ "--app-color": color }} aria-hidden="true">
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

function EmptyTile({ onClick }) {
  return (
    <button className="app-tile add-tile" onClick={onClick} aria-label="アプリを追加">
      <span className="add-icon" aria-hidden="true"><Plus size={46} /></span>
      <span>追加</span>
    </button>
  );
}

function AppTile({ app, onOpen, onMenu, menuOpen, onDelete, onFavorite }) {
  return (
    <article className="app-tile" style={{ "--app-color": app.color }}>
      <button className="tile-open-area" onClick={() => onOpen(app)} aria-label={`${app.name}を開く`}>
        <AppGlyph icon={app.icon} color={app.color} />
      </button>
      <div className="tile-footer">
        <h2>{app.name}</h2>
        <div className="tile-actions">
          <IconButton label={`${app.name}を開く`} onClick={() => onOpen(app)}>
            <ArrowSquareOut size={25} />
          </IconButton>
          <IconButton label={`${app.name}のメニュー`} aria-expanded={menuOpen} onClick={() => onMenu(app.id)}>
            <DotsThree size={28} weight="bold" />
          </IconButton>
        </div>
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

function Modal({ title, onClose, children, className = "" }) {
  const closeRef = useRef(null);
  const modalRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const preferredFocus = modalRef.current?.querySelector("input[autofocus], select[autofocus]");
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
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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

function AddAppModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("code");
  const colors = ["#67d7c4", "#8a74ff", "#ff796f", "#ffc45b", "#5f91ff"];
  const [color, setColor] = useState(colors[0]);

  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd({ id: `${icon}-${Date.now()}`, name: name.trim(), icon, color, hint: "カスタムアプリ" });
  };

  return (
    <Modal title="アプリを追加" onClose={onClose}>
      <form className="add-form" onSubmit={submit}>
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

function ConnectionsView({ apps, onToast }) {
  const [source, setSource] = useState(apps[0]?.id ?? "");
  const [target, setTarget] = useState(apps[1]?.id ?? "");
  return (
    <section className="secondary-view" aria-labelledby="connections-heading">
      <div className="view-title"><span><LinkSimple size={27} /></span><div><h1 id="connections-heading">連携</h1><p>アプリ同士の受け渡しを設定</p></div></div>
      <div className="connection-builder">
        <label>入力<select value={source} onChange={(e) => setSource(e.target.value)}>{apps.map((app) => <option value={app.id} key={app.id}>{app.name}</option>)}</select></label>
        <FlowArrow size={34} aria-hidden="true" />
        <label>出力<select value={target} onChange={(e) => setTarget(e.target.value)}>{apps.map((app) => <option value={app.id} key={app.id}>{app.name}</option>)}</select></label>
        <button className="primary-button compact" onClick={() => onToast("連携を保存しました")}><Check size={20} />保存</button>
      </div>
      <div className="saved-flow"><div><ImageIcon size={25} /><span>画像</span></div><FlowArrow size={24} /><div><GlobeHemisphereWest size={25} /><span>公開</span></div><span className="status"><Check size={15} />有効</span></div>
    </section>
  );
}

function HistoryView() {
  const entries = [
    ["画像", "変換が完了しました", "10:42"],
    ["公開", "新しいURLを作成しました", "09:18"],
    ["ファイル", "3件を整理しました", "昨日"],
  ];
  return (
    <section className="secondary-view" aria-labelledby="history-heading">
      <div className="view-title"><span><ClockCounterClockwise size={27} /></span><div><h1 id="history-heading">履歴</h1><p>最近の操作</p></div></div>
      <div className="history-list">{entries.map(([name, action, time]) => <div className="history-row" key={`${name}-${time}`}><span className="history-icon"><Check size={18} /></span><strong>{name}</strong><span>{action}</span><time>{time}</time></div>)}</div>
    </section>
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
        <span><Icon size={24} weight="duotone" aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span></span>
        <span className={active ? "workspace-badge connected" : "workspace-badge"}>{badge}</span>
      </button>
      {onConfigure && <IconButton label={`${title}を設定`} className="provider-config" onClick={onConfigure} disabled={disabled}><GearSix size={20} /></IconButton>}
    </div>
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
}) {
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const agentDetail = agentStatus?.connected
    ? `ChatGPT ${agentPlanLabel(agentStatus)} · Codex経由`
    : agentStatus?.authMode
      ? "ChatGPTサインインへ切替が必要です"
      : agentStatus?.error ?? (desktop ? "ChatGPTでサインイン" : "デスクトップ版で設定");
  return (
    <section className="secondary-view" aria-labelledby="settings-heading">
      <div className="view-title"><span><GearSix size={27} /></span><div><h1 id="settings-heading">設定</h1><p>MyBoxの動作</p></div></div>
      <div className="settings-list">
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
          detail={providerSettings.openaiApi.configured ? providerSettings.openaiApi.model : "APIキーをOSへ安全に保存"}
          badge={providerSettings.activeProviderId === OPENAI_API_PROVIDER_ID ? "使用中" : providerSettings.openaiApi.configured ? "選択" : "設定"}
          active={providerSettings.activeProviderId === OPENAI_API_PROVIDER_ID}
          disabled={!desktop || agentBusy}
          onSelect={providerSettings.openaiApi.configured ? () => onSelectProvider(OPENAI_API_PROVIDER_ID) : onConfigureOpenAi}
          onConfigure={onConfigureOpenAi}
        />
        <ProviderRow
          icon={Cube}
          title="Local LLM"
          detail={providerSettings.localLlm.configured ? `${providerSettings.localLlm.model} · このPC` : "OpenAI互換のローカルサーバー"}
          badge={providerSettings.activeProviderId === LOCAL_LLM_PROVIDER_ID ? "使用中" : providerSettings.localLlm.configured ? "選択" : "設定"}
          active={providerSettings.activeProviderId === LOCAL_LLM_PROVIDER_ID}
          disabled={!desktop || agentBusy}
          onSelect={providerSettings.localLlm.configured ? () => onSelectProvider(LOCAL_LLM_PROVIDER_ID) : onConfigureLocal}
          onConfigure={onConfigureLocal}
        />
        <button className="workspace-action" onClick={onChooseWorkspace} disabled={!desktop || workspaceBusy} title={workspace?.path ?? ""}>
          <span><FolderSimple size={22} /><span><strong>保存場所</strong><small>{workspace?.name ?? (desktop ? "未選択" : "Webプレビュー")}</small></span></span>
          <span className="workspace-badge">{workspaceBusy ? "確認中…" : workspace ? "変更" : desktop ? "選択" : "Desktop"}</span>
        </button>
        <button role="switch" aria-checked={confirmDelete} onClick={() => setConfirmDelete(!confirmDelete)}><span><Trash size={22} /><span><strong>削除前に確認</strong><small>誤操作を防ぎます</small></span></span><span className={confirmDelete ? "switch on" : "switch"}><span /></span></button>
        <button role="switch" aria-checked={reduceMotion} onClick={() => setReduceMotion(!reduceMotion)}><span><SlidersHorizontal size={22} /><span><strong>動きを抑える</strong><small>画面のアニメーションを最小化</small></span></span><span className={reduceMotion ? "switch on" : "switch"}><span /></span></button>
      </div>
      <div className="provider-roadmap" aria-label="AIプロバイダーの説明">
        <span><Check size={18} /><small>いつでも切替</small></span>
        <em>アプリ権限は共通</em>
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

function AgentResultModal({ request, response, onClose }) {
  return (
    <Modal title="AI" onClose={onClose} className="agent-result-modal">
      <div className="agent-result">
        <p className="agent-request">{request}</p>
        <div><Sparkle size={22} weight="fill" aria-hidden="true" /><p>{response}</p></div>
      </div>
    </Modal>
  );
}

export function App() {
  const [apps, setApps] = useState(initialApps);
  const [view, setView] = useState("apps");
  const [menuOpen, setMenuOpen] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [toast, setToast] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [providerSettings, setProviderSettings] = useState(initialProviderSettings);
  const [providerModal, setProviderModal] = useState(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentResult, setAgentResult] = useState(null);
  const aiInput = useRef(null);
  const desktop = isDesktopRuntime();

  const pageTitle = useMemo(() => view === "apps" ? "アプリ" : navItems.find((item) => item.id === view)?.label, [view]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setAiOpen(true);
        window.setTimeout(() => aiInput.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
    if (!desktop) return;
    let active = true;
    getAgentProviderSettings()
      .then((settings) => active && setProviderSettings(settings))
      .catch((error) => active && setToast(`AI設定を確認できません：${String(error)}`));
    return () => { active = false; };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) {
      setAgentStatus({ available: false, connected: false, planType: null, authMode: null, error: "デスクトップ版で利用できます" });
      return;
    }
    let active = true;
    setAgentBusy(true);
    getCodexSubscriptionStatus()
      .then((status) => active && setAgentStatus(status))
      .catch((error) => active && setAgentStatus({ available: true, connected: false, planType: null, authMode: null, error: String(error) }))
      .finally(() => active && setAgentBusy(false));
    return () => { active = false; };
  }, [desktop]);

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

  const addApp = (app) => {
    setApps((current) => [...current, app]);
    setAddOpen(false);
    setToast(`${app.name}を追加しました`);
  };

  const deleteApp = () => {
    setApps((current) => current.filter((app) => app.id !== pendingDelete.id));
    setPendingDelete(null);
    setMenuOpen(null);
    setToast("アプリを削除しました");
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

  const runAi = async (event) => {
    event.preventDefault();
    if (!aiText.trim()) return;
    const activeProviderId = providerSettings.activeProviderId;
    const activeReady = activeProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID
      ? agentStatus?.connected
      : activeProviderId === OPENAI_API_PROVIDER_ID
        ? providerSettings.openaiApi.configured
        : activeProviderId === LOCAL_LLM_PROVIDER_ID && providerSettings.localLlm.configured;
    if (!activeReady) {
      setView("settings");
      setToast("先にAIプロバイダーを設定してください");
      return;
    }
    const request = aiText.trim();
    setAgentBusy(true);
    try {
      const provider = nativeAgentProviders[activeProviderId] ?? codexSubscriptionProvider;
      const result = await provider.generate({ prompt: request });
      setAgentResult({ request, response: result.text });
      setAiText("");
      setAiOpen(false);
    } catch (error) {
      setToast(`AIを実行できません：${String(error)}`);
    } finally {
      setAgentBusy(false);
    }
  };

  return (
    <div className="app-shell" onClick={(e) => !e.target.closest(".context-menu, .tile-actions") && setMenuOpen(null)}>
      <header className="topbar">
        <button className="brand" aria-label="アプリ一覧へ" onClick={() => setView("apps")}><Cube size={34} weight="duotone" /><span>MyBox</span></button>
        <div className="topbar-actions">
          <button className="add-button" onClick={() => setAddOpen(true)}><Plus size={23} /><span>追加</span></button>
          <IconButton label="プロフィール" className="profile-button"><img src="/assets/profile-avatar.png" alt="" /></IconButton>
        </div>
      </header>

      <main className="main-content">
        <form className={aiOpen ? "ai-command open" : "ai-command"} onSubmit={runAi} aria-busy={agentBusy}>
          <button type="button" className="ai-trigger" aria-label="AIに頼む" onClick={() => { setAiOpen(true); window.setTimeout(() => aiInput.current?.focus(), 0); }}><Robot size={30} weight="duotone" /></button>
          <input ref={aiInput} aria-label="AIへの依頼" value={aiText} onChange={(e) => setAiText(e.target.value)} onFocus={() => setAiOpen(true)} placeholder={agentBusy ? "考えています…" : "AIに頼む"} disabled={agentBusy} />
          {agentBusy ? <span className="ai-busy spinner" aria-label="AIが処理中" /> : aiOpen ? <button className="ai-send" type="submit" aria-label="依頼を送信"><PaperPlaneTilt size={21} /></button> : <kbd>⌘ K</kbd>}
        </form>

        {view === "apps" && (
          <section className="apps-view" aria-labelledby="apps-heading">
            <h1 id="apps-heading">アプリ</h1>
            <div className="app-grid">
              {apps.map((app) => <AppTile key={app.id} app={app} onOpen={setSelectedApp} menuOpen={menuOpen === app.id} onMenu={(id) => setMenuOpen((current) => current === id ? null : id)} onDelete={setPendingDelete} onFavorite={(item) => { setToast(`${item.name}を固定しました`); setMenuOpen(null); }} />)}
              <EmptyTile onClick={() => setAddOpen(true)} />
            </div>
          </section>
        )}
        {view === "connections" && <ConnectionsView apps={apps} onToast={setToast} />}
        {view === "history" && <HistoryView />}
        {view === "settings" && <SettingsView desktop={desktop} workspace={workspace} workspaceBusy={workspaceBusy} onChooseWorkspace={selectWorkspace} agentStatus={agentStatus} agentBusy={agentBusy} onConnectAgent={connectAgent} providerSettings={providerSettings} onSelectProvider={chooseAgentProvider} onConfigureOpenAi={() => setProviderModal("openai")} onConfigureLocal={() => setProviderModal("local")} />}
      </main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {view !== "apps" && <button className="back-to-apps" onClick={() => setView("apps")} aria-label="アプリに戻る"><ArrowLeft size={22} /><span>アプリ</span></button>}
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><Icon size={32} weight={view === id ? "fill" : "regular"} /><span>{label}</span></button>)}
      </nav>

      {addOpen && <AddAppModal onClose={() => setAddOpen(false)} onAdd={addApp} />}
      {selectedApp && <AppWorkspace app={selectedApp} onClose={() => setSelectedApp(null)} onDone={setToast} />}
      {pendingDelete && <Modal title="アプリを削除" onClose={() => setPendingDelete(null)} className="confirm-modal"><div className="confirm-body"><AppGlyph icon={pendingDelete.icon} color={pendingDelete.color} size={52} /><p><strong>{pendingDelete.name}</strong>をMyBoxから削除しますか？</p><div className="confirm-actions"><button onClick={() => setPendingDelete(null)}>キャンセル</button><button className="danger-button" onClick={deleteApp}><Trash size={19} />削除</button></div></div></Modal>}
      {agentResult && <AgentResultModal request={agentResult.request} response={agentResult.response} onClose={() => setAgentResult(null)} />}
      {providerModal === "openai" && <OpenAiConfigModal settings={providerSettings.openaiApi} busy={agentBusy} onClose={() => setProviderModal(null)} onSave={saveOpenAi} onDisconnect={removeOpenAi} />}
      {providerModal === "local" && <LocalLlmConfigModal settings={providerSettings.localLlm} busy={agentBusy} onClose={() => setProviderModal(null)} onSave={saveLocalLlm} onDisconnect={removeLocalLlm} />}
      {toast && <div className="toast" role="status"><Check size={19} weight="bold" />{toast}</div>}
      <span className="sr-only" aria-live="polite">現在の画面：{pageTitle}</span>
    </div>
  );
}
