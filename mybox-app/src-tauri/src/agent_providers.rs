use keyring::v1::{Entry, Error as KeyringError};
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tempfile::NamedTempFile;
use zeroize::Zeroizing;

const SETTINGS_VERSION: u32 = 1;
const DEFAULT_PROVIDER_ID: &str = "openai-codex-subscription";
const OPENAI_PROVIDER_ID: &str = "openai-api";
const LOCAL_PROVIDER_ID: &str = "openai-compatible-local";
const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL: &str = "gpt-5.6";
const KEYRING_SERVICE: &str = "MyBox";
const KEYRING_ACCOUNT: &str = "openai-api-key";
const MAX_PROMPT_BYTES: usize = 64 * 1024;
const MAX_SCHEMA_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct ProviderSecretLock(Mutex<()>);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenAiApiConfig {
    model: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalLlmConfig {
    base_url: String,
    model: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderSettingsFile {
    version: u32,
    active_provider_id: String,
    openai_api: OpenAiApiConfig,
    local_llm: Option<LocalLlmConfig>,
}

impl Default for ProviderSettingsFile {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            active_provider_id: DEFAULT_PROVIDER_ID.to_string(),
            openai_api: OpenAiApiConfig {
                model: DEFAULT_OPENAI_MODEL.to_string(),
            },
            local_llm: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiApiStatus {
    configured: bool,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmStatus {
    configured: bool,
    base_url: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettingsView {
    active_provider_id: String,
    openai_api: OpenAiApiStatus,
    local_llm: LocalLlmStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeGenerateRequest {
    prompt: String,
    #[serde(default)]
    response_schema: Option<Value>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    #[serde(default)]
    web_search: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSource {
    title: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGenerateResponse {
    text: String,
    data: Option<Value>,
    sources: Vec<WebSource>,
    web_search_used: bool,
    usage: Option<TokenUsage>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("AI設定ディレクトリを取得できません：{error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("AI設定ディレクトリを作成できません：{error}"))?;
    Ok(directory.join("agent-providers.json"))
}

fn load_settings(app: &AppHandle) -> Result<ProviderSettingsFile, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(ProviderSettingsFile::default());
    }
    let settings: ProviderSettingsFile = serde_json::from_reader(BufReader::new(
        File::open(path).map_err(|error| format!("AI設定を開けません：{error}"))?,
    ))
    .map_err(|error| format!("AI設定を読み込めません：{error}"))?;
    if settings.version != SETTINGS_VERSION {
        return Err("未対応のAI設定バージョンです".to_string());
    }
    validate_model(&settings.openai_api.model)?;
    if let Some(local) = &settings.local_llm {
        validate_local_base_url(&local.base_url)?;
        validate_model(&local.model)?;
    }
    Ok(settings)
}

fn atomic_write_settings(path: &Path, settings: &ProviderSettingsFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "AI設定の保存先が不正です".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("AI設定の保存先を作成できません：{error}"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("AI設定の一時ファイルを作成できません：{error}"))?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer_pretty(&mut writer, settings)
            .map_err(|error| format!("AI設定を保存できません：{error}"))?;
        writer
            .flush()
            .map_err(|error| format!("AI設定の保存を完了できません：{error}"))?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("AI設定の保存を同期できません：{error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("AI設定を置き換えられません：{}", error.error))?;
    Ok(())
}

fn save_settings(app: &AppHandle, settings: &ProviderSettingsFile) -> Result<(), String> {
    atomic_write_settings(&settings_path(app)?, settings)
}

fn api_key_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("OSの資格情報ストアを開けません：{error}"))
}

fn read_api_key() -> Result<Option<Zeroizing<String>>, String> {
    match api_key_entry()?.get_password() {
        Ok(secret) => Ok(Some(Zeroizing::new(secret))),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("OSの資格情報ストアを読めません：{error}")),
    }
}

fn validate_api_key(api_key: &str) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.len() < 20 || trimmed.len() > 512 || trimmed.chars().any(char::is_whitespace) {
        return Err("APIキーの形式を確認してください".to_string());
    }
    Ok(())
}

fn validate_model(model: &str) -> Result<String, String> {
    let trimmed = model.trim();
    if trimmed.is_empty()
        || trimmed.len() > 160
        || !trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/')
        })
    {
        return Err("モデル名の形式を確認してください".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_reasoning_effort(effort: &str) -> Result<String, String> {
    let effort = effort.trim();
    if !matches!(effort, "none" | "low" | "medium" | "high" | "xhigh" | "max") {
        return Err("Thinkingレベルを確認してください".to_string());
    }
    Ok(effort.to_string())
}

fn validate_local_base_url(base_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url.trim())
        .map_err(|_| "ローカルLLMのURLを確認してください".to_string())?;
    if url.scheme() != "http" {
        return Err("ローカルLLMはループバックのhttp URLだけを利用できます".to_string());
    }
    let allowed_host = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
    );
    if !allowed_host
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("ローカルLLMは認証情報を含まないループバックURLにしてください".to_string());
    }
    let path = url.path().trim_end_matches('/');
    let normalized_path = if path.is_empty() { "/v1" } else { path };
    url.set_path(&format!("{normalized_path}/"));
    Ok(url)
}

fn validate_request(request: &NativeGenerateRequest) -> Result<(), String> {
    if request.prompt.trim().is_empty() || request.prompt.len() > MAX_PROMPT_BYTES {
        return Err("AIへの依頼は1文字以上64KB以下にしてください".to_string());
    }
    if let Some(schema) = &request.response_schema {
        let size = serde_json::to_vec(schema)
            .map_err(|error| format!("応答スキーマを確認できません：{error}"))?
            .len();
        if size > MAX_SCHEMA_BYTES {
            return Err("応答スキーマは64KB以下にしてください".to_string());
        }
    }
    if let Some(model) = &request.model {
        validate_model(model)?;
    }
    if let Some(effort) = &request.reasoning_effort {
        validate_reasoning_effort(effort)?;
    }
    Ok(())
}

fn settings_view(settings: ProviderSettingsFile, api_configured: bool) -> ProviderSettingsView {
    let local = settings.local_llm;
    ProviderSettingsView {
        active_provider_id: settings.active_provider_id,
        openai_api: OpenAiApiStatus {
            configured: api_configured,
            model: settings.openai_api.model,
        },
        local_llm: LocalLlmStatus {
            configured: local.is_some(),
            base_url: local.as_ref().map(|value| value.base_url.clone()),
            model: local.map(|value| value.model),
        },
    }
}

fn read_provider_view(app: &AppHandle) -> Result<ProviderSettingsView, String> {
    let settings = load_settings(app)?;
    let api_configured = read_api_key()?.is_some();
    Ok(settings_view(settings, api_configured))
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .user_agent(concat!("MyBox/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("AI接続を準備できません：{error}"))
}

async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("AI応答がサイズ上限を超えました".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("AI応答を読めません：{error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("AI応答がサイズ上限を超えました".to_string());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "AI応答がJSONではありません".to_string())?;
    if !status.is_success() {
        let message = value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("AIプロバイダーが要求を拒否しました");
        return Err(format!(
            "AIプロバイダーエラー（{}）：{}",
            status.as_u16(),
            truncate(message, 600)
        ));
    }
    Ok(value)
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn structured_result(
    text: String,
    schema: &Option<Value>,
    sources: Vec<WebSource>,
    web_search_used: bool,
    usage: Option<TokenUsage>,
) -> Result<NativeGenerateResponse, String> {
    let data = if schema.is_some() {
        Some(
            serde_json::from_str(&text)
                .map_err(|_| "AIの構造化応答がJSONではありません".to_string())?,
        )
    } else {
        None
    };
    Ok(NativeGenerateResponse {
        text,
        data,
        sources,
        web_search_used,
        usage,
    })
}

fn usage_value(value: &Value, primary: &str, fallback: &str) -> u64 {
    value
        .get(primary)
        .or_else(|| value.get(fallback))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn extract_token_usage(value: &Value) -> Option<TokenUsage> {
    let usage = value.get("usage")?;
    let input_tokens = usage_value(usage, "input_tokens", "prompt_tokens");
    let output_tokens = usage_value(usage, "output_tokens", "completion_tokens");
    let cached_input_tokens = usage
        .get("input_tokens_details")
        .and_then(|details| details.get("cached_tokens"))
        .or_else(|| {
            usage
                .get("prompt_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
        })
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let reasoning_output_tokens = usage
        .get("output_tokens_details")
        .and_then(|details| details.get("reasoning_tokens"))
        .or_else(|| {
            usage
                .get("completion_tokens_details")
                .and_then(|details| details.get("reasoning_tokens"))
        })
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage_value(usage, "total_tokens", "total_tokens")
        .max(input_tokens.saturating_add(output_tokens));
    Some(TokenUsage {
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        total_tokens,
    })
}

fn extract_responses_text(value: &Value) -> Result<String, String> {
    value
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .find_map(|content| {
            (content.get("type").and_then(Value::as_str) == Some("output_text"))
                .then(|| content.get("text").and_then(Value::as_str))
                .flatten()
        })
        .map(str::to_string)
        .ok_or_else(|| "OpenAI応答にテキストがありません".to_string())
}

fn push_source(sources: &mut Vec<WebSource>, url: &str, title: Option<&str>) {
    let Ok(parsed) = Url::parse(url) else {
        return;
    };
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return;
    }
    let normalized = parsed.to_string();
    if sources.len() >= 20 || sources.iter().any(|source| source.url == normalized) {
        return;
    }
    let fallback = parsed
        .host_str()
        .unwrap_or("Web")
        .trim_start_matches("www.");
    sources.push(WebSource {
        title: title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(fallback)
            .chars()
            .take(200)
            .collect(),
        url: normalized,
    });
}

fn extract_responses_sources(value: &Value) -> Vec<WebSource> {
    let mut sources = Vec::new();
    for item in value
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(action_sources) = item.pointer("/action/sources").and_then(Value::as_array) {
            for source in action_sources {
                if let Some(url) = source.get("url").and_then(Value::as_str) {
                    push_source(
                        &mut sources,
                        url,
                        source.get("title").and_then(Value::as_str),
                    );
                }
            }
        }
        for content in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            for annotation in content
                .get("annotations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if annotation.get("type").and_then(Value::as_str) == Some("url_citation") {
                    if let Some(url) = annotation.get("url").and_then(Value::as_str) {
                        push_source(
                            &mut sources,
                            url,
                            annotation.get("title").and_then(Value::as_str),
                        );
                    }
                }
            }
        }
    }
    sources
}

fn responses_used_web_search(value: &Value) -> bool {
    value
        .get("output")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items
                .iter()
                .any(|item| item.get("type").and_then(Value::as_str) == Some("web_search_call"))
        })
}

fn extract_chat_text(value: &Value) -> Result<String, String> {
    value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "ローカルLLM応答にテキストがありません".to_string())
}

#[tauri::command]
pub fn agent_provider_settings(
    app: AppHandle,
    secret_lock: State<'_, ProviderSecretLock>,
) -> Result<ProviderSettingsView, String> {
    let _guard = secret_lock
        .0
        .lock()
        .map_err(|_| "資格情報ストアのロックを取得できません".to_string())?;
    read_provider_view(&app)
}

#[tauri::command]
pub fn configure_openai_api_provider(
    app: AppHandle,
    secret_lock: State<'_, ProviderSecretLock>,
    api_key: Option<String>,
    model: String,
) -> Result<ProviderSettingsView, String> {
    let model = validate_model(&model)?;
    let _guard = secret_lock
        .0
        .lock()
        .map_err(|_| "資格情報ストアのロックを取得できません".to_string())?;
    let was_configured = read_api_key()?.is_some();
    if let Some(api_key) = api_key {
        let api_key = Zeroizing::new(api_key);
        validate_api_key(&api_key)?;
        api_key_entry()?
            .set_password(api_key.trim())
            .map_err(|error| format!("APIキーをOSの資格情報ストアへ保存できません：{error}"))?;
    } else if !was_configured {
        return Err("OpenAI APIキーを入力してください".to_string());
    }
    let mut settings = load_settings(&app)?;
    settings.openai_api.model = model;
    settings.active_provider_id = OPENAI_PROVIDER_ID.to_string();
    save_settings(&app, &settings)?;
    Ok(settings_view(settings, true))
}

#[tauri::command]
pub fn disconnect_openai_api_provider(
    app: AppHandle,
    secret_lock: State<'_, ProviderSecretLock>,
) -> Result<ProviderSettingsView, String> {
    let _guard = secret_lock
        .0
        .lock()
        .map_err(|_| "資格情報ストアのロックを取得できません".to_string())?;
    let entry = api_key_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => {}
        Err(error) => return Err(format!("APIキーを削除できません：{error}")),
    }
    let mut settings = load_settings(&app)?;
    if settings.active_provider_id == OPENAI_PROVIDER_ID {
        settings.active_provider_id = DEFAULT_PROVIDER_ID.to_string();
        save_settings(&app, &settings)?;
    }
    Ok(settings_view(settings, false))
}

