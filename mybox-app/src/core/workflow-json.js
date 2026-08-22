const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const WORKFLOW_DOCUMENT_VERSION = 1;
export const WORKFLOW_DOCUMENT_RUN_LIMIT = 50;
export const WORKFLOW_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;

export class WorkflowJsonError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkflowJsonError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function assertSafeKey(value, path) {
  if (!value || FORBIDDEN_KEYS.has(value)) {
    throw new WorkflowJsonError("INVALID_WORKFLOW_JSON_PATH", "JSONパスに使用できない項目です", { path, key: value });
  }
}

export function parseWorkflowJsonPath(path, { writable = false } = {}) {
  if (typeof path !== "string" || path[0] !== "$") {
    throw new WorkflowJsonError("INVALID_WORKFLOW_JSON_PATH", "JSONパスは $ から始めてください", { path });
  }
  if (path === "$") return [];
  const tokens = [];
  let cursor = 1;
  while (cursor < path.length) {
    if (path[cursor] === ".") {
      const start = ++cursor;
      while (cursor < path.length && path[cursor] !== "." && path[cursor] !== "[") cursor += 1;
      const key = path.slice(start, cursor);
      assertSafeKey(key, path);
      tokens.push({ type: "property", key });
      continue;
    }
    if (path[cursor] === "[") {
      const end = path.indexOf("]", cursor + 1);
      if (end < 0) throw new WorkflowJsonError("INVALID_WORKFLOW_JSON_PATH", "JSONパスの ] がありません", { path });
      const value = path.slice(cursor + 1, end);
      if (value === "*") {
        if (writable) throw new WorkflowJsonError("INVALID_WORKFLOW_JSON_PATH", "出力先に [*] は使用できません", { path });
        tokens.push({ type: "wildcard" });
      } else if (/^(0|[1-9]\d*)$/.test(value)) {
        tokens.push({ type: "index", index: Number(value) });
      } else {
        throw new WorkflowJsonError("INVALID_WORKFLOW_JSON_PATH", "配列は [0] または [*] で指定してください", { path });
      }
      cursor = end + 1;
      continue;
    }
    throw new WorkflowJsonError("INVALID_WORKFLOW_JSON_PATH", "JSONパスの形式が正しくありません", { path, cursor });
  }
  return tokens;
}

function readTokens(value, tokens, index, path) {
  if (index >= tokens.length) return clone(value);
  const token = tokens[index];
  if (token.type === "wildcard") {
    if (!Array.isArray(value)) throw new WorkflowJsonError("WORKFLOW_JSON_PATH_NOT_FOUND", "JSONパスの配列が見つかりません", { path });
    return value.flatMap((entry) => {
      const result = readTokens(entry, tokens, index + 1, path);
      return tokens.slice(index + 1).some((item) => item.type === "wildcard") && Array.isArray(result) ? result : [result];
    });
  }
  const key = token.type === "property" ? token.key : token.index;
  if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
    throw new WorkflowJsonError("WORKFLOW_JSON_PATH_NOT_FOUND", `JSON項目 ${path} が見つかりません`, { path });
  }
  return readTokens(value[key], tokens, index + 1, path);
}

export function readWorkflowJsonPath(value, path) {
  return readTokens(value, parseWorkflowJsonPath(path), 0, path);
}

export function writeWorkflowJsonPath(value, path, nextValue, { requireDataRoot = false } = {}) {
  const tokens = parseWorkflowJsonPath(path, { writable: true });
  if (requireDataRoot && (tokens[0]?.type !== "property" || tokens[0].key !== "data")) {
    throw new WorkflowJsonError("INVALID_WORKFLOW_JSON_DESTINATION", "出力先は $.data から始めてください", { path });
  }
  if (!tokens.length) return clone(nextValue);
  const root = value && typeof value === "object" ? value : tokens[0].type === "index" ? [] : {};
  let target = root;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const key = token.type === "property" ? token.key : token.index;
    if (index === tokens.length - 1) {
      target[key] = clone(nextValue);
      break;
    }
    const nextToken = tokens[index + 1];
    const expectedArray = nextToken.type === "index";
    if (target[key] === null || typeof target[key] !== "object" || (expectedArray && !Array.isArray(target[key]))) {
      target[key] = expectedArray ? [] : {};
    }
    target = target[key];
  }
  return root;
}

