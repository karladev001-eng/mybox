import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowsClockwise, CaretDown, CaretLeft, CaretRight, Check, ClipboardText, ClockCounterClockwise, DownloadSimple, Image as ImageIcon, MagicWand, PencilSimple, Plus, Robot, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { createImageStudioClient } from "./client.js";
import { compilePrompt, RATIOS, serializeTemplateMarkdown, TEMPLATE_CATEGORIES } from "./domain.js";
import templateSamples from "./template-samples.webp";
import "./image-studio.css";

const categoryLabels = { world: "世界観", style: "画風", composition: "用途・構図", mood: "雰囲気・装飾" };
const emptySelections = { world: "builtin-world-none", style: "builtin-style-none", composition: "builtin-composition-none", mood: "builtin-mood-none" };
const sampleRows = { world: 0, style: 1, composition: 2, mood: 3 };
const sampleColumns = {
  world: { none: 0, fantasy: 1, sf: 2, japanese: 3, cyberpunk: 4, nature: 5, "neutral-studio": 6 },
  style: { none: 0, photo: 1, anime: 2, flat: 2, watercolor: 3, oil: 4, "3d": 5, pixel: 6 },
  composition: { none: 0, poster: 1, social: 2, product: 3, character: 4, background: 5, icon: 6 },
  mood: { none: 0, minimal: 1, editorial: 2, retro: 3, neon: 4, cinematic: 4, cute: 5, dark: 6 },
};
const sourceLabels = { "built-in": "組み込み", local: "マイテンプレート", note: "Note" };

function sampleStyle(template, fallbackCategory) {
  const category = template.category ?? fallbackCategory;
  const prefix = `builtin-${category}-`;
  const key = template.id?.startsWith(prefix) ? template.id.slice(prefix.length) : "none";
  const column = sampleColumns[category]?.[key] ?? 0;
  return {
    backgroundImage: `url(${templateSamples})`,
    backgroundSize: "700% 400%",
    backgroundPosition: `${(column / 6) * 100}% ${(sampleRows[category] / 3) * 100}%`,
  };
}

function scrollShelf(element, direction) {
  if (!element) return;
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  element.scrollBy({ left: direction * Math.max(240, element.clientWidth * 0.8), behavior: reduceMotion ? "auto" : "smooth" });
}

function TemplateShelf({ category, items, value, onChange }) {
  const catalogRef = useRef(null);
  const active = items.find((item) => item.id === value);
  return <section className="image-template-shelf" id={`image-template-${category}`} aria-labelledby={`image-template-${category}-title`}>
    <header>
      <div><h3 id={`image-template-${category}-title`}>{categoryLabels[category]}</h3><small>{active?.name ?? "指定なし"}</small></div>
      <div className="image-shelf-actions"><button type="button" aria-label={`${categoryLabels[category]}を左へスクロール`} data-tooltip="前へ" onClick={() => scrollShelf(catalogRef.current, -1)}><CaretLeft size={16} /></button><button type="button" aria-label={`${categoryLabels[category]}を右へスクロール`} data-tooltip="次へ" onClick={() => scrollShelf(catalogRef.current, 1)}><CaretRight size={16} /></button></div>
    </header>
    <div ref={catalogRef} className="image-template-catalog" role="group" aria-label={`${categoryLabels[category]}テンプレート。横にスクロールできます`}>
      {items.map((template) => {
        const selected = template.id === value;
        return <button type="button" className={`image-template-card${selected ? " selected" : ""}`} key={template.id} aria-pressed={selected} onClick={() => onChange(template.id)}>
          <span className="image-template-sample" style={sampleStyle(template, category)} role="img" aria-label={`${template.name}の生成結果サンプル`}>{selected && <span><Check size={18} weight="bold" /></span>}</span>
          <span className="image-template-card-body">
            {template.source !== "built-in" && <small className="image-template-source">{sourceLabels[template.source] ?? "連携"}</small>}
            <strong>{template.name}</strong>
            <span>{template.prompt || "AIに任せる"}</span>
          </span>
        </button>;
      })}
    </div>
  </section>;
}

