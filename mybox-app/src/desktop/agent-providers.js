import { invoke, isTauri } from "@tauri-apps/api/core";
import { defineAgentProvider } from "../core/agent-provider.js";

export const CODEX_SUBSCRIPTION_PROVIDER_ID = "openai-codex-subscription";
export const OPENAI_API_PROVIDER_ID = "openai-api";
export const LOCAL_LLM_PROVIDER_ID = "openai-compatible-local";

const unavailableStatus = Object.freeze({
  available: false,
  connected: false,
  version: null,
  authMode: null,
  planType: null,
  accountEmail: null,
  imageGeneration: false,
  error: "デスクトップ版で利用できます",
});

export async function getCodexSubscriptionStatus() {
  if (!isTauri()) return unavailableStatus;
  return invoke("codex_subscription_status");
}

export async function connectCodexSubscription() {
  if (!isTauri()) throw new Error(unavailableStatus.error);
  return invoke("codex_subscription_login");
}

export async function listCodexSkills() {
  if (!isTauri()) return [];
  return invoke("codex_subscription_skills");
}

export async function listCodexModels() {
  if (!isTauri()) return [];
  return invoke("codex_subscription_models");
}

export async function getCodexSubscriptionUsage() {
  if (!isTauri()) return null;
  return invoke("codex_subscription_usage");
}

export async function readChatImage(resourceId) {
  if (!isTauri()) throw new Error(unavailableStatus.error);
  return invoke("read_chat_image", { resourceId });
}

export async function getAgentProviderSettings() {
  if (!isTauri()) {
    return {
      activeProviderId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      openaiApi: { configured: false, model: "gpt-5.6" },
      localLlm: { configured: false, baseUrl: null, model: null },
    };
  }
  return invoke("agent_provider_settings");
}

export async function configureOpenAiApi({ apiKey, model }) {
  if (!isTauri()) throw new Error(unavailableStatus.error);
  return invoke("configure_openai_api_provider", { apiKey: apiKey || null, model });
}

export async function disconnectOpenAiApi() {
  if (!isTauri()) throw new Error(unavailableStatus.error);
  return invoke("disconnect_openai_api_provider");
}

export async function configureLocalLlm({ baseUrl, model }) {
  if (!isTauri()) throw new Error(unavailableStatus.error);
  return invoke("configure_local_llm_provider", { baseUrl, model });
}

export async function disconnectLocalLlm() {
  if (!isTauri()) throw new Error(unavailableStatus.error);
  return invoke("disconnect_local_llm_provider");
}

export async function selectAgentProvider(providerId) {
  if (!isTauri()) throw new Error(unavailableStatus.error);
  return invoke("set_active_agent_provider", { providerId });
}

export const codexSubscriptionProvider = defineAgentProvider({
  descriptor: {
    id: CODEX_SUBSCRIPTION_PROVIDER_ID,
    name: "ChatGPT",
    kind: "subscription",
    authMode: "chatgpt",
    capabilities: {
      text: true,
      structuredOutput: true,
      streaming: false,
      tools: false,
      webSearch: true,
      skills: true,
      imageGeneration: true,
      localExecution: false,
    },
  },
  getStatus: getCodexSubscriptionStatus,
  listModels: listCodexModels,
  getUsage: getCodexSubscriptionUsage,
  async generate({ prompt, responseSchema, model, reasoningEffort, webSearch = false, imageGeneration = false, skillIds = [] } = {}) {
    if (!isTauri()) throw new Error(unavailableStatus.error);
    return invoke("codex_subscription_generate", {
      request: { prompt, responseSchema, model, reasoningEffort, webSearch, imageGeneration, skillIds },
    });
  },
});

const reasoningEfforts = Object.freeze([
  { id: "none", description: "推論を最小化" },
  { id: "low", description: "速さを優先" },
  { id: "medium", description: "速度と品質のバランス" },
  { id: "high", description: "複雑な依頼を深く検討" },
  { id: "xhigh", description: "品質を優先した高度な推論" },
  { id: "max", description: "最難関タスク向け" },
]);

const openAiApiModels = Object.freeze([
  { id: "gpt-5.6", displayName: "GPT-5.6", description: "フラッグシップ", defaultReasoningEffort: "medium", supportedReasoningEfforts: reasoningEfforts, isDefault: true },
  { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "最高性能", defaultReasoningEffort: "medium", supportedReasoningEfforts: reasoningEfforts, isDefault: false },
  { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", description: "性能とコストのバランス", defaultReasoningEffort: "medium", supportedReasoningEfforts: reasoningEfforts, isDefault: false },
  { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", description: "高速・低コスト", defaultReasoningEffort: "medium", supportedReasoningEfforts: reasoningEfforts, isDefault: false },
]);

export const openAiApiProvider = defineAgentProvider({
  descriptor: {
    id: OPENAI_API_PROVIDER_ID,
    name: "OpenAI API",
    kind: "api",
    authMode: "api-key",
    capabilities: {
      text: true,
      structuredOutput: true,
      streaming: false,
      tools: false,
      webSearch: true,
      skills: false,
      imageGeneration: false,
      localExecution: false,
    },
  },
  async getStatus() {
    const settings = await getAgentProviderSettings();
    return { connected: settings.openaiApi.configured, model: settings.openaiApi.model };
  },
  async listModels() {
    const settings = await getAgentProviderSettings();
    const configured = settings.openaiApi.model;
    return openAiApiModels.some((model) => model.id === configured)
      ? openAiApiModels
      : [{ id: configured, displayName: configured, description: "設定済みモデル", defaultReasoningEffort: "", supportedReasoningEfforts: [], isDefault: true }, ...openAiApiModels.map((model) => ({ ...model, isDefault: false }))];
  },
  async generate({ prompt, responseSchema, model, reasoningEffort, webSearch = false } = {}) {
    if (!isTauri()) throw new Error(unavailableStatus.error);
    return invoke("openai_api_generate", {
      request: { prompt, responseSchema, model, reasoningEffort, webSearch },
    });
  },
});

export const localLlmProvider = defineAgentProvider({
  descriptor: {
    id: LOCAL_LLM_PROVIDER_ID,
    name: "Local LLM",
    kind: "local",
    authMode: "none",
    capabilities: {
      text: true,
      structuredOutput: true,
      streaming: false,
      tools: false,
      webSearch: false,
      skills: false,
      imageGeneration: false,
      localExecution: true,
    },
  },
  async getStatus() {
    const settings = await getAgentProviderSettings();
    return {
      connected: settings.localLlm.configured,
      model: settings.localLlm.model,
      baseUrl: settings.localLlm.baseUrl,
    };
  },
  async listModels() {
    const settings = await getAgentProviderSettings();
    const model = settings.localLlm.model;
    return model ? [{ id: model, displayName: model, description: "接続先で設定したモデル", defaultReasoningEffort: "", supportedReasoningEfforts: [], isDefault: true }] : [];
  },
  async generate({ prompt, responseSchema, model, reasoningEffort, webSearch = false } = {}) {
    if (!isTauri()) throw new Error(unavailableStatus.error);
    return invoke("local_llm_generate", {
      request: { prompt, responseSchema, model, reasoningEffort, webSearch },
    });
  },
});

export const nativeAgentProviders = Object.freeze({
  [CODEX_SUBSCRIPTION_PROVIDER_ID]: codexSubscriptionProvider,
  [OPENAI_API_PROVIDER_ID]: openAiApiProvider,
  [LOCAL_LLM_PROVIDER_ID]: localLlmProvider,
});