export function applyWorkflowInputMappings(staticInput, mappings, document) {
  let input = clone(staticInput ?? {});
  for (const mapping of mappings ?? []) {
    if (!mapping?.from || !mapping?.to) continue;
    input = writeWorkflowJsonPath(input, mapping.to, readWorkflowJsonPath(document, mapping.from));
  }
  return input;
}

export function applyWorkflowOutputMappings(document, output, mappings) {
  let next = document;
  for (const mapping of mappings ?? []) {
    if (!mapping?.from || !mapping?.to) continue;
    next = writeWorkflowJsonPath(next, mapping.to, readWorkflowJsonPath(output, mapping.from), { requireDataRoot: true });
  }
  return next;
}

export function createWorkflowDocument(workflowId, at, data = {}) {
  return {
    version: WORKFLOW_DOCUMENT_VERSION,
    workflowId,
    revision: 0,
    updatedAt: at,
    data: clone(data && typeof data === "object" && !Array.isArray(data) ? data : {}),
    runOrder: [],
    runs: {},
  };
}

export function beginWorkflowDocumentRun(document, run, at) {
  const next = clone(document);
  if (!next.runs[run.id]) {
    next.runOrder.push(run.id);
    next.runs[run.id] = {
      trigger: clone(run.trigger),
      state: "running",
      startedAt: run.startedAt ?? at,
      completedAt: null,
      steps: {},
    };
  } else {
    next.runs[run.id].state = "running";
  }
  next.updatedAt = at;
  return next;
}

export function recordWorkflowDocumentStep(document, runId, stepId, patch, at) {
  const next = clone(document);
  if (!runId || !next.runs[runId]) throw new WorkflowJsonError("WORKFLOW_DOCUMENT_RUN_MISSING", "Workflow JSONにRunがありません");
  next.runs[runId].steps[stepId] = { ...(next.runs[runId].steps[stepId] ?? {}), ...clone(patch) };
  next.updatedAt = at;
  return next;
}

export function finishWorkflowDocumentRun(document, runId, state, at, error = null) {
  const next = clone(document);
  if (next.runs[runId]) {
    next.runs[runId].state = state;
    next.runs[runId].completedAt = ["succeeded", "failed", "stopped"].includes(state) ? at : null;
    next.runs[runId].error = error ? clone(error) : null;
  }
  next.updatedAt = at;
  return next;
}

export function prepareWorkflowDocumentForStorage(document, currentRunId = null) {
  const next = clone(document);
  next.revision = Number(next.revision ?? 0) + 1;
  while (next.runOrder.length > WORKFLOW_DOCUMENT_RUN_LIMIT) {
    const removed = next.runOrder.shift();
    delete next.runs[removed];
  }
  let serialized = JSON.stringify(next);
  while (new TextEncoder().encode(serialized).byteLength > WORKFLOW_DOCUMENT_MAX_BYTES && next.runOrder.length > 1) {
    const removableIndex = next.runOrder.findIndex((runId) => runId !== currentRunId);
    if (removableIndex < 0) break;
    const [removed] = next.runOrder.splice(removableIndex, 1);
    delete next.runs[removed];
    serialized = JSON.stringify(next);
  }
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > WORKFLOW_DOCUMENT_MAX_BYTES) {
    throw new WorkflowJsonError("WORKFLOW_DOCUMENT_TOO_LARGE", "Workflow JSONが4 MBを超えました", { bytes, maxBytes: WORKFLOW_DOCUMENT_MAX_BYTES });
  }
  return next;
}

export function workflowSchemaPaths(schema, { includeContainers = false, maxDepth = 4 } = {}) {
  const paths = [];
  const visit = (node, path, depth) => {
    if (!node || depth > maxDepth) return;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (includeContainers || (!types.includes("object") && !types.includes("array"))) paths.push(path);
    if (types.includes("object")) {
      for (const [key, child] of Object.entries(node.properties ?? {})) visit(child, `${path}.${key}`, depth + 1);
    }
    if (types.includes("array") && node.items) visit(node.items, `${path}[*]`, depth + 1);
  };
  visit(schema, "$", 0);
  return [...new Set(paths)];
}
