import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  BracketsCurly,
  CalendarBlank,
  Check,
  CaretDown,
  CaretUp,
  ClockCounterClockwise,
  FlowArrow,
  Image as ImageIcon,
  Lightning,
  MagnifyingGlass,
  NotePencil,
  Pause,
  Play,
  Plus,
  Power,
  TerminalWindow,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { ThemedSelect } from "./ThemedSelect.jsx";
import { workflowActionAccepts, workflowActionOutputType, workflowStatusLabel } from "./core/workflow-manager.js";
import { parseWorkflowJsonPath, workflowSchemaPaths } from "./core/workflow-json.js";

const triggerKinds = [
  { id: "event", label: "Appイベント" },
  { id: "manual", label: "手動" },
  { id: "schedule", label: "スケジュール" },
  { id: "app-request", label: "Appからの要求" },
];
const frequencies = [
  { id: "hourly", label: "毎時" },
  { id: "daily", label: "毎日" },
  { id: "weekly", label: "毎週" },
];
const weekdays = ["日", "月", "火", "水", "木", "金", "土"].map((label, id) => ({ id: String(id), label: `${label}曜日` }));

function IconButton({ label, children, className = "", ...props }) {
  return <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} data-tooltip={label} {...props}>{children}</button>;
}

function appIcon(appId, size = 22) {
  const Icon = appId === "image-studio" ? ImageIcon : appId === "knowledge" ? NotePencil : Lightning;
  return <Icon size={size} aria-hidden="true" />;
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return "—";
  const duration = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)}秒`;
}

function initialConfig(schema = {}) {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([key, property]) => {
    if (property.default !== undefined) return [[key, property.default]];
    if (property.enum?.length) return [[key, property.enum[0]]];
    if (!(schema.required ?? []).includes(key)) return [];
    if (property.type === "object") return [[key, {}]];
    if (property.type === "array") return [[key, []]];
    if (property.type === "boolean") return [[key, false]];
    if (property.type === "integer" || property.type === "number") return [[key, property.minimum ?? 0]];
    if (property.type === "string") return [[key, ""]];
    return [];
  }));
}

function createStep(action) {
  return { id: crypto.randomUUID(), appId: action.appId, actionId: action.id, config: initialConfig(action.configSchema), inputMappings: [], outputMappings: [] };
}

function outputDestination(path) {
  const leaf = path.split(".").at(-1)?.replace(/\[\*\]/g, "") || "result";
  const key = path.includes("[*]") && leaf === "title" ? "pageTitles" : leaf.replace(/[^a-zA-Z0-9_-]/g, "") || "result";
  return `$.data.${key}`;
}

function PathField({ id, label, value, onChange, writable = false, dataDestination = false, placeholder }) {
  const [error, setError] = useState("");
  const validate = () => {
    if (!value) { setError(""); return; }
    try {
      const tokens = parseWorkflowJsonPath(value, { writable });
      if (dataDestination && (tokens[0]?.type !== "property" || tokens[0].key !== "data")) throw new Error("$.data から始めてください");
      setError("");
    } catch (pathError) { setError(pathError.message); }
  };
  return <label className="workflow-field workflow-path-field" htmlFor={id}><span>{label}</span><input id={id} value={value} placeholder={placeholder} spellCheck="false" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { setError(""); onChange(event.target.value); }} onBlur={validate} />{error && <small id={`${id}-error`} role="alert">{error}</small>}</label>;
}

function MappingPanel({ step, action, onChange }) {
  const inputMappings = step.inputMappings ?? [];
  const outputMappings = step.outputMappings ?? [];
  const outputPaths = workflowSchemaPaths(action.outputSchema ?? { type: "object" }).filter((path) => path !== "$");
  const updateInput = (key, from) => {
    const to = `$.${key}`;
    const next = inputMappings.filter((mapping) => mapping.to !== to);
    if (from.trim()) next.push({ from: from.trim(), to });
    onChange({ ...step, inputMappings: next });
  };
  const addOutput = (from = outputPaths[0] ?? "$") => onChange({
    ...step,
    outputMappings: [...outputMappings, { from, to: outputDestination(from) }],
  });
  return <>
    {action.source === "agent-command" && Object.keys(action.inputSchema?.properties ?? {}).length > 0 && <section className="workflow-mapping-group" aria-labelledby={`input-mapping-${step.id}`}>
      <h3 id={`input-mapping-${step.id}`}>JSONから入力</h3>
      {Object.entries(action.inputSchema.properties).map(([key, property]) => <PathField key={key} id={`${step.id}-input-${key}`} label={`${property.title ?? key}の参照元`} value={inputMappings.find((mapping) => mapping.to === `$.${key}`)?.from ?? ""} placeholder="$.data.projectId" onChange={(from) => updateInput(key, from)} />)}
    </section>}
    <section className="workflow-mapping-group" aria-labelledby={`output-mapping-${step.id}`}>
      <div className="workflow-mapping-heading"><h3 id={`output-mapping-${step.id}`}>JSONへ出力</h3><IconButton label="出力先を追加" onClick={() => addOutput()}><Plus size={16} /></IconButton></div>
      {outputPaths.length > 0 && <div className="workflow-path-suggestions" aria-label="出力候補">{outputPaths.slice(0, 8).map((path) => <button type="button" key={path} onClick={() => addOutput(path)}>{path}</button>)}</div>}
      {outputMappings.map((mapping, index) => <div className="workflow-mapping-row" key={index}>
        <PathField id={`${step.id}-output-from-${index}`} label="結果" value={mapping.from} placeholder="$.pages[*].title" onChange={(from) => onChange({ ...step, outputMappings: outputMappings.map((item, cursor) => cursor === index ? { ...item, from } : item) })} />
        <PathField id={`${step.id}-output-to-${index}`} label="保存先" value={mapping.to} writable dataDestination placeholder="$.data.pageTitles" onChange={(to) => onChange({ ...step, outputMappings: outputMappings.map((item, cursor) => cursor === index ? { ...item, to } : item) })} />
        <IconButton label="出力設定を削除" className="text-danger" onClick={() => onChange({ ...step, outputMappings: outputMappings.filter((_, cursor) => cursor !== index) })}><Trash size={16} /></IconButton>
      </div>)}
    </section>
  </>;
}

function triggerOutputType(draft, events) {
  if (draft?.trigger?.kind !== "event") return null;
  return events.find((item) => item.appId === draft.trigger.appId && item.id === draft.trigger.connectorId)?.dataType ?? null;
}

function stepAction(step, actions) {
  return actions.find((item) => item.appId === step.appId && item.id === step.actionId) ?? null;
}

function typeBeforeStep(draft, index, events, actions) {
  let type = triggerOutputType(draft, events);
  for (let cursor = 0; cursor < index; cursor += 1) {
    const action = stepAction(draft.steps[cursor], actions);
    type = workflowActionOutputType(action, type);
  }
  return type;
}

function validStepOrder(draft, steps, events, actions) {
  let type = triggerOutputType(draft, events);
  if (["manual", "schedule"].includes(draft.trigger.kind)) type = null;
  for (let index = 0; index < steps.length; index += 1) {
    const action = stepAction(steps[index], actions);
    if (!action || !workflowActionAccepts(action, type)) return false;
    type = workflowActionOutputType(action, type);
    if (!type && index < steps.length - 1 && !action.passthrough) return false;
  }
  return true;
}

function JsonField({ id, label, value, onChange, required, kind }) {
  const format = (next) => JSON.stringify(next ?? (kind === "array" ? [] : {}), null, 2);
  const [draft, setDraft] = useState(() => format(value));
  const [error, setError] = useState("");
  useEffect(() => setDraft(format(value)), [value, kind]);
  const parse = (text, showError) => {
    try {
      const next = JSON.parse(text);
      const validKind = kind === "array" ? Array.isArray(next) : next !== null && typeof next === "object" && !Array.isArray(next);
      if (!validKind) throw new Error(kind === "array" ? "配列を入力してください" : "オブジェクトを入力してください");
      setError("");
      onChange(next);
      return true;
    } catch (parseError) {
      if (showError) setError(parseError.message.endsWith("入力してください") ? parseError.message : "JSONの形式が正しくありません");
      return false;
    }
  };
  return <label className="workflow-field workflow-json-field" htmlFor={id}><span>{label}{required && <b aria-hidden="true"> *</b>}</span><textarea id={id} rows="5" required={required} value={draft} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { setDraft(event.target.value); parse(event.target.value, false); }} onBlur={() => parse(draft, true)} />{error && <small id={`${id}-error`} role="alert">{error}</small>}</label>;
}

function FieldList({ idPrefix, schema = {}, value, onChange, options }) {
  const project = options.projects?.find((item) => item.id === value.projectId);
  return Object.entries(schema.properties ?? {}).flatMap(([key, property]) => {
    const required = (schema.required ?? []).includes(key);
    const id = `${idPrefix}-${key}`;
    const propertyTypes = Array.isArray(property.type) ? property.type : [property.type];
    const structuredType = propertyTypes.includes("array") ? "array" : propertyTypes.includes("object") ? "object" : null;
    if (structuredType) return [<JsonField key={key} id={id} label={property.title ?? key} required={required} kind={structuredType} value={value[key]} onChange={(next) => onChange({ ...value, [key]: next })} />];
    let choices = [];
    if (property.enum) choices = property.enum.map((item) => ({ id: String(item), label: String(item) }));
    if (property.format === "mybox-project") choices = (options.projects ?? []).map((item) => ({ id: item.id, label: item.label }));
    if (property.format === "mybox-tag") choices = (project?.tags ?? []).map((item) => ({ id: item, label: item }));
    const label = property.title ?? key;
    if (choices.length) {
      const selected = value[key] ?? choices[0].id;
      return [<ThemedSelect key={key} id={id} label={`${label}${required ? " *" : ""}`} options={choices} value={selected} onChange={(next) => onChange({ ...value, [key]: property.type === "integer" ? Number(next) : next })} placement="bottom" />];
    }
    if (property.type === "boolean") {
      const checked = Boolean(value[key]);
      return [<div className="workflow-field" key={key}><span>{label}{required && <b aria-hidden="true"> *</b>}</span><button id={id} type="button" role="switch" aria-checked={checked} className={`workflow-switch${checked ? " active" : ""}`} onClick={() => onChange({ ...value, [key]: !checked })}><span aria-hidden="true" />{checked ? "オン" : "オフ"}</button></div>];
    }
    if (property.type === "integer" || property.type === "number") {
      return [<label className="workflow-field" key={key} htmlFor={id}><span>{label}{required && <b aria-hidden="true"> *</b>}</span><input id={id} required={required} type="number" min={property.minimum} max={property.maximum} value={value[key] ?? ""} onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })} /></label>];
    }
    if (property.maxLength > 500) {
      return [<label className="workflow-field" key={key} htmlFor={id}><span>{label}{required && <b aria-hidden="true"> *</b>}</span><textarea id={id} required={required} rows="4" value={value[key] ?? ""} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label>];
    }
    return [<label className="workflow-field" key={key} htmlFor={id}><span>{label}{required && <b aria-hidden="true"> *</b>}</span><input id={id} required={required} value={value[key] ?? ""} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label>];
  });
}

function ConfigPanel({ runtime, endpoint, schema, value, onChange, direction, title }) {
  const [options, setOptions] = useState({ projects: [] });
  useEffect(() => {
    let active = true;
    const request = endpoint.actionId
      ? { appId: endpoint.appId, actionId: endpoint.actionId }
      : { appId: endpoint.appId, connectorId: endpoint.connectorId, direction };
    runtime.workflows.options(request).then((result) => active && setOptions(result)).catch(() => active && setOptions({ projects: [] }));
    return () => { active = false; };
  }, [runtime, endpoint.appId, endpoint.actionId, endpoint.connectorId, direction]);
  useEffect(() => {
    const next = { ...value };
    let changed = false;
    for (const key of schema.required ?? []) {
      const property = schema.properties?.[key] ?? {};
      if (property.format === "mybox-project") {
        const projects = options.projects ?? [];
        if (!projects.some((project) => project.id === next[key]) && projects[0]) { next[key] = projects[0].id; changed = true; }
        continue;
      }
      if (property.format === "mybox-tag") {
        const project = (options.projects ?? []).find((item) => item.id === next.projectId) ?? options.projects?.[0];
        if (!(project?.tags ?? []).includes(next[key]) && project?.tags?.[0]) { next[key] = project.tags[0]; changed = true; }
        continue;
      }
      if (next[key] !== undefined && next[key] !== "") continue;
      if (property.enum?.length) { next[key] = property.enum[0]; changed = true; }
    }
    if (changed) onChange(next);
  }, [schema, options, value, onChange]);
  return <div className="workflow-config-group">{title && <h3>{title}</h3>}<FieldList idPrefix={`${endpoint.appId}-${endpoint.actionId ?? endpoint.connectorId}`} schema={schema} value={value} onChange={onChange} options={options} /></div>;
}

function AddAction({ index, draft, events, actions, onInsert }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const before = typeBeforeStep(draft, index, events, actions);
  const previous = index > 0 ? stepAction(draft.steps[index - 1], actions) : null;
  const next = draft.steps[index] ? stepAction(draft.steps[index], actions) : null;
  const candidates = previous && !previous.passthrough && !previous.outputDataType
    ? []
    : actions.filter((action) => workflowActionAccepts(action, before) && (!next || workflowActionAccepts(next, workflowActionOutputType(action, before))));
  const filtered = candidates.filter((action) => `${action.appName} ${action.title} ${action.operationId}`.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP")));
  const [choice, setChoice] = useState(candidates[0]?.id ?? "");
  useEffect(() => setChoice((current) => filtered.some((item) => item.id === current) ? current : filtered[0]?.id ?? ""), [before, next?.id, query, filtered.length]);
  if (!candidates.length) return <span className="workflow-rail-line" aria-hidden="true" />;
  if (!open) return <IconButton className="workflow-add-step" label="ここにActionを追加" onClick={() => { setQuery(""); setOpen(true); }}><Plus size={17} /></IconButton>;
  const selected = filtered.find((item) => item.id === choice) ?? filtered[0];
  return (
    <div className="workflow-add-picker">
      <label className="workflow-action-search" htmlFor={`workflow-search-${index}`}><MagnifyingGlass size={16} aria-hidden="true" /><span className="sr-only">Actionを検索</span><input id={`workflow-search-${index}`} value={query} placeholder="Actionを検索" onChange={(event) => setQuery(event.target.value)} /></label>
      {selected ? <ThemedSelect id={`workflow-add-${index}`} label="追加するAction" options={filtered.map((item) => ({ id: item.id, label: `${item.appName} · ${item.title}`, description: item.source === "agent-command" ? "コマンド" : "データ連携" }))} value={selected.id} onChange={setChoice} compact placement="bottom" /> : <span className="workflow-action-empty">一致なし</span>}
      <div className="workflow-add-picker-actions"><IconButton label="追加をキャンセル" onClick={() => setOpen(false)}><X size={17} /></IconButton><IconButton label="Actionを追加" disabled={!selected} onClick={() => { onInsert(index, selected); setOpen(false); }}><Check size={17} /></IconButton></div>
    </div>
  );
}

function TriggerInspector({ runtime, draft, setDraft, events, requestPairs, actions }) {
  const kind = draft.trigger.kind;
  const changeKind = (nextKind) => {
    if (nextKind === "event") {
      const event = events[0];
      const action = actions.find((item) => item.inputDataType === event?.dataType);
      setDraft({ ...draft, trigger: { kind: "event", appId: event?.appId, connectorId: event?.id }, steps: action ? [createStep(action)] : [] });
    } else if (nextKind === "app-request") {
      const pair = requestPairs[0];
      setDraft({ ...draft, trigger: { kind: "app-request", source: pair ? { appId: pair.source.appId, connectorId: pair.source.id, config: {} } : {}, target: pair ? { appId: pair.target.appId, connectorId: pair.target.id, config: {} } : {} }, steps: [] });
    } else {
      const action = actions.find((item) => !item.inputDataType);
      setDraft({ ...draft, trigger: nextKind === "schedule" ? { kind: "schedule", schedule: { frequency: "daily", hour: 9, minute: 0, weekday: 1, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } } : { kind: "manual" }, steps: action ? [createStep(action)] : [] });
    }
  };
  return (
    <div className="workflow-inspector-fields">
      <ThemedSelect id="workflow-trigger-kind" label="開始方法" options={triggerKinds} value={kind} onChange={changeKind} placement="bottom" />
      {kind === "event" && events.length > 0 && <ThemedSelect id="workflow-event" label="イベント" options={events.map((item) => ({ id: `${item.appId}|${item.id}`, label: `${item.appName} · ${item.title}` }))} value={`${draft.trigger.appId}|${draft.trigger.connectorId}`} onChange={(selected) => {
        const [appId, connectorId] = selected.split("|"); const event = events.find((item) => item.appId === appId && item.id === connectorId); const action = actions.find((item) => item.inputDataType === event?.dataType);
        setDraft({ ...draft, trigger: { kind: "event", appId, connectorId }, steps: action ? [createStep(action)] : [] });
      }} placement="bottom" />}
      {kind === "schedule" && <>
        <ThemedSelect id="workflow-frequency" label="頻度" options={frequencies} value={draft.trigger.schedule.frequency} onChange={(frequency) => setDraft({ ...draft, trigger: { ...draft.trigger, schedule: { ...draft.trigger.schedule, frequency } } })} placement="bottom" />
        {draft.trigger.schedule.frequency === "weekly" && <ThemedSelect id="workflow-weekday" label="曜日" options={weekdays} value={String(draft.trigger.schedule.weekday)} onChange={(weekday) => setDraft({ ...draft, trigger: { ...draft.trigger, schedule: { ...draft.trigger.schedule, weekday: Number(weekday) } } })} placement="bottom" />}
        {draft.trigger.schedule.frequency !== "hourly" && <label className="workflow-field" htmlFor="workflow-hour"><span>時</span><input id="workflow-hour" type="number" min="0" max="23" value={draft.trigger.schedule.hour} onChange={(event) => setDraft({ ...draft, trigger: { ...draft.trigger, schedule: { ...draft.trigger.schedule, hour: Number(event.target.value) } } })} /></label>}
        <label className="workflow-field" htmlFor="workflow-minute"><span>分</span><input id="workflow-minute" type="number" min="0" max="59" value={draft.trigger.schedule.minute} onChange={(event) => setDraft({ ...draft, trigger: { ...draft.trigger, schedule: { ...draft.trigger.schedule, minute: Number(event.target.value) } } })} /></label>
        <label className="workflow-field" htmlFor="workflow-timezone"><span>タイムゾーン</span><input id="workflow-timezone" value={draft.trigger.schedule.timeZone} onChange={(event) => setDraft({ ...draft, trigger: { ...draft.trigger, schedule: { ...draft.trigger.schedule, timeZone: event.target.value } } })} /></label>
      </>}
      {kind === "app-request" && requestPairs.length > 0 && <>
        <ThemedSelect id="workflow-request-pair" label="App接続" options={requestPairs.map((pair, index) => ({ id: String(index), label: `${pair.source.appName} → ${pair.target.appName}`, description: `${pair.source.title} → ${pair.target.title}` }))} value={String(Math.max(0, requestPairs.findIndex((pair) => pair.source.appId === draft.trigger.source.appId && pair.source.id === draft.trigger.source.connectorId && pair.target.appId === draft.trigger.target.appId && pair.target.id === draft.trigger.target.connectorId)))} onChange={(index) => {
          const pair = requestPairs[Number(index)]; setDraft({ ...draft, trigger: { kind: "app-request", source: { appId: pair.source.appId, connectorId: pair.source.id, config: {} }, target: { appId: pair.target.appId, connectorId: pair.target.id, config: {} } }, steps: [] });
        }} placement="bottom" />
        {(() => {
          const pair = requestPairs.find((item) => item.source.appId === draft.trigger.source.appId && item.source.id === draft.trigger.source.connectorId && item.target.appId === draft.trigger.target.appId && item.target.id === draft.trigger.target.connectorId);
          if (!pair) return null;
          return <><ConfigPanel runtime={runtime} endpoint={{ appId: pair.source.appId, connectorId: pair.source.id }} direction="sources" title={pair.source.appName} schema={pair.source.configSchema} value={draft.trigger.source.config ?? {}} onChange={(config) => setDraft({ ...draft, trigger: { ...draft.trigger, source: { ...draft.trigger.source, config } } })} /><ConfigPanel runtime={runtime} endpoint={{ appId: pair.target.appId, connectorId: pair.target.id }} direction="targets" title={pair.target.appName} schema={pair.target.configSchema} value={draft.trigger.target.config ?? {}} onChange={(config) => setDraft({ ...draft, trigger: { ...draft.trigger, target: { ...draft.trigger.target, config } } })} /></>;
        })()}
      </>}
    </div>
  );
}

export function WorkflowView({ runtime, onToast, onScheduleEnabled, backgroundSettings }) {
  const [workflows, setWorkflows] = useState(() => runtime.workflows.list());
  const [selectedId, setSelectedId] = useState(workflows[0]?.id ?? null);
  const [draft, setDraft] = useState(workflows[0] ? structuredClone(workflows[0]) : null);
  const [selectedNode, setSelectedNode] = useState("trigger");
  const [busy, setBusy] = useState(false);
  const [documentData, setDocumentData] = useState({});
  const [documentSnapshot, setDocumentSnapshot] = useState(null);
  const events = useMemo(() => runtime.workflows.listEventTriggers(), [runtime, workflows.length]);
  const requestPairs = useMemo(() => runtime.workflows.listRequestPairs(), [runtime, workflows.length]);
  const actions = useMemo(() => runtime.workflows.listActions(), [runtime, workflows.length]);
  const refresh = () => setWorkflows(runtime.workflows.list());
  useEffect(() => runtime.workflows.subscribe(({ workflows: next }) => {
    setWorkflows(next);
    if (selectedId) runtime.workflows.readDocument(selectedId).then(setDocumentSnapshot).catch(() => {});
  }), [runtime, selectedId]);
  useEffect(() => {
    if (!selectedId) { setDocumentData({}); setDocumentSnapshot(null); return; }
    const selected = workflows.find((item) => item.id === selectedId);
    if (selected) setDraft(structuredClone(selected));
    runtime.workflows.readDocument(selectedId).then((document) => { setDocumentSnapshot(document); setDocumentData(document.data ?? {}); }).catch(() => { setDocumentSnapshot(null); setDocumentData({}); });
  }, [selectedId]);

  const createDraft = () => {
    const event = events[0];
    const eventAction = actions.find((item) => item.inputDataType === event?.dataType);
    const firstAction = eventAction ?? actions.find((item) => !item.inputDataType);
    const trigger = eventAction ? { kind: "event", appId: event.appId, connectorId: event.id } : { kind: "manual" };
    setSelectedId(null); setSelectedNode("trigger"); setDocumentData({}); setDocumentSnapshot(null);
    setDraft({ name: "新しいワークフロー", enabled: true, trigger, steps: firstAction ? [createStep(firstAction)] : [] });
  };
  const save = async () => {
    setBusy(true);
    try {
      const saved = await runtime.workflows.save({ ...draft, documentData });
      const document = await runtime.workflows.readDocument(saved.id);
      setSelectedId(saved.id); setDraft(saved); setDocumentSnapshot(document); setDocumentData(document.data ?? {}); refresh(); onToast("ワークフローを保存しました");
      if (saved.enabled && saved.trigger.kind === "schedule") onScheduleEnabled?.();
    } catch (error) { onToast(`保存できません：${error.message}`); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!draft?.id) { setDraft(null); return; }
    await runtime.workflows.remove(draft.id); const next = runtime.workflows.list(); setWorkflows(next); setSelectedId(next[0]?.id ?? null); setDraft(next[0] ? structuredClone(next[0]) : null); setDocumentData({}); setDocumentSnapshot(null); onToast("ワークフローを削除しました");
  };
  const insert = (index, action) => {
    const steps = [...draft.steps]; steps.splice(index, 0, createStep(action)); setDraft({ ...draft, steps });
  };
  const move = (index, offset) => {
    const steps = [...draft.steps]; const [step] = steps.splice(index, 1); steps.splice(index + offset, 0, step); if (validStepOrder(draft, steps, events, actions)) setDraft({ ...draft, steps });
  };
  const selectedStepIndex = draft?.steps.findIndex((step) => step.id === selectedNode) ?? -1;
  const selectedStep = selectedStepIndex >= 0 ? draft.steps[selectedStepIndex] : null;
  const selectedAction = selectedStep ? stepAction(selectedStep, actions) : null;
  const updateSelectedStep = (nextStep) => {
    const steps = [...draft.steps];
    steps[selectedStepIndex] = nextStep;
    setDraft({ ...draft, steps });
  };
  const visibleDocument = documentSnapshot
    ? { ...documentSnapshot, data: documentData }
    : { version: 1, workflowId: draft?.id ?? "保存後に割り当て", revision: 0, data: documentData, runOrder: [], runs: {} };

  return (
    <section className="workflow-view" aria-labelledby="workflows-heading">
      <aside className="workflow-sidebar">
        <div className="workflow-section-heading"><h1 id="workflows-heading">ワークフロー</h1><IconButton label="ワークフローを追加" onClick={createDraft}><Plus size={19} /></IconButton></div>
        <div className="workflow-list" role="list">{workflows.map((workflow) => <button type="button" role="listitem" key={workflow.id} className={selectedId === workflow.id ? "selected" : ""} aria-current={selectedId === workflow.id ? "true" : undefined} onClick={() => { setSelectedId(workflow.id); setSelectedNode("trigger"); }}><span className={`workflow-status-dot ${workflow.status?.state ?? "idle"}`} /><span><strong>{workflow.name}</strong><small>{workflowStatusLabel(workflow.status?.state ?? "idle")}</small></span></button>)}</div>
      </aside>
      <div className="workflow-canvas">
        {draft ? <>
          <header className="workflow-toolbar">
            <input className="workflow-name" aria-label="ワークフロー名" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            {draft.trigger.kind === "schedule" && <span className="workflow-background-state">{backgroundSettings?.autostart ? "PC起動時も実行" : "MyBox起動中のみ"}</span>}
            {draft.id && ["manual", "schedule"].includes(draft.trigger.kind) && <IconButton label="今すぐ実行" onClick={async () => { await runtime.workflows.run(draft.id); onToast("実行を開始しました"); }}><Play size={18} /></IconButton>}
            <IconButton label="Workflow JSONを表示" aria-pressed={selectedNode === "document"} className={selectedNode === "document" ? "active" : ""} onClick={() => setSelectedNode("document")}><BracketsCurly size={18} /></IconButton>
            <IconButton label={draft.enabled ? "ワークフローを停止" : "ワークフローを有効化"} role="switch" aria-checked={draft.enabled} className={draft.enabled ? "active" : ""} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <Power size={18} weight="fill" /> : <Pause size={18} />}</IconButton>
            <IconButton label="ワークフローを削除" className="text-danger" onClick={remove}><Trash size={18} /></IconButton>
            <button type="button" className="primary-button compact" disabled={busy || !draft.name.trim()} onClick={save}><Check size={18} />{busy ? "保存中…" : "保存"}</button>
          </header>
          <div className="workflow-rail" aria-label="実行順">
            <article className={selectedNode === "trigger" ? "workflow-node selected" : "workflow-node"}><button type="button" onClick={() => setSelectedNode("trigger")} aria-pressed={selectedNode === "trigger"}><span className="workflow-node-icon"><Lightning size={22} /></span><span><small>Trigger</small><strong>{triggerKinds.find((item) => item.id === draft.trigger.kind)?.label}</strong></span></button></article>
            {draft.trigger.kind !== "app-request" && <AddAction index={0} draft={draft} events={events} actions={actions} onInsert={insert} />}
            {draft.steps.map((step, index) => {
              const action = stepAction(step, actions);
              return <div className="workflow-node-group" key={step.id}><article className={selectedNode === step.id ? "workflow-node selected" : "workflow-node"}><button type="button" onClick={() => setSelectedNode(step.id)} aria-pressed={selectedNode === step.id}><span className="workflow-node-icon">{action?.source === "agent-command" ? <TerminalWindow size={22} aria-hidden="true" /> : appIcon(step.appId)}</span><span><small>{action?.appName ?? step.appId}{action?.source === "agent-command" ? " · コマンド" : ""}</small><strong>{action?.title ?? step.actionId}</strong></span></button><div className="workflow-node-actions"><IconButton label="左へ移動" disabled={index === 0 || !validStepOrder(draft, [...draft.steps.slice(0, index - 1), step, draft.steps[index - 1], ...draft.steps.slice(index + 1)], events, actions)} onClick={() => move(index, -1)}><ArrowLeft size={15} /></IconButton><IconButton label="右へ移動" disabled={index === draft.steps.length - 1 || !validStepOrder(draft, [...draft.steps.slice(0, index), draft.steps[index + 1], step, ...draft.steps.slice(index + 2)], events, actions)} onClick={() => move(index, 1)}><ArrowRight size={15} /></IconButton><IconButton label="Actionを削除" className="text-danger" onClick={() => { setDraft({ ...draft, steps: draft.steps.filter((item) => item.id !== step.id) }); setSelectedNode("trigger"); }}><Trash size={15} /></IconButton></div></article><AddAction index={index + 1} draft={draft} events={events} actions={actions} onInsert={insert} /></div>;
            })}
            {draft.trigger.kind === "app-request" && <><FlowArrow size={24} aria-hidden="true" /><article className="workflow-node request-target"><span className="workflow-node-icon">{appIcon(draft.trigger.target.appId)}</span><span><small>Request</small><strong>{runtime.host.getManifest(draft.trigger.target.appId)?.name ?? draft.trigger.target.appId}</strong></span></article></>}
          </div>
        </> : <div className="workflow-empty"><FlowArrow size={34} aria-hidden="true" /><strong>ワークフローを追加</strong><IconButton label="ワークフローを追加" onClick={createDraft}><Plus size={19} /></IconButton></div>}
      </div>
      <aside className="workflow-inspector" aria-label="選択したノードの設定">
        {draft && selectedNode === "trigger" && <><h2>Trigger</h2><TriggerInspector runtime={runtime} draft={draft} setDraft={setDraft} events={events} requestPairs={requestPairs} actions={actions} /></>}
        {draft && selectedNode === "document" && <><h2>Workflow JSON</h2><div className="workflow-document-editor"><JsonField id="workflow-document-data" label="data" kind="object" value={documentData} onChange={setDocumentData} /><pre tabIndex="0" aria-label="Workflow JSON全体">{JSON.stringify(visibleDocument, null, 2)}</pre></div></>}
        {draft && selectedAction && <><h2>{selectedAction.title}</h2><span className="workflow-action-meta">{selectedAction.appName}{selectedAction.source === "agent-command" ? ` · コマンド · ${selectedAction.effect}` : ""}</span><ConfigPanel runtime={runtime} endpoint={{ appId: selectedAction.appId, actionId: selectedAction.id }} schema={selectedAction.configSchema} value={selectedStep.config ?? {}} onChange={(config) => updateSelectedStep({ ...selectedStep, config })} /><MappingPanel step={selectedStep} action={selectedAction} onChange={updateSelectedStep} /></>}
      </aside>
    </section>
  );
}

export function WorkflowHistoryView({ runtime, onToast, targetRunId = null }) {
  const [runs, setRuns] = useState(() => runtime.workflows.listRuns());
  const [expanded, setExpanded] = useState(null);
  const rowRefs = useRef(new Map());
  const actions = runtime.workflows.listActions();
  useEffect(() => runtime.workflows.subscribe(({ runs: next }) => setRuns(next)), [runtime]);
  useEffect(() => {
    if (!targetRunId) return;
    setExpanded(targetRunId);
    requestAnimationFrame(() => {
      const row = rowRefs.current.get(targetRunId);
      row?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      row?.focus({ preventScroll: true });
    });
  }, [runs, targetRunId]);
  return (
    <section className="secondary-view workflow-history-view" aria-labelledby="history-heading">
      <div className="view-title"><ClockCounterClockwise size={24} aria-hidden="true" /><h1 id="history-heading">実行履歴</h1></div>
      <div className="history-list">{runs.length ? runs.map((run) => {
        const workflow = runtime.workflows.get(run.workflowId);
        const pending = run.state === "pending-approval";
        const failed = run.state === "failed";
        const open = expanded === run.id;
        const Icon = run.state === "succeeded" ? Check : pending || failed ? WarningCircle : ArrowsClockwise;
        const step = run.steps?.[run.currentStepIndex] ?? workflow?.steps?.[run.currentStepIndex];
        return <article ref={(node) => { if (node) rowRefs.current.set(run.id, node); else rowRefs.current.delete(run.id); }} tabIndex={-1} aria-current={targetRunId === run.id ? "true" : undefined} className={`history-row workflow-run-row ${run.state}${targetRunId === run.id ? " targeted" : ""}`} key={run.id}>
          <span className="history-icon"><Icon size={18} /></span>
          <strong>{workflow?.name ?? run.workflowId}</strong>
          <span>{workflowStatusLabel(run.state)}{run.error?.message ? ` · ${run.error.message}` : ""}</span>
          <time>{formatTime(run.updatedAt)}</time>
          <div className="workflow-run-actions">
            {(pending || failed) && <IconButton label={pending ? "承認内容を確認" : "停止したRunを再開"} onClick={() => pending ? setExpanded(open ? null : run.id) : runtime.workflows.resume(run.id).catch((error) => onToast(error.message))}>{pending ? <Power size={17} /> : <ArrowsClockwise size={17} />}</IconButton>}
            <IconButton label={open ? "ステップ詳細を閉じる" : "ステップ詳細を表示"} aria-expanded={open} onClick={() => setExpanded(open ? null : run.id)}>{open ? <CaretUp size={17} /> : <CaretDown size={17} />}</IconButton>
          </div>
          {open && <div className="workflow-run-details">
            <ol aria-label="ステップ実行結果">{(run.steps ?? workflow?.steps ?? []).map((runStep, index) => {
              const stepRun = run.stepRuns?.[index];
              const action = actions.find((item) => item.appId === runStep.appId && item.id === runStep.actionId)
                ?? actions.find((item) => item.appId === stepRun?.appId && (item.id === stepRun.actionId || item.operationId === stepRun.operationId));
              const state = stepRun?.state ?? (index < run.currentStepIndex ? "succeeded" : "queued");
              return <li key={runStep.id}><span className={`workflow-step-state ${state}`} aria-label={workflowStatusLabel(state)} /><span><strong>{stepRun?.title ?? action?.title ?? runStep.actionId}</strong><small>{stepRun?.source === "agent-command" || action?.source === "agent-command" ? "コマンド" : action?.appName ?? runStep.appId}</small></span><span>{stepRun?.attempts ? `${stepRun.attempts}回` : "—"}</span><span>{formatDuration(stepRun?.startedAt, stepRun?.completedAt)}</span><span>{stepRun?.error?.message ?? stepRun?.resultSummary ?? workflowStatusLabel(state)}</span></li>;
            })}</ol>
            {pending && <div className="workflow-approval" role="group" aria-label="承認内容"><pre>{JSON.stringify({ trigger: run.trigger, action: step ? { appId: step.appId, actionId: step.actionId, config: step.config } : null }, null, 2)}</pre><button type="button" className="primary-button compact" onClick={async () => { await runtime.workflows.resume(run.id, { approval: { granted: true, fresh: true } }); setExpanded(null); onToast("承認して再開しました"); }}>承認して再開</button></div>}
          </div>}
        </article>;
      }) : <div className="workflow-history-empty"><ClockCounterClockwise size={24} /><span>まだ実行はありません</span></div>}</div>
    </section>
  );
}
