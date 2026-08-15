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
      localExecution: false,
    },
  },
  getStatus: getCodexSubscriptionStatus,
  async generate({ prompt, responseSchema, model, webSearch = false } = {}) {
    if (!isTauri()) throw new Error(unavailableStatus.error);
    return invoke("codex_subscription_generate", {
      request: { prompt, responseSchema, model, webSearch },
    });
  },
});

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
      localExecution: false,
    },
  },
  async getStatus() {
    const settings = await getAgentProviderSettings();
    return { connected: settings.openaiApi.configured, model: settings.openaiApi.model };
  },
  async generate({ prompt, responseSchema, model, webSearch = false } = {}) {
    if (!isTauri()) throw new Error(unavailableStatus.error);
    return invoke("openai_api_generate", {
      request: { prompt, responseSchema, model, webSearch },
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
  async generate({ prompt, responseSchema, model, webSearch = false } = {}) {
    if (!isTauri()) throw new Error(unavailableStatus.error);
    return invoke("local_llm_generate", {
      request: { prompt, responseSchema, model, webSearch },
    });
  },
});

export const nativeAgentProviders = Object.freeze({
  [CODEX_SUBSCRIPTION_PROVIDER_ID]: codexSubscriptionProvider,
  [OPENAI_API_PROVIDER_ID]: openAiApiProvider,
  [LOCAL_LLM_PROVIDER_ID]: localLlmProvider,
});