#[tauri::command]
pub fn configure_local_llm_provider(
    app: AppHandle,
    secret_lock: State<'_, ProviderSecretLock>,
    base_url: String,
    model: String,
) -> Result<ProviderSettingsView, String> {
    let base_url = validate_local_base_url(&base_url)?.to_string();
    let model = validate_model(&model)?;
    let _guard = secret_lock
        .0
        .lock()
        .map_err(|_| "AI設定のロックを取得できません".to_string())?;
    let mut settings = load_settings(&app)?;
    settings.local_llm = Some(LocalLlmConfig { base_url, model });
    settings.active_provider_id = LOCAL_PROVIDER_ID.to_string();
    save_settings(&app, &settings)?;
    Ok(settings_view(settings, read_api_key()?.is_some()))
}

#[tauri::command]
pub fn disconnect_local_llm_provider(
    app: AppHandle,
    secret_lock: State<'_, ProviderSecretLock>,
) -> Result<ProviderSettingsView, String> {
    let _guard = secret_lock
        .0
        .lock()
        .map_err(|_| "AI設定のロックを取得できません".to_string())?;
    let mut settings = load_settings(&app)?;
    settings.local_llm = None;
    if settings.active_provider_id == LOCAL_PROVIDER_ID {
        settings.active_provider_id = DEFAULT_PROVIDER_ID.to_string();
    }
    save_settings(&app, &settings)?;
    Ok(settings_view(settings, read_api_key()?.is_some()))
}

