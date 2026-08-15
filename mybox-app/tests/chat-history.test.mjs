import test from "node:test";
import assert from "node:assert/strict";
import {
  appendChatMessage,
  buildConversationPrompt,
  createChatHistoryStore,
  createChatSession,
  createEmptyChatHistory,
  deleteChatSession,
  normalizeChatHistory,
  renameChatSession,
  sumSessionTokenUsage,
} from "../src/core/chat-history.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";

const firstTime = "2026-08-15T01:00:00.000Z";
const secondTime = "2026-08-15T01:01:00.000Z";

test("creates, titles, renames, and deletes provider-neutral chat sessions", () => {
  const created = createChatSession(createEmptyChatHistory(), { id: "session-one", now: firstTime });
  const withUser = appendChatMessage(
    created.history,
    created.session.id,
    { role: "user", content: "メモから発表用のスライド構成を作ってください" },
    { id: "message-one", now: secondTime },
  );
  const session = withUser.history.sessions[0];

  assert.equal(session.title, "メモから発表用のスライド構成を作ってください");
  assert.equal(session.messages[0].providerId, null);

  const renamed = renameChatSession(withUser.history, session.id, "発表資料", secondTime);
  assert.equal(renamed.sessions[0].title, "発表資料");
  assert.equal(deleteChatSession(renamed, session.id).sessions.length, 0);
});

test("builds bounded context and excludes failed assistant responses", () => {
  let history = createChatSession(createEmptyChatHistory(), { id: "session-one", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", { role: "user", content: "最初の質問" }, { id: "one", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", { role: "assistant", content: "最初の回答", providerId: "openai-api" }, { id: "two", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", { role: "assistant", content: "接続エラー", status: "error" }, { id: "three", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", { role: "user", content: "続きの質問" }, { id: "four", now: secondTime }).history;

  const prompt = buildConversationPrompt(history.sessions[0], 1000);
  assert.match(prompt, /User: 最初の質問/);
  assert.match(prompt, /Assistant: 最初の回答/);
  assert.match(prompt, /User: 続きの質問/);
  assert.doesNotMatch(prompt, /接続エラー/);

  const oversized = buildConversationPrompt({ messages: [{ role: "user", content: "長".repeat(200), status: "complete" }] }, 80);
  assert.match(oversized, /User: 長+/);
  assert.ok(oversized.split("\n\n").at(-1).length <= 80);
});

test("round-trips normalized chat history through app-scoped storage", async () => {
  const storage = createAppStorage("ai-chat", new MemoryStorageDriver());
  const store = createChatHistoryStore(storage);
  const created = createChatSession(createEmptyChatHistory(), { id: "session-one", now: firstTime });

  await store.save(created.history);
  assert.deepEqual(await store.load(), normalizeChatHistory(created.history));
});

test("keeps safe deduplicated web sources on assistant messages", () => {
  let history = createChatSession(createEmptyChatHistory(), { id: "session-one", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", {
    role: "assistant",
    content: "検索結果です",
    providerId: "openai-api",
    webSearchUsed: true,
    sources: [
      { title: "公式情報", url: "https://example.com/news" },
      { title: "重複", url: "https://example.com/news" },
      { title: "危険", url: "javascript:alert(1)" },
    ],
  }, { id: "source-message", now: secondTime }).history;

  const [message] = history.sessions[0].messages;
  assert.equal(message.webSearchUsed, true);
  assert.deepEqual(message.sources, [{ title: "公式情報", url: "https://example.com/news" }]);
});

test("keeps selected skills and an opaque generated-image reference", () => {
  let history = createChatSession(createEmptyChatHistory(), { id: "session-one", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", {
    role: "user",
    content: "犬のイラストを生成して",
    imageRequested: true,
    skills: [{ id: "system:imagegen", name: "Image generation" }],
  }, { id: "image-request", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", {
    role: "assistant",
    content: "画像を生成しました。",
    providerId: "openai-codex-subscription",
    image: {
      resourceId: "019a4cef-43dd-7001-a012-abcdef123456.png",
      mediaType: "image/png",
      revisedPrompt: "A cheerful puppy",
    },
  }, { id: "image-response", now: secondTime }).history;

  const [request, response] = history.sessions[0].messages;
  assert.equal(request.imageRequested, true);
  assert.deepEqual(request.skills, [{ id: "system:imagegen", name: "Image generation" }]);
  assert.equal(response.image.resourceId, "019a4cef-43dd-7001-a012-abcdef123456.png");

  const unsafe = normalizeChatHistory({
    sessions: [{ ...history.sessions[0], messages: [{ ...response, image: { resourceId: "../secret.png", mediaType: "image/png" } }] }],
  }, secondTime);
  assert.equal(unsafe.sessions[0].messages[0].image, null);
});

test("keeps model metadata and sums validated API token usage", () => {
  let history = createChatSession(createEmptyChatHistory(), { id: "session-one", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", {
    role: "assistant",
    content: "回答です",
    providerId: "openai-api",
    model: "gpt-5.6-terra",
    reasoningEffort: "high",
    tokenUsage: {
      inputTokens: 120,
      cachedInputTokens: 40,
      outputTokens: 30,
      reasoningOutputTokens: 12,
      totalTokens: 150,
    },
  }, { id: "usage-one", now: firstTime }).history;
  history = appendChatMessage(history, "session-one", {
    role: "assistant",
    content: "続きです",
    providerId: "openai-api",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    tokenUsage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
  }, { id: "usage-two", now: secondTime }).history;

  const [first] = history.sessions[0].messages;
  assert.equal(first.model, "gpt-5.6-terra");
  assert.equal(first.reasoningEffort, "high");
  assert.deepEqual(sumSessionTokenUsage(history.sessions[0], "openai-api"), {
    inputTokens: 200,
    cachedInputTokens: 40,
    outputTokens: 50,
    reasoningOutputTokens: 12,
    totalTokens: 250,
  });

  const unsafe = normalizeChatHistory({
    sessions: [{ ...history.sessions[0], messages: [{ ...first, tokenUsage: { totalTokens: -1 }, model: "../bad model" }] }],
  }, secondTime);
  assert.equal(unsafe.sessions[0].messages[0].model, null);
  assert.equal(unsafe.sessions[0].messages[0].tokenUsage, null);
});