function RatioShelf({ value, onChange }) {
  const catalogRef = useRef(null);
  return <section className="image-template-shelf image-ratio-shelf" id="image-template-ratio" aria-labelledby="image-template-ratio-title">
    <header><div><h3 id="image-template-ratio-title">縦横比</h3><small>{value === "auto" ? "指定なし" : value}</small></div><div className="image-shelf-actions"><button type="button" aria-label="縦横比を左へスクロール" data-tooltip="前へ" onClick={() => scrollShelf(catalogRef.current, -1)}><CaretLeft size={16} /></button><button type="button" aria-label="縦横比を右へスクロール" data-tooltip="次へ" onClick={() => scrollShelf(catalogRef.current, 1)}><CaretRight size={16} /></button></div></header>
    <div ref={catalogRef} className="image-ratio-catalog" role="group" aria-label="縦横比。横にスクロールできます">
      {Object.entries(RATIOS).map(([id, size]) => {
        const selected = id === value;
        return <button type="button" className={`image-ratio-card${selected ? " selected" : ""}`} key={id} aria-pressed={selected} onClick={() => onChange(id)}>
          <span className="image-ratio-stage"><span className={`image-ratio-window ratio-${id.replace(":", "-")}`} style={{ ...sampleStyle({ id: "builtin-world-none", category: "world" }, "world"), aspectRatio: id === "auto" ? "1 / 1" : id.replace(":", " / ") }}>{selected && <Check size={16} weight="bold" />}</span></span>
          <span><strong>{id === "auto" ? "指定なし" : id}</strong><small>{id === "auto" ? "AIに最適な比率を委ねる" : `${size.width}×${size.height}px`}</small></span>
        </button>;
      })}
    </div>
  </section>;
}

function PromptPanel({ prompt, selections, ratio }) {
  return <aside className="image-prompt-panel" id="image-prompt-panel" aria-labelledby="image-prompt-panel-title">
    <header>
      <span><ClipboardText size={21} aria-hidden="true" /><strong id="image-prompt-panel-title">全体Prompt</strong></span>
      <small>{prompt.length.toLocaleString()}文字</small>
    </header>
    <div className="image-prompt-selections" aria-label="現在の選択">{selections.map((item) => <span key={item.category}><small>{categoryLabels[item.category]}</small>{item.name}</span>)}<span><small>縦横比</small>{ratio === "auto" ? "指定なし" : ratio}</span></div>
    <pre tabIndex="0" aria-label="選択したテンプレートを組み合わせた全体Prompt">{prompt}</pre>
  </aside>;
}

function TemplateEditor({ template, onSave, onClose }) {
  const [markdown, setMarkdown] = useState(() => template?.markdown ?? serializeTemplateMarkdown({ name: "新しいテンプレート", category: "world", prompt: "ここにPrompt断片を入力" }));
  const [error, setError] = useState("");
  useEffect(() => { const escape = (event) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); }, [onClose]);
  const submit = async (event) => { event.preventDefault(); setError(""); try { await onSave(markdown); onClose(); } catch (next) { setError(next.message); } };
  return <div className="image-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="image-template-dialog" role="dialog" aria-modal="true" aria-labelledby="image-template-title" onSubmit={submit}>
      <header><h2 id="image-template-title">{template ? "テンプレートを編集" : "テンプレートを作成"}</h2><button type="button" aria-label="閉じる" data-tooltip="閉じる" onClick={onClose}><X size={20} /></button></header>
      {error && <p className="image-error" role="alert">{error}</p>}
      <label htmlFor="template-markdown">Markdown</label>
      <textarea id="template-markdown" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck="false" autoFocus />
      <footer><button type="button" onClick={onClose}>キャンセル</button><button className="image-primary" type="submit">保存</button></footer>
    </form>
  </div>;
}