#[tauri::command]
pub fn set_active_agent_provider(
    app: AppHandle,
    secret_lock: State<'_, ProviderSecretLock>,
    provider_id: String,
) -> Result<ProviderSettingsView, String> {
    let _guard = secret_lock
        .0
        .lock()
        .map_err(|_| "AI設定のロックを取得できません".to_string())?;
    let mut settings = load_settings(&app)?;
    let api_configured = read_api_key()?.is_some();
    let available = match provider_id.as_str() {
        DEFAULT_PROVIDER_ID => true,
        OPENAI_PROVIDER_ID => api_configured,
        LOCAL_PROVIDER_ID => settings.local_llm.is_some(),
        _ => false,
    };
    if !available {
        return Err("選択したAIプロバイダーは設定されていません".to_string());
    }
    settings.active_provider_id = provider_id;
    save_settings(&app, &settings)?;
    Ok(settings_view(settings, api_configured))
}

#[tauri::command]
pub async fn openai_api_generate(
    app: AppHandle,
    secret_lock: State<'_, ProviderSecretLock>,
    request: NativeGenerateRequest,
) -> Result<NativeGenerateResponse, String> {
    validate_request(&request)?;
    let (api_key, configured_model) = {
        let _guard = secret_lock
            .0
            .lock()
            .map_err(|_| "資格情報ストアのロックを取得できません".to_string())?;
        let key =
            read_api_key()?.ok_or_else(|| "OpenAI APIキーが設定されていません".to_string())?;
        let model = load_settings(&app)?.openai_api.model;
        (key, model)
    };
    let model = request
        .model
        .as_deref()
        .map(validate_model)
        .transpose()?
        .unwrap_or(configured_model);
    let mut body = json!({
        "model": model,
        "instructions": "Return only the requested answer. Never claim to have used a tool or changed MyBox unless the prompt includes an observed result.",
        "input": request.prompt,
        "store": false
    });
    if let Some(effort) = request.reasoning_effort.as_deref() {
        body["reasoning"] = json!({ "effort": validate_reasoning_effort(effort)? });
    }
    if request.web_search {
        body["tools"] = json!([{ "type": "web_search", "search_context_size": "medium" }]);
        body["tool_choice"] = Value::String("auto".to_string());
        body["include"] = json!(["web_search_call.action.sources"]);
        body["instructions"] = Value::String(
            "Return the requested answer. Use web search when current information is useful, cite web-supported claims, and never claim to have changed MyBox unless the prompt includes an observed result."
                .to_string(),
        );
    }
    if let Some(schema) = request.response_schema.clone() {
        body["text"] = json!({
            "format": {
                "type": "json_schema",
                "name": "mybox_agent_decision",
                "strict": false,
                "schema": schema
            }
        });
    }
    let response = http_client()?
        .post(OPENAI_API_URL)
        .bearer_auth(api_key.as_str())
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("OpenAI APIへ接続できません：{error}"))?;
    let value = response_json(response).await?;
    let sources = extract_responses_sources(&value);
    let web_search_used = responses_used_web_search(&value);
    let usage = extract_token_usage(&value);
    structured_result(
        extract_responses_text(&value)?,
        &request.response_schema,
        sources,
        web_search_used,
        usage,
    )
}

