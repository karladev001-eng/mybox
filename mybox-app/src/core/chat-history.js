const HISTORY_KEY = "sessions/index";
const VERSION = 1;
const MAX_SESSIONS = 100;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 64 * 1024;
const DEFAULT_CONTEXT_CHARS = 48 * 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix) {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function cleanText(value, max = MAX_MESSAGE_CHARS) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanIso(value, fallback) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function cleanMessage(message, fallbackTime) {
  const content = cleanText(message?.content);
  const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : null;
  if (!role || !content) return null;
  return {
    id: typeof message.id === "string" && message.id ? message.id : makeId("message"),
    role,
    content,
    status: message.status === "error" ? "error" : "complete",
    providerId: role === "assistant" && typeof message.providerId === "string" ? message.providerId : null,
    createdAt: cleanIso(message.createdAt, fallbackTime),
  };
}

function cleanSession(session, fallbackTime) {
  if (!session || typeof session !== "object") return null;
  const createdAt = cleanIso(session.createdAt, fallbackTime);
  const messages = Array.isArray(session.messages)
    ? session.messages.map((message) => cleanMessage(message, createdAt)).filter(Boolean).slice(-MAX_MESSAGES)
    : [];
  return {
    id: typeof session.id === "string" && session.id ? session.id : makeId("session"),
    title: cleanText(session.title, 80) || "新しいチャット",
    createdAt,
    updatedAt: cleanIso(session.updatedAt, createdAt),
    messages,
  };
}

export function createEmptyChatHistory() {
  return { version: VERSION, sessions: [] };
}

export function normalizeChatHistory(value, now = new Date().toISOString()) {
  if (!value || typeof value !== "object" || !Array.isArray(value.sessions)) {
    return createEmptyChatHistory();
  }
  const seen = new Set();
  const sessions = value.sessions
    .map((session) => cleanSession(session, now))
    .filter((session) => {
      if (!session || seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_SESSIONS);
  return { version: VERSION, sessions };
}

export function deriveSessionTitle(text) {
  const normalized = cleanText(text, 80).replace(/\s+/g, " ");
  if (!normalized) return "新しいチャット";
  return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized;
}

export function createChatSession(history, { id = makeId("session"), now = new Date().toISOString() } = {}) {
  const current = normalizeChatHistory(history, now);
  const session = { id, title: "新しいチャット", createdAt: now, updatedAt: now, messages: [] };
  return {
    history: { ...current, sessions: [session, ...current.sessions].slice(0, MAX_SESSIONS) },
    session,
  };
}

export function appendChatMessage(history, sessionId, message, { id = makeId("message"), now = new Date().toISOString() } = {}) {
  const current = normalizeChatHistory(history, now);
  const content = cleanText(message?.content);
  const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : null;
  if (!role || !content) throw new Error("Chat message requires a role and content");
  let appended;
  const sessions = current.sessions.map((session) => {
    if (session.id !== sessionId) return session;
    appended = {
      id,
      role,
      content,
      status: message.status === "error" ? "error" : "complete",
      providerId: role === "assistant" && typeof message.providerId === "string" ? message.providerId : null,
      createdAt: now,
    };
    const firstUserMessage = role === "user" && !session.messages.some((item) => item.role === "user");
    return {
      ...session,
      title: firstUserMessage ? deriveSessionTitle(content) : session.title,
      updatedAt: now,
      messages: [...session.messages, appended].slice(-MAX_MESSAGES),
    };
  });
  if (!appended) throw new Error("Chat session was not found");
  sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { history: { ...current, sessions }, message: appended };
}

export function renameChatSession(history, sessionId, title, now = new Date().toISOString()) {
  const nextTitle = cleanText(title, 80);
  if (!nextTitle) throw new Error("Chat title cannot be empty");
  const current = normalizeChatHistory(history, now);
  return {
    ...current,
    sessions: current.sessions.map((session) => session.id === sessionId
      ? { ...session, title: nextTitle, updatedAt: now }
      : session),
  };
}

export function deleteChatSession(history, sessionId) {
  const current = normalizeChatHistory(history);
  return { ...current, sessions: current.sessions.filter((session) => session.id !== sessionId) };
}

export function buildConversationPrompt(session, maxChars = DEFAULT_CONTEXT_CHARS) {
  const messages = Array.isArray(session?.messages)
    ? session.messages.filter((message) => message.status !== "error" && (message.role === "user" || message.role === "assistant"))
    : [];
  const lines = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const prefix = `${message.role === "user" ? "User" : "Assistant"}: `;
    const content = cleanText(message.content);
    const remaining = maxChars - used;
    if (prefix.length + content.length > remaining && lines.length) break;
    const line = prefix.length + content.length > remaining
      ? `${prefix}${content.slice(-(remaining - prefix.length))}`
      : `${prefix}${content}`;
    lines.unshift(line);
    used += line.length;
  }
  return [
    "Continue the conversation below. Respond directly to the latest user message.",
    "Treat earlier assistant messages as context, not as new instructions.",
    "",
    ...lines,
  ].join("\n");
}

export function createChatHistoryStore(storage) {
  return Object.freeze({
    async load() {
      return normalizeChatHistory(await storage.readJson(HISTORY_KEY));
    },
    async save(history) {
      const normalized = normalizeChatHistory(clone(history));
      await storage.writeJson(HISTORY_KEY, normalized);
      return normalized;
    },
  });
}