export function ImageStudioView({ desktop = false, profileId = "local-user", persistenceReady = true, onClose, onOpenSettings, onToggleAssistant, assistantOpen = false, onContextChange, onToast = () => {}, appRuntime = null }) {
  const profileRef = useRef(profileId); profileRef.current = profileId;
  const clientRef = useRef(null);
  if (!clientRef.current) clientRef.current = createImageStudioClient({ desktop, appRuntime, getUserId: () => profileRef.current });
  const client = clientRef.current;
  const [templates, setTemplates] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [subject, setSubject] = useState("");
  const [extra, setExtra] = useState("");
  const [referenceInstruction, setReferenceInstruction] = useState("");
  const [ratio, setRatio] = useState("auto");
  const [selections, setSelections] = useState(emptySelections);
  const [references, setReferences] = useState([]);
  const [referencePreviews, setReferencePreviews] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [includeTrash, setIncludeTrash] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(true);
  const [editor, setEditor] = useState(null);

  const refresh = async () => {
    const [templateResult, generationResult] = await Promise.all([client.listTemplates(), client.listGenerations(includeTrash)]);
    setTemplates(templateResult.templates); setGenerations(generationResult.generations);
    if (!selectedId && generationResult.generations[0]) setSelectedId(generationResult.generations[0].id);
  };

  useEffect(() => { if (!persistenceReady) return; refresh().catch((next) => setError(next.message)); }, [persistenceReady, includeTrash]);
  useEffect(() => { onContextChange?.({ label: "Image", appId: "image-studio", operationContext: { generationId: selectedId } }); }, [onContextChange, selectedId]);

  const selected = generations.find((item) => item.id === selectedId) ?? null;
  useEffect(() => { let active = true; if (!selected?.resource?.resourceId) { setPreview(null); return; } client.readResource(selected.resource.resourceId).then((value) => active && setPreview(value)).catch((next) => active && setError(next.message)); return () => { active = false; }; }, [selected?.resource?.resourceId]);

  const localTemplates = templates.filter((item) => item.source === "local");
  const templatesFor = (category) => templates.filter((item) => item.category === category && item.state !== "trash");
  const selectedTemplateSummary = useMemo(() => TEMPLATE_CATEGORIES.map((category) => ({
    category,
    name: templates.find((item) => item.id === selections[category])?.name ?? "指定なし",
  })), [selections, templates]);
  const promptPreview = useMemo(() => {
    try {
      return compilePrompt({
        subject: subject.trim() || "（主題未入力）",
        selections,
        templates: templates.filter((item) => item.state !== "trash"),
        ratio,
        references,
        referenceInstruction,
        extra,
      }).prompt;
    } catch (next) {
      return next.message;
    }
  }, [extra, ratio, referenceInstruction, references, selections, subject, templates]);

  const addReference = async (file = null) => {
    if (references.length >= 4) { setError("参照画像は4枚までです"); return; }
    try {
      const resource = file ? await client.storeReference(file) : await client.pickReference();
      if (!resource) return;
      setReferences((items) => [...items, resource]);
      const uri = await client.readResource(resource.resourceId); setReferencePreviews((items) => ({ ...items, [resource.resourceId]: uri }));
    } catch (next) { setError(next.message); }
  };

  useEffect(() => {
    const paste = (event) => { const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/")); if (file) { event.preventDefault(); addReference(file); } };
    document.addEventListener("paste", paste); return () => document.removeEventListener("paste", paste);
  }, [references.length]);

  const generate = async () => {
    if (!subject.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const result = await client.generate({ subject: subject.trim(), selections, ratio, references, referenceInstruction, extra });
      await refresh(); setSelectedId(result.generation.id);
      if (result.generation.state === "error") setError(result.generation.error?.message ?? "生成に失敗しました");
      else onToast("画像を生成しました");
    } catch (next) { setError(next.message); } finally { setBusy(false); }
  };

  const selectGeneration = (generation) => { setSelectedId(generation.id); setHistoryOpen(false); if (generation.input) { setSubject(generation.input.subject ?? ""); setSelections({ ...emptySelections, ...(generation.input.selections ?? {}) }); setRatio(generation.input.ratio ?? "auto"); setExtra(generation.input.extra ?? ""); } };
  const download = () => { if (!preview) return; const link = document.createElement("a"); link.href = preview; link.download = `${selected?.id ?? "mybox-image"}.${selected?.resource?.mediaType === "image/jpeg" ? "jpg" : selected?.resource?.mediaType === "image/webp" ? "webp" : "png"}`; link.click(); };
  const exportTemplate = async (id) => { const result = await client.readTemplate(id); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown" })); link.download = `${result.template.name.replace(/[\\/:*?"<>|]/g, "-")}.md`; link.click(); URL.revokeObjectURL(link.href); };

  if (!persistenceReady) return <section className="image-studio-shell image-setup"><div><ImageIcon size={44} weight="duotone" /><h1>保存場所を設定してください</h1><p>Image Appは生成履歴と画像をローカルWorkspaceへ保存します。</p><div><button onClick={onClose}>戻る</button><button className="image-primary" onClick={onOpenSettings}>設定を開く</button></div></div></section>;

  return <section className={`image-studio-shell${promptOpen ? " image-prompt-open" : ""}`} aria-label="Image App" aria-busy={busy} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/")); if (file) addReference(file); }}>
    <header className="image-topbar"><button aria-label="MyBoxへ戻る" data-tooltip="戻る" onClick={onClose}><ArrowLeft size={20} /></button><div><ImageIcon size={22} weight="duotone" /><span><strong>Image</strong><small>Studio</small></span></div><button className={`image-prompt-toggle${promptOpen ? " selected" : ""}`} aria-label={promptOpen ? "全体Promptを隠す" : "全体Promptを表示"} aria-controls="image-prompt-panel" aria-expanded={promptOpen} aria-pressed={promptOpen} data-tooltip={promptOpen ? "Promptを隠す" : "Promptを表示"} onClick={() => setPromptOpen((value) => !value)}><ClipboardText size={18} weight={promptOpen ? "fill" : "regular"} aria-hidden="true" /></button><button className="image-history-toggle" aria-label={historyOpen ? "生成履歴を閉じる" : "生成履歴を開く"} aria-expanded={historyOpen} data-tooltip="生成履歴" onClick={() => setHistoryOpen((value) => !value)}><ClockCounterClockwise size={19} /></button><button aria-label={assistantOpen ? "AIアシスタントを閉じる" : "AIアシスタントを開く"} aria-pressed={assistantOpen} data-tooltip="AIアシスタント" onClick={onToggleAssistant}><Robot size={20} weight={assistantOpen ? "fill" : "regular"} /></button></header>

    <aside className={`image-history${historyOpen ? " open" : ""}`} aria-label="生成履歴">
      <header><div><h2>生成履歴</h2><small>{generations.length}</small></div><button role="switch" aria-label="Trashを表示" aria-checked={includeTrash} data-tooltip="Trash" onClick={() => setIncludeTrash((value) => !value)}><Trash size={17} /></button></header>
      <div className="image-history-list">{generations.length ? generations.map((generation) => <button key={generation.id} className={selectedId === generation.id ? "selected" : ""} aria-current={selectedId === generation.id ? "true" : undefined} onClick={() => selectGeneration(generation)}><span className={`image-status ${generation.state}`} aria-hidden="true" /><span><strong>{generation.input?.subject ?? "生成画像"}</strong><small>{generation.state === "complete" ? `${generation.actual?.width}×${generation.actual?.height}` : generation.state === "error" ? "エラー" : generation.state === "trash" ? "Trash" : "生成中"}</small></span></button>) : <p className="image-empty-list">生成すると、ここに履歴が並びます。</p>}</div>
    </aside>

    {promptOpen && <PromptPanel prompt={promptPreview} selections={selectedTemplateSummary} ratio={ratio} />}

    <main className="image-preview-pane">
      <div className="image-preview-frame" style={{ aspectRatio: ratio === "auto" ? "1 / 1" : ratio.replace(":", "/") }}>
        {busy ? <div className="image-progress" role="status" aria-live="polite"><span className="image-spinner" /><strong>画像を生成しています</strong><p>ChatGPTが構図と画風を組み立てています。画面を閉じずにお待ちください。</p></div>
          : preview ? <img src={preview} alt={selected?.input?.subject ? `生成画像：${selected.input.subject}` : "生成画像"} width={selected?.actual?.width} height={selected?.actual?.height} />
          : selected?.state === "error" ? <div className="image-preview-empty error"><ImageIcon size={46} /><strong>生成できませんでした</strong><p>{selected.error?.message}</p><button onClick={generate}><ArrowsClockwise size={18} />再試行</button></div>
          : <div className="image-preview-empty"><MagicWand size={48} weight="duotone" /><strong>イメージを形にする</strong></div>}
      </div>
      {selected?.warning && <p className="image-warning" role="status">{selected.warning}</p>}
      <div className="image-preview-actions"><button aria-label="再生成" data-tooltip="再生成" disabled={!selected?.input || busy} onClick={generate}><ArrowsClockwise size={18} /></button><button aria-label="画像を書き出す" data-tooltip="書き出す" disabled={!preview} onClick={download}><DownloadSimple size={18} /></button>{selected?.state === "trash" ? <><button aria-label="画像を復元" data-tooltip="復元" onClick={async () => { await client.restoreGeneration(selected.id); await refresh(); }}><ArrowsClockwise size={18} /></button><button className="image-danger" aria-label="画像を完全削除" data-tooltip="完全削除" onClick={async () => { await client.purgeGeneration(selected.id); setSelectedId(null); await refresh(); }}><Trash size={18} /></button></> : selected && <button className="image-danger" aria-label="画像をTrashへ移動" data-tooltip="Trash" onClick={async () => { await client.trashGeneration(selected.id); await refresh(); }}><Trash size={18} /></button>}</div>
      {error && <p className="image-error" role="alert">{error}</p>}
    </main>

    <aside className="image-controls" aria-label="生成条件">
      <div className="image-controls-heading"><h2>生成条件</h2><button aria-label="ローカルテンプレートを作成" data-tooltip="テンプレートを作成" onClick={() => setEditor({})}><Plus size={18} /></button></div>
      <details className="image-template-tools"><summary><span><strong>マイテンプレート</strong><small>{localTemplates.length}</small></span><CaretDown size={16} aria-hidden="true" /></summary><div className="image-template-import"><button type="button" aria-label="テンプレートを新規作成" data-tooltip="新規作成" onClick={() => setEditor({})}><Plus size={16} /></button><label aria-label="Markdownテンプレートをインポート" data-tooltip="インポート" tabIndex="0" onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.querySelector("input")?.click(); } }}><UploadSimple size={16} /><input type="file" accept=".md,.markdown,text/markdown" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { try { await client.createTemplate(await file.text()); await refresh(); onToast("テンプレートをインポートしました"); } catch (next) { setError(next.message); } event.target.value = ""; }}} /></label></div>{localTemplates.length ? <ul>{localTemplates.map((template) => <li key={template.id}><span><strong>{template.name}</strong><small>{categoryLabels[template.category]}{template.state === "trash" ? " · Trash" : ""}</small></span><button aria-label={`${template.name}を編集`} data-tooltip="編集" disabled={template.state === "trash"} onClick={async () => { const result = await client.readTemplate(template.id); setEditor({ id: template.id, markdown: result.markdown }); }}><PencilSimple size={15} /></button><button aria-label={`${template.name}をエクスポート`} data-tooltip="書き出す" onClick={() => exportTemplate(template.id)}><DownloadSimple size={15} /></button><button aria-label={template.state === "trash" ? `${template.name}を復元` : `${template.name}をTrashへ移動`} data-tooltip={template.state === "trash" ? "復元" : "Trash"} onClick={async () => { if (template.state === "trash") await client.restoreTemplate(template.id); else await client.trashTemplate(template.id); await refresh(); }}>{template.state === "trash" ? <ArrowsClockwise size={15} /> : <Trash size={15} />}</button></li>)}</ul> : null}</details>
      <label htmlFor="image-subject">主題</label><textarea id="image-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="例：雨上がりの東京を歩く白いロボット" maxLength={4000} />
      <fieldset><legend>参照画像 <span>{references.length}/4</span></legend><div className="image-reference-grid">{references.map((reference) => <div key={reference.resourceId}><img src={referencePreviews[reference.resourceId]} alt="参照画像" /><button aria-label="参照画像を外す" data-tooltip="外す" onClick={() => setReferences((items) => items.filter((item) => item.resourceId !== reference.resourceId))}><X size={15} /></button></div>)}{references.length < 4 && <button className="image-reference-add" aria-label="参照画像を追加" data-tooltip="追加・Drop・貼り付け" onClick={() => addReference()}><UploadSimple size={20} /></button>}</div></fieldset>
      {references.length > 0 && <><label htmlFor="reference-instruction">参照画像の扱い</label><input id="reference-instruction" value={referenceInstruction} onChange={(event) => setReferenceInstruction(event.target.value)} placeholder="残す特徴や変えたい点" /></>}
      <div className="image-template-market-heading"><h2>テンプレート</h2></div>
      <nav className="image-template-nav" aria-label="テンプレートカテゴリー">{TEMPLATE_CATEGORIES.map((category) => <button type="button" key={category} onClick={() => document.getElementById(`image-template-${category}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{categoryLabels[category]}</button>)}<button type="button" onClick={() => document.getElementById("image-template-ratio")?.scrollIntoView({ behavior: "smooth", block: "start" })}>縦横比</button></nav>
      {TEMPLATE_CATEGORIES.map((category) => <TemplateShelf key={category} category={category} items={templatesFor(category)} value={selections[category]} onChange={(value) => setSelections((items) => ({ ...items, [category]: value }))} />)}
      <RatioShelf value={ratio} onChange={setRatio} />
      <label htmlFor="image-extra">追加入力</label><textarea id="image-extra" className="image-extra" value={extra} onChange={(event) => setExtra(event.target.value)} placeholder="色、文字を入れない、余白など" maxLength={4000} />
      <button className="image-generate" disabled={busy || !subject.trim()} onClick={generate}>{busy ? <span className="image-spinner" /> : <MagicWand size={21} weight="fill" />}<span>{busy ? "生成中…" : references.length ? "参照画像からアレンジ" : "画像を生成"}</span></button>
    </aside>
    {editor && <TemplateEditor template={editor.id ? editor : null} onClose={() => setEditor(null)} onSave={async (markdown) => { if (editor.id) await client.updateTemplate(editor.id, markdown); else await client.createTemplate(markdown); await refresh(); }} />}
  </section>;
}