#[tauri::command]
pub async fn local_llm_generate(
    app: AppHandle,
    request: NativeGenerateRequest,
) -> Result<NativeGenerateResponse, String> {
    validate_request(&request)?;
    if request.web_search {
        return Err(
            "Local LLMはWeb検索に対応していません。ChatGPTまたはOpenAI APIを選択してください"
                .to_string(),
        );
    }
    if request.reasoning_effort.is_some() {
        return Err(
            "Local LLMのThinkingレベルは接続先ごとに形式が異なるため、まだ指定できません"
                .to_string(),
        );
    }
    let settings = load_settings(&app)?;
    let local = settings
        .local_llm
        .ok_or_else(|| "ローカルLLMが設定されていません".to_string())?;
    let endpoint = validate_local_base_url(&local.base_url)?
        .join("chat/completions")
        .map_err(|_| "ローカルLLMのURLを作成できません".to_string())?;
    let model = request
        .model
        .as_deref()
        .map(validate_model)
        .transpose()?
        .unwrap_or(local.model);
    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": "Return only the requested answer. Never claim to have used a tool or changed MyBox unless the prompt includes an observed result."},
            {"role": "user", "content": request.prompt}
        ],
        "stream": false
    });
    if let Some(schema) = request.response_schema.clone() {
        body["response_format"] = json!({
            "type": "json_schema",
            "json_schema": {
                "name": "mybox_agent_decision",
                "strict": false,
                "schema": schema
            }
        });
    }
    let response = http_client()?
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("ローカルLLMへ接続できません：{error}"))?;
    let value = response_json(response).await?;
    structured_result(
        extract_chat_text(&value)?,
        &request.response_schema,
        Vec::new(),
        false,
        extract_token_usage(&value),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        extract_chat_text, extract_responses_sources, extract_responses_text, extract_token_usage,
        responses_used_web_search, settings_view, validate_local_base_url, validate_model,
        validate_reasoning_effort, OpenAiApiConfig, ProviderSettingsFile, SETTINGS_VERSION,
    };
    use serde_json::json;

    #[test]
    fn accepts_only_loopback_local_urls() {
        assert!(validate_local_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_local_base_url("http://localhost:1234/v1").is_ok());
        assert!(validate_local_base_url("http://[::1]:8080/v1").is_ok());
        assert!(validate_local_base_url("https://localhost:1234/v1").is_err());
        assert!(validate_local_base_url("http://192.168.1.10:11434/v1").is_err());
        assert!(validate_local_base_url("http://localhost:1234/v1?token=secret").is_err());
    }

    #[test]
    fn extracts_api_token_usage_and_validates_reasoning_effort() {
        let usage = extract_token_usage(&json!({
            "usage": {
                "input_tokens": 120,
                "input_tokens_details": { "cached_tokens": 40 },
                "output_tokens": 30,
                "output_tokens_details": { "reasoning_tokens": 12 },
                "total_tokens": 150
            }
        }))
        .expect("token usage");
        assert_eq!(usage.input_tokens, 120);
        assert_eq!(usage.cached_input_tokens, 40);
        assert_eq!(usage.reasoning_output_tokens, 12);
        assert!(validate_reasoning_effort("max").is_ok());
        assert!(validate_reasoning_effort("unbounded").is_err());
    }

    #[test]
    fn validates_model_names_without_command_syntax() {
        assert_eq!(validate_model("qwen3:8b").unwrap(), "qwen3:8b");
        assert!(validate_model("model name").is_err());
        assert!(validate_model("model; calc.exe").is_err());
    }

    #[test]
    fn extracts_supported_provider_response_shapes() {
        let responses = json!({"output": [
            {"type": "web_search_call", "action": {"sources": [{"url": "https://example.com/news", "title": "Example News"}]}},
            {"type": "message", "content": [{"type": "output_text", "text": "hello", "annotations": [{"type": "url_citation", "url": "https://example.com/news", "title": "Example News"}]}]}
        ]});
        let chat = json!({"choices": [{"message": {"content": "local"}}]});
        assert_eq!(extract_responses_text(&responses).unwrap(), "hello");
        assert!(responses_used_web_search(&responses));
        let sources = extract_responses_sources(&responses);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].title, "Example News");
        assert_eq!(extract_chat_text(&chat).unwrap(), "local");
    }

    #[test]
    fn settings_view_never_contains_a_secret_field() {
        let settings = ProviderSettingsFile {
            version: SETTINGS_VERSION,
            active_provider_id: "openai-api".to_string(),
            openai_api: OpenAiApiConfig {
                model: "gpt-5.6".to_string(),
            },
            local_llm: None,
        };
        let serialized = serde_json::to_value(settings_view(settings, true)).unwrap();
        assert!(serialized.get("apiKey").is_none());
        assert_eq!(
            serialized.pointer("/openaiApi/configured"),
            Some(&json!(true))
        );
    }
}
