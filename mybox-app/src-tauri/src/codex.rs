use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::AppHandle;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

const SHORT_TIMEOUT: Duration = Duration::from_secs(12);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const GENERATION_TIMEOUT: Duration = Duration::from_secs(240);
const MAX_PROMPT_BYTES: usize = 64 * 1024;
const MAX_SKILLS_PER_TURN: usize = 4;
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug)]
enum CodexLauncher {
    Direct(PathBuf),
    #[cfg(windows)]
    CommandShim(PathBuf),
}

impl CodexLauncher {
    fn command(&self, args: &[&str]) -> Command {
        let mut command = match self {
            Self::Direct(path) => {
                let mut command = Command::new(path);
                command.args(args);
                command
            }
            #[cfg(windows)]
            Self::CommandShim(path) => {
                let mut command = Command::new("cmd.exe");
                // `Command::args` applies Windows argument quoting that cmd.exe
                // interprets literally around a .cmd path. Supply cmd.exe's raw
                // command line and use CALL so stdin/stdout remain attached to
                // the long-lived App Server process.
                let command_line = format!(
                    "/D /S /C \"call \"{}\" {}\"",
                    path.display(),
                    args.join(" ")
                );
                command.as_std_mut().raw_arg(command_line);
                command
            }
        };
        #[cfg(windows)]
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        command
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSubscriptionStatus {
    available: bool,
    connected: bool,
    version: Option<String>,
    auth_mode: Option<String>,
    plan_type: Option<String>,
    image_generation: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexGenerateRequest {
    prompt: String,
    #[serde(default)]
    response_schema: Option<Value>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    #[serde(default)]
    web_search: bool,
    #[serde(default)]
    image_generation: bool,
    #[serde(default)]
    skill_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkill {
    id: String,
    name: String,
    display_name: String,
    description: String,
    scope: String,
    requires_tools: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexReasoningEffort {
    id: String,
    description: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    id: String,
    display_name: String,
    description: String,
    default_reasoning_effort: String,
    supported_reasoning_efforts: Vec<CodexReasoningEffort>,
    is_default: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    used_percent: u8,
    remaining_percent: u8,
    window_duration_mins: Option<u64>,
    resets_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUsage {
    primary: Option<QuotaWindow>,
    secondary: Option<QuotaWindow>,
}

#[derive(Clone, Debug)]
struct ResolvedSkill {
    public: CodexSkill,
    path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSource {
    title: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexGenerateResponse {
    text: String,
    data: Option<Value>,
    sources: Vec<WebSource>,
    web_search_used: bool,
    image: Option<GeneratedImageResource>,
    #[serde(skip)]
    image_data: Option<GeneratedImageData>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageResource {
    resource_id: String,
    media_type: String,
    revised_prompt: Option<String>,
}

#[derive(Clone, Debug)]
struct GeneratedImageData {
    bytes: Vec<u8>,
    media_type: String,
    extension: String,
    revised_prompt: Option<String>,
}

#[derive(Default, Debug)]
struct AccountState {
    auth_mode: Option<String>,
    plan_type: Option<String>,
}

#[derive(Default)]
struct ProviderCapabilities {
    image_generation: bool,
}

struct AppServer {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}

impl AppServer {
    async fn start(launcher: &CodexLauncher) -> Result<Self, String> {
        let mut command = launcher.command(&["app-server", "--stdio"]);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Codex App Serverを起動できません：{error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codexの入力を開けません".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codexの出力を開けません".to_string())?;
        let mut server = Self {
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
        };
        server
            .send(&json!({
                "method": "initialize",
                "id": 0,
                "params": {
                    "clientInfo": {
                        "name": "mybox",
                        "title": "MyBox",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }
            }))
            .await?;
        server.response(0, SHORT_TIMEOUT).await?;
        server
            .send(&json!({ "method": "initialized", "params": {} }))
            .await?;
        Ok(server)
    }

    async fn send(&mut self, message: &Value) -> Result<(), String> {
        let mut encoded = serde_json::to_vec(message)
            .map_err(|error| format!("Codex要求を作成できません：{error}"))?;
        encoded.push(b'\n');
        self.stdin
            .write_all(&encoded)
            .await
            .map_err(|error| format!("Codexへ送信できません：{error}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|error| format!("Codexへ送信できません：{error}"))
    }

    async fn next_message(&mut self) -> Result<Value, String> {
        let line = self
            .lines
            .next_line()
            .await
            .map_err(|error| format!("Codex応答を読めません：{error}"))?;
        let line = line.ok_or_else(|| "Codex App Serverが応答を終了しました".to_string())?;
        serde_json::from_str(&line).map_err(|error| format!("Codex応答を解釈できません：{error}"))
    }

    async fn response(&mut self, id: i64, duration: Duration) -> Result<Value, String> {
        timeout(duration, async {
            loop {
                let message = self.next_message().await?;
                if message.get("id").and_then(Value::as_i64) == Some(id) {
                    if let Some(error) = message.get("error") {
                        return Err(rpc_error(error));
                    }
                    return message
                        .get("result")
                        .cloned()
                        .ok_or_else(|| "Codex応答にresultがありません".to_string());
                }
            }
        })
        .await
        .map_err(|_| "Codexの応答がタイムアウトしました".to_string())?
    }

    async fn stop(mut self) {
        let _ = self.child.kill().await;
    }
}

fn rpc_error(error: &Value) -> String {
    error
        .get("message")
        .and_then(Value::as_str)
        .map(|message| format!("Codexエラー：{message}"))
        .unwrap_or_else(|| "Codexが要求を拒否しました".to_string())
}

fn find_codex() -> Option<CodexLauncher> {
    let path = env::var_os("PATH")?;
    let directories: Vec<_> = env::split_paths(&path).collect();

    find_codex_in(&directories)
}

fn find_codex_in(directories: &[PathBuf]) -> Option<CodexLauncher> {
    #[cfg(windows)]
    {
        // Respect PATH precedence. Searching every `codex.exe` before every
        // `codex.cmd` can incorrectly select a later IDE-bundled alpha binary
        // instead of the user's earlier, authenticated npm installation.
        for directory in directories {
            let candidate = directory.join("codex.exe");
            if candidate.is_file() {
                return Some(CodexLauncher::Direct(candidate));
            }
            let candidate = directory.join("codex.cmd");
            if candidate.is_file() {
                return Some(CodexLauncher::CommandShim(candidate));
            }
        }
    }

    #[cfg(not(windows))]
    for directory in directories {
        let candidate = directory.join("codex");
        if candidate.is_file() {
            return Some(CodexLauncher::Direct(candidate));
        }
    }

    None
}

async fn codex_version(launcher: &CodexLauncher) -> Option<String> {
    let mut command = launcher.command(&["--version"]);
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = timeout(SHORT_TIMEOUT, command.output()).await.ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then_some(version)
}

fn parse_account(result: &Value) -> AccountState {
    let account = result.get("account").filter(|value| !value.is_null());
    AccountState {
        auth_mode: account
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            .map(str::to_string),
        plan_type: account
            .and_then(|value| value.get("planType"))
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

async fn read_account(server: &mut AppServer) -> Result<AccountState, String> {
    server
        .send(&json!({
            "method": "account/read",
            "id": 1,
            "params": { "refreshToken": false }
        }))
        .await?;
    let result = server.response(1, SHORT_TIMEOUT).await?;
    Ok(parse_account(&result))
}

async fn read_provider_capabilities(server: &mut AppServer) -> ProviderCapabilities {
    if server
        .send(&json!({
            "method": "modelProvider/capabilities/read",
            "id": 2,
            "params": {}
        }))
        .await
        .is_err()
    {
        return ProviderCapabilities::default();
    }
    match server.response(2, SHORT_TIMEOUT).await {
        Ok(result) => ProviderCapabilities {
            image_generation: result
                .get("imageGeneration")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        },
        Err(_) => ProviderCapabilities::default(),
    }
}

fn is_valid_model_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
}

fn is_valid_reasoning_effort(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 24
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn parse_models(result: &Value) -> Vec<CodexModel> {
    result
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            if entry
                .get("hidden")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return None;
            }
            let id = entry
                .get("id")
                .or_else(|| entry.get("model"))
                .and_then(Value::as_str)?;
            if !is_valid_model_id(id) {
                return None;
            }
            let efforts = entry
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|option| {
                    let id = option.get("reasoningEffort").and_then(Value::as_str)?;
                    is_valid_reasoning_effort(id).then(|| CodexReasoningEffort {
                        id: id.to_string(),
                        description: option
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .chars()
                            .take(240)
                            .collect(),
                    })
                })
                .collect::<Vec<_>>();
            let default_effort = entry
                .get("defaultReasoningEffort")
                .and_then(Value::as_str)
                .filter(|value| efforts.iter().any(|effort| effort.id == *value))
                .or_else(|| efforts.first().map(|effort| effort.id.as_str()))
                .unwrap_or("")
                .to_string();
            Some(CodexModel {
                id: id.to_string(),
                display_name: entry
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .chars()
                    .take(120)
                    .collect(),
                description: entry
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .chars()
                    .take(320)
                    .collect(),
                default_reasoning_effort: default_effort,
                supported_reasoning_efforts: efforts,
                is_default: entry
                    .get("isDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

async fn list_models_for(
    server: &mut AppServer,
    request_id: i64,
) -> Result<Vec<CodexModel>, String> {
    server
        .send(&json!({
            "method": "model/list",
            "id": request_id,
            "params": { "limit": 100, "includeHidden": false }
        }))
        .await?;
    let models = parse_models(&server.response(request_id, SHORT_TIMEOUT).await?);
    if models.is_empty() {
        return Err("Codexが利用可能なモデルを返しませんでした".to_string());
    }
    Ok(models)
}

fn parse_quota_window(value: Option<&Value>) -> Option<QuotaWindow> {
    let value = value?;
    let used = value.get("usedPercent")?.as_u64()?.min(100) as u8;
    Some(QuotaWindow {
        used_percent: used,
        remaining_percent: 100 - used,
        window_duration_mins: value.get("windowDurationMins").and_then(Value::as_u64),
        resets_at: value.get("resetsAt").and_then(Value::as_i64),
    })
}

fn parse_subscription_usage(result: &Value) -> SubscriptionUsage {
    let limits = result.get("rateLimits");
    SubscriptionUsage {
        primary: parse_quota_window(limits.and_then(|value| value.get("primary"))),
        secondary: parse_quota_window(limits.and_then(|value| value.get("secondary"))),
    }
}

async fn read_subscription_usage_for(
    server: &mut AppServer,
    request_id: i64,
) -> Result<SubscriptionUsage, String> {
    server
        .send(&json!({
            "method": "account/rateLimits/read",
            "id": request_id,
            "params": {}
        }))
        .await?;
    Ok(parse_subscription_usage(
        &server.response(request_id, SHORT_TIMEOUT).await?,
    ))
}

async fn status_for(launcher: CodexLauncher) -> CodexSubscriptionStatus {
    let version = codex_version(&launcher).await;
    let account = match AppServer::start(&launcher).await {
        Ok(mut server) => {
            let result = read_account(&mut server).await;
            let capabilities = if result
                .as_ref()
                .ok()
                .and_then(|account| account.auth_mode.as_deref())
                == Some("chatgpt")
            {
                read_provider_capabilities(&mut server).await
            } else {
                ProviderCapabilities::default()
            };
            server.stop().await;
            result.map(|account| (account, capabilities))
        }
        Err(error) => Err(error),
    };

    match account {
        Ok((account, capabilities)) => CodexSubscriptionStatus {
            available: true,
            connected: account.auth_mode.as_deref() == Some("chatgpt"),
            version,
            auth_mode: account.auth_mode,
            plan_type: account.plan_type,
            image_generation: capabilities.image_generation,
            error: None,
        },
        Err(error) => CodexSubscriptionStatus {
            available: true,
            connected: false,
            version,
            auth_mode: None,
            plan_type: None,
            image_generation: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn codex_subscription_status() -> CodexSubscriptionStatus {
    match find_codex() {
        Some(launcher) => status_for(launcher).await,
        None => CodexSubscriptionStatus {
            available: false,
            connected: false,
            version: None,
            auth_mode: None,
            plan_type: None,
            image_generation: false,
            error: Some("Codex CLIが見つかりません".to_string()),
        },
    }
}

#[tauri::command]
pub async fn codex_subscription_login() -> Result<CodexSubscriptionStatus, String> {
    let launcher = find_codex().ok_or_else(|| "Codex CLIをインストールしてください".to_string())?;
    let current = status_for(launcher.clone()).await;
    if current.connected {
        return Ok(current);
    }

    let mut command = launcher.command(&["login"]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let status = timeout(LOGIN_TIMEOUT, command.status())
        .await
        .map_err(|_| "ChatGPT認証がタイムアウトしました".to_string())?
        .map_err(|error| format!("ChatGPT認証を開始できません：{error}"))?;
    if !status.success() {
        return Err("ChatGPT認証を完了できませんでした".to_string());
    }

    let connected = status_for(launcher).await;
    if !connected.connected {
        return Err("CodexはChatGPTサブスクリプションで接続されていません".to_string());
    }
    Ok(connected)
}

fn skill_id(scope: &str, name: &str) -> String {
    format!("{scope}:{name}")
}

fn parse_skills(result: &Value) -> Vec<ResolvedSkill> {
    result
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            entry
                .get("skills")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|skill| {
            if !skill
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return None;
            }
            let name = skill.get("name")?.as_str()?.to_string();
            let path = skill.get("path")?.as_str()?.to_string();
            let scope = skill.get("scope")?.as_str()?.to_string();
            let interface = skill.get("interface");
            let display_name = interface
                .and_then(|value| value.get("displayName"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&name)
                .to_string();
            let description = interface
                .and_then(|value| value.get("shortDescription"))
                .and_then(Value::as_str)
                .or_else(|| skill.get("shortDescription").and_then(Value::as_str))
                .or_else(|| skill.get("description").and_then(Value::as_str))
                .unwrap_or("")
                .chars()
                .take(500)
                .collect();
            let requires_tools = skill
                .pointer("/dependencies/tools")
                .and_then(Value::as_array)
                .is_some_and(|tools| !tools.is_empty());
            Some(ResolvedSkill {
                public: CodexSkill {
                    id: skill_id(&scope, &name),
                    name,
                    display_name,
                    description,
                    scope,
                    requires_tools,
                },
                path,
            })
        })
        .collect()
}

async fn list_skills_for(
    server: &mut AppServer,
    cwd: &Path,
    request_id: i64,
) -> Result<Vec<ResolvedSkill>, String> {
    server
        .send(&json!({
            "method": "skills/list",
            "id": request_id,
            "params": {
                "cwds": [cwd.to_string_lossy()],
                "forceReload": false
            }
        }))
        .await?;
    Ok(parse_skills(
        &server.response(request_id, SHORT_TIMEOUT).await?,
    ))
}

#[tauri::command]
pub async fn codex_subscription_skills() -> Result<Vec<CodexSkill>, String> {
    let launcher = find_codex().ok_or_else(|| "Codex CLIをインストールしてください".to_string())?;
    let isolated = tempfile::tempdir()
        .map_err(|error| format!("スキル用の一時領域を作成できません：{error}"))?;
    let mut server = AppServer::start(&launcher).await?;
    let account = read_account(&mut server).await?;
    if account.auth_mode.as_deref() != Some("chatgpt") {
        server.stop().await;
        return Err("ChatGPTサブスクリプションでCodexに接続してください".to_string());
    }
    let result = list_skills_for(&mut server, isolated.path(), 2).await;
    server.stop().await;
    let mut skills: Vec<_> = result?.into_iter().map(|skill| skill.public).collect();
    skills.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    Ok(skills)
}

#[tauri::command]
pub async fn codex_subscription_models() -> Result<Vec<CodexModel>, String> {
    let launcher = find_codex().ok_or_else(|| "Codex CLIをインストールしてください".to_string())?;
    let mut server = AppServer::start(&launcher).await?;
    let account = read_account(&mut server).await?;
    if account.auth_mode.as_deref() != Some("chatgpt") {
        server.stop().await;
        return Err("ChatGPTサブスクリプションでCodexに接続してください".to_string());
    }
    let result = list_models_for(&mut server, 2).await;
    server.stop().await;
    result
}

#[tauri::command]
pub async fn codex_subscription_usage() -> Result<SubscriptionUsage, String> {
    let launcher = find_codex().ok_or_else(|| "Codex CLIをインストールしてください".to_string())?;
    let mut server = AppServer::start(&launcher).await?;
    let account = read_account(&mut server).await?;
    if account.auth_mode.as_deref() != Some("chatgpt") {
        server.stop().await;
        return Err("ChatGPTサブスクリプションでCodexに接続してください".to_string());
    }
    let result = read_subscription_usage_for(&mut server, 2).await;
    server.stop().await;
    result
}

fn validate_generate_request(request: &CodexGenerateRequest) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("AIへの依頼を入力してください".to_string());
    }
    if request.prompt.len() > MAX_PROMPT_BYTES {
        return Err("AIへの依頼が長すぎます".to_string());
    }
    if let Some(model) = &request.model {
        if !is_valid_model_id(model) {
            return Err("モデルIDが不正です".to_string());
        }
    }
    if request
        .reasoning_effort
        .as_deref()
        .is_some_and(|value| !is_valid_reasoning_effort(value))
    {
        return Err("Thinkingレベルが不正です".to_string());
    }
    if request.skill_ids.len() > MAX_SKILLS_PER_TURN
        || request
            .skill_ids
            .iter()
            .any(|id| id.is_empty() || id.len() > 200)
    {
        return Err("一度に選択できるスキルは4件までです".to_string());
    }
    if request.image_generation && request.web_search {
        return Err("画像生成とWeb検索は同じターンでは使用できません".to_string());
    }
    if request.image_generation && request.response_schema.is_some() {
        return Err("画像生成では構造化出力を使用できません".to_string());
    }
    Ok(())
}

fn is_blocked_tool(message: &Value, allow_web_search: bool, allow_image_generation: bool) -> bool {
    if message.get("method").and_then(Value::as_str) != Some("item/started") {
        return false;
    }
    match message.pointer("/params/item/type").and_then(Value::as_str) {
        Some("webSearch") => !allow_web_search,
        Some("imageGeneration") => !allow_image_generation,
        Some(
            "commandExecution" | "fileChange" | "mcpToolCall" | "dynamicToolCall" | "imageView",
        ) => true,
        _ => false,
    }
}

fn completed_image_generation(message: &Value) -> Option<&Value> {
    if message.get("method").and_then(Value::as_str) != Some("item/completed") {
        return None;
    }
    let item = message.pointer("/params/item")?;
    (item.get("type").and_then(Value::as_str) == Some("imageGeneration")).then_some(item)
}

fn detect_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

fn generated_image_data(item: &Value, isolated_root: &Path) -> Result<GeneratedImageData, String> {
    let encoded = item
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or("")
        .strip_prefix("data:image/png;base64,")
        .or_else(|| {
            item.get("result")
                .and_then(Value::as_str)
                .unwrap_or("")
                .strip_prefix("data:image/jpeg;base64,")
        })
        .or_else(|| {
            item.get("result")
                .and_then(Value::as_str)
                .unwrap_or("")
                .strip_prefix("data:image/webp;base64,")
        })
        .unwrap_or_else(|| item.get("result").and_then(Value::as_str).unwrap_or(""));
    let mut bytes = BASE64_STANDARD.decode(encoded).unwrap_or_default();
    if bytes.is_empty() {
        if let Some(saved_path) = item.get("savedPath").and_then(Value::as_str) {
            let root = isolated_root
                .canonicalize()
                .map_err(|error| format!("画像生成領域を確認できません：{error}"))?;
            let source = PathBuf::from(saved_path)
                .canonicalize()
                .map_err(|error| format!("生成画像を確認できません：{error}"))?;
            if !source.starts_with(&root) {
                return Err("生成画像が隔離領域の外を参照したため拒否しました".to_string());
            }
            bytes =
                fs::read(source).map_err(|error| format!("生成画像を読み込めません：{error}"))?;
        }
    }
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("生成画像のサイズが不正です".to_string());
    }
    let (media_type, extension) =
        detect_image(&bytes).ok_or_else(|| "生成画像の形式に対応していません".to_string())?;
    let revised_prompt = item
        .get("revisedPrompt")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(16_000).collect());
    Ok(GeneratedImageData {
        bytes,
        media_type: media_type.to_string(),
        extension: extension.to_string(),
        revised_prompt,
    })
}

fn completed_agent_text(message: &Value) -> Option<String> {
    if message.get("method").and_then(Value::as_str) != Some("item/completed") {
        return None;
    }
    let item = message.pointer("/params/item")?;
    (item.get("type").and_then(Value::as_str) == Some("agentMessage"))
        .then(|| item.get("text").and_then(Value::as_str).map(str::to_string))
        .flatten()
}

fn completed_web_search(message: &Value) -> Option<&Value> {
    if message.get("method").and_then(Value::as_str) != Some("item/completed") {
        return None;
    }
    let item = message.pointer("/params/item")?;
    (item.get("type").and_then(Value::as_str) == Some("webSearch")).then_some(item)
}

fn web_source(url: &str) -> Option<WebSource> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let host = parsed.host_str()?.trim_start_matches("www.");
    Some(WebSource {
        title: host.to_string(),
        url: parsed.to_string(),
    })
}

fn push_source(sources: &mut Vec<WebSource>, source: WebSource) {
    if sources.len() < 20 && !sources.iter().any(|item| item.url == source.url) {
        sources.push(source);
    }
}

fn collect_web_search_source(item: &Value, sources: &mut Vec<WebSource>) {
    if let Some(url) = item.pointer("/action/url").and_then(Value::as_str) {
        if let Some(source) = web_source(url) {
            push_source(sources, source);
        }
    }
}

fn collect_text_sources(text: &str, sources: &mut Vec<WebSource>) {
    for prefix in ["https://", "http://"] {
        for (start, _) in text.match_indices(prefix) {
            let candidate: String = text[start..]
                .chars()
                .take_while(|character| {
                    !character.is_whitespace()
                        && !matches!(character, ')' | ']' | '>' | '"' | '\'' | '。' | '、')
                })
                .collect();
            let candidate = candidate.trim_end_matches(['.', ',', ';', ':']);
            if let Some(source) = web_source(candidate) {
                push_source(sources, source);
            }
        }
    }
}

async fn generate_with_server(
    launcher: &CodexLauncher,
    request: CodexGenerateRequest,
) -> Result<CodexGenerateResponse, String> {
    validate_generate_request(&request)?;
    let expects_data = request.response_schema.is_some();
    let isolated =
        tempfile::tempdir().map_err(|error| format!("AI用の一時領域を作成できません：{error}"))?;
    let mut server = AppServer::start(launcher).await?;
    let account = read_account(&mut server).await?;
    if account.auth_mode.as_deref() != Some("chatgpt") {
        server.stop().await;
        return Err("ChatGPTサブスクリプションでCodexに接続してください。APIキー接続はこのプロバイダーでは使用しません".to_string());
    }

    if request.image_generation {
        let capabilities = read_provider_capabilities(&mut server).await;
        if !capabilities.image_generation {
            server.stop().await;
            return Err("現在のChatGPT/Codex接続は画像生成に対応していません".to_string());
        }
    }

    let effective_model = if request.model.is_some() || request.reasoning_effort.is_some() {
        let models = list_models_for(&mut server, 3).await?;
        let selected = if let Some(model_id) = request.model.as_deref() {
            models.iter().find(|model| model.id == model_id)
        } else {
            models
                .iter()
                .find(|model| model.is_default)
                .or_else(|| models.first())
        }
        .ok_or_else(|| "選択したモデルは現在のChatGPT接続で利用できません".to_string())?;
        if let Some(effort) = request.reasoning_effort.as_deref() {
            if !selected
                .supported_reasoning_efforts
                .iter()
                .any(|option| option.id == effort)
            {
                return Err("選択したThinkingレベルはこのモデルで利用できません".to_string());
            }
        }
        Some(selected.id.clone())
    } else {
        None
    };

    let all_skills = if request.skill_ids.is_empty() {
        Vec::new()
    } else {
        list_skills_for(&mut server, isolated.path(), 4).await?
    };
    let selected_skills: Vec<_> = request
        .skill_ids
        .iter()
        .map(|id| {
            all_skills
                .iter()
                .find(|skill| &skill.public.id == id)
                .cloned()
                .ok_or_else(|| format!("選択したスキルが見つかりません：{id}"))
        })
        .collect::<Result<_, _>>()?;

    let mut thread_params = json!({
        "cwd": isolated.path().to_string_lossy(),
        "approvalPolicy": "never",
        "sandbox": "read-only",
        "ephemeral": true,
        "serviceName": "mybox",
        "baseInstructions": if request.image_generation {
            "You are the image generation adapter for MyBox. Use the image generation tool to create exactly one image that satisfies the latest user request. Do not merely write an image prompt. Follow explicitly selected skill instructions. Never use commands, file-change tools, MCP, Web search, image viewing, or any other external capability. Save generated output only inside the current working directory. Return one short Japanese sentence after generation."
        } else if request.web_search {
            "You are an inference adapter for MyBox. You may use only the hosted web search tool when current information is useful. Never use commands, files, MCP, image tools, or any other external capability. Cite web-supported claims and include the source URLs in the answer."
        } else if selected_skills.is_empty() {
            "You are an inference adapter for MyBox. Never use tools, commands, files, network access, MCP, or external resources. Work only from the text in the user message and return the requested answer or structured JSON."
        } else {
            "You are an inference adapter for MyBox. Follow the explicitly selected skill instructions, but never use tools, commands, files, network access, MCP, or external resources. If a skill needs a blocked capability, explain that limitation instead of attempting it. Work only from the provided text and return the requested answer or structured JSON."
        }
    });
    if request.web_search {
        thread_params["config"] = json!({
            "web_search": "live",
            "tools": { "web_search": { "context_size": "medium" } }
        });
    }
    if let Some(model) = &effective_model {
        thread_params["model"] = Value::String(model.clone());
    }
    server
        .send(&json!({
            "method": "thread/start",
            "id": 5,
            "params": thread_params
        }))
        .await?;
    let thread = server.response(5, SHORT_TIMEOUT).await?;
    let thread_id = thread
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .ok_or_else(|| "CodexがスレッドIDを返しませんでした".to_string())?
        .to_string();

    let skill_markers = selected_skills
        .iter()
        .map(|skill| format!("${}", skill.public.name))
        .collect::<Vec<_>>()
        .join(" ");
    let prompt = if skill_markers.is_empty() {
        request.prompt.clone()
    } else {
        format!("{skill_markers}\n\n{}", request.prompt)
    };
    let mut input = vec![json!({ "type": "text", "text": prompt })];
    input.extend(selected_skills.iter().map(|skill| {
        json!({
            "type": "skill",
            "name": skill.public.name,
            "path": skill.path
        })
    }));
    let mut turn_params = json!({
        "threadId": thread_id,
        "input": input,
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly", "networkAccess": false }
    });
    if let Some(schema) = request.response_schema {
        turn_params["outputSchema"] = schema;
    }
    if let Some(effort) = &request.reasoning_effort {
        turn_params["effort"] = Value::String(effort.clone());
    }
    server
        .send(&json!({
            "method": "turn/start",
            "id": 6,
            "params": turn_params
        }))
        .await?;

    let outcome = timeout(GENERATION_TIMEOUT, async {
        let mut accepted = false;
        let mut answer = None;
        let mut sources = Vec::new();
        let mut web_search_used = false;
        let mut image_data = None;
        loop {
            let message = server.next_message().await?;
            if message.get("id").and_then(Value::as_i64) == Some(6) {
                if let Some(error) = message.get("error") {
                    return Err(rpc_error(error));
                }
                accepted = true;
                continue;
            }
            if is_blocked_tool(&message, request.web_search, request.image_generation) {
                return Err(
                    "AIプロバイダーが禁止されたツールを要求したため停止しました".to_string()
                );
            }
            if let Some(text) = completed_agent_text(&message) {
                answer = Some(text);
            }
            if let Some(item) = completed_web_search(&message) {
                web_search_used = true;
                collect_web_search_source(item, &mut sources);
            }
            if let Some(item) = completed_image_generation(&message) {
                image_data = Some(generated_image_data(item, isolated.path())?);
            }
            if message.get("method").and_then(Value::as_str) == Some("error") {
                let detail = message
                    .pointer("/params/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("生成に失敗しました");
                return Err(format!("Codexエラー：{detail}"));
            }
            if message.get("method").and_then(Value::as_str) == Some("turn/completed") {
                let status = message
                    .pointer("/params/turn/status")
                    .and_then(Value::as_str)
                    .unwrap_or("failed");
                if status != "completed" {
                    let detail = message
                        .pointer("/params/turn/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("生成を完了できませんでした");
                    return Err(format!("Codexエラー：{detail}"));
                }
                if !accepted {
                    return Err("Codexがターン開始を確認しませんでした".to_string());
                }
                if request.image_generation && image_data.is_none() {
                    return Err("Codexが生成画像を返しませんでした".to_string());
                }
                let answer = answer.unwrap_or_else(|| {
                    if image_data.is_some() {
                        "画像を生成しました。".to_string()
                    } else {
                        String::new()
                    }
                });
                if answer.is_empty() {
                    return Err("Codexが回答を返しませんでした".to_string());
                }
                collect_text_sources(&answer, &mut sources);
                return Ok((answer, sources, web_search_used, image_data));
            }
        }
    })
    .await
    .map_err(|_| "AIの応答がタイムアウトしました".to_string())?;

    server.stop().await;
    let (text, sources, web_search_used, image_data) = outcome?;
    let data = expects_data
        .then(|| serde_json::from_str(&text).ok())
        .flatten();
    Ok(CodexGenerateResponse {
        text,
        data,
        sources,
        web_search_used,
        image: None,
        image_data,
    })
}

fn persist_generated_image(
    app: &AppHandle,
    image: GeneratedImageData,
) -> Result<GeneratedImageResource, String> {
    let resource_id = format!("{}.{}", uuid::Uuid::new_v4(), image.extension);
    let key = format!("resources/generated-images/{resource_id}");
    let destination = crate::workspace::app_value_path(app, "ai-chat", &key)?;
    let parent = destination
        .parent()
        .ok_or_else(|| "生成画像の保存先が不正です".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("生成画像の保存先を作成できません：{error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("生成画像の一時ファイルを作成できません：{error}"))?;
    temporary
        .write_all(&image.bytes)
        .map_err(|error| format!("生成画像を保存できません：{error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("生成画像を同期できません：{error}"))?;
    temporary
        .persist(destination)
        .map_err(|error| format!("生成画像を確定できません：{}", error.error))?;
    Ok(GeneratedImageResource {
        resource_id,
        media_type: image.media_type,
        revised_prompt: image.revised_prompt,
    })
}

fn validate_image_resource_id(resource_id: &str) -> Result<(), String> {
    if resource_id.len() > 64
        || resource_id.contains(['/', '\\', '\0'])
        || !resource_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '.'))
        || ![".png", ".jpg", ".webp"]
            .iter()
            .any(|extension| resource_id.ends_with(extension))
    {
        return Err("画像リソースIDが不正です".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn read_chat_image(app: AppHandle, resource_id: String) -> Result<String, String> {
    validate_image_resource_id(&resource_id)?;
    let key = format!("resources/generated-images/{resource_id}");
    let path = crate::workspace::app_value_path(&app, "ai-chat", &key)?;
    let bytes = fs::read(path).map_err(|error| format!("生成画像を開けません：{error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("生成画像のサイズが不正です".to_string());
    }
    let (media_type, _) =
        detect_image(&bytes).ok_or_else(|| "生成画像の形式に対応していません".to_string())?;
    Ok(format!(
        "data:{media_type};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub async fn codex_subscription_generate(
    app: AppHandle,
    request: CodexGenerateRequest,
) -> Result<CodexGenerateResponse, String> {
    let launcher = find_codex().ok_or_else(|| "Codex CLIをインストールしてください".to_string())?;
    let mut response = generate_with_server(&launcher, request).await?;
    if let Some(image) = response.image_data.take() {
        response.image = Some(persist_generated_image(&app, image)?);
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn respects_path_order_across_windows_launcher_types() {
        let first = tempfile::tempdir().expect("first temp directory");
        let second = tempfile::tempdir().expect("second temp directory");
        std::fs::write(first.path().join("codex.cmd"), "@echo off").expect("command shim");
        std::fs::write(second.path().join("codex.exe"), "not an executable").expect("executable");

        let launcher = find_codex_in(&[first.path().to_path_buf(), second.path().to_path_buf()]);

        assert!(
            matches!(launcher, Some(CodexLauncher::CommandShim(path)) if path == first.path().join("codex.cmd"))
        );
    }

    #[test]
    #[ignore = "requires a locally installed and authenticated Codex CLI"]
    fn live_codex_subscription_status_is_connected() {
        tauri::async_runtime::block_on(async {
            let launcher = find_codex().expect("Codex CLI");
            let status = status_for(launcher).await;
            assert!(status.connected, "{status:?}");
            assert!(status.image_generation, "{status:?}");
        });
    }

    #[test]
    #[ignore = "requires a locally installed and authenticated Codex CLI"]
    fn live_codex_lists_skills() {
        tauri::async_runtime::block_on(async {
            let launcher = find_codex().expect("Codex CLI");
            let isolated = tempfile::tempdir().expect("isolated cwd");
            let mut server = AppServer::start(&launcher).await.expect("App Server");
            let skills = list_skills_for(&mut server, isolated.path(), 2)
                .await
                .expect("skills/list");
            server.stop().await;
            assert!(skills.iter().any(|skill| skill.public.name == "imagegen"));
        });
    }

    #[test]
    #[ignore = "requires a locally installed and authenticated Codex CLI"]
    fn live_codex_lists_models_and_subscription_usage() {
        tauri::async_runtime::block_on(async {
            let launcher = find_codex().expect("Codex CLI");
            let mut server = AppServer::start(&launcher).await.expect("App Server");
            let models = list_models_for(&mut server, 2).await.expect("model/list");
            let usage = read_subscription_usage_for(&mut server, 3)
                .await
                .expect("account/rateLimits/read");
            server.stop().await;
            assert!(!models.is_empty());
            assert!(usage.primary.is_some() || usage.secondary.is_some());
        });
    }

    #[test]
    #[ignore = "requires a locally installed and authenticated Codex CLI"]
    fn live_codex_subscription_generates_text() {
        tauri::async_runtime::block_on(async {
            let launcher = find_codex().expect("Codex CLI");
            let response = generate_with_server(
                &launcher,
                CodexGenerateRequest {
                    prompt: "Reply with exactly: OK".to_string(),
                    response_schema: None,
                    model: None,
                    reasoning_effort: None,
                    web_search: false,
                    image_generation: false,
                    skill_ids: Vec::new(),
                },
            )
            .await
            .expect("ChatGPT subscription response");
            assert_eq!(response.text.trim(), "OK");
        });
    }

    #[test]
    #[ignore = "requires a locally installed and authenticated Codex CLI plus Web access"]
    fn live_codex_subscription_searches_web() {
        tauri::async_runtime::block_on(async {
            let launcher = find_codex().expect("Codex CLI");
            let response = generate_with_server(
                &launcher,
                CodexGenerateRequest {
                    prompt: "Search the web for the current official OpenAI Web search API guide. Reply with one short sentence and include the exact source URL."
                        .to_string(),
                    response_schema: None,
                    model: None,
                    reasoning_effort: None,
                    web_search: true,
                    image_generation: false,
                    skill_ids: Vec::new(),
                },
            )
            .await
            .expect("ChatGPT subscription Web search response");
            assert!(response.web_search_used, "{response:?}");
            assert!(!response.sources.is_empty(), "{response:?}");
        });
    }

    #[test]
    #[ignore = "requires a locally installed authenticated Codex CLI with image generation"]
    fn live_codex_subscription_generates_an_image() {
        tauri::async_runtime::block_on(async {
            let launcher = find_codex().expect("Codex CLI");
            let response = generate_with_server(
                &launcher,
                CodexGenerateRequest {
                    prompt: "白い背景に、笑顔で座るかわいい子犬のシンプルな絵本風イラストを1枚生成してください。文字は入れないでください。".to_string(),
                    response_schema: None,
                    model: None,
                    reasoning_effort: None,
                    web_search: false,
                    image_generation: true,
                    skill_ids: Vec::new(),
                },
            )
            .await
            .expect("ChatGPT subscription image response");
            let image = response.image_data.expect("generated image bytes");
            assert!(!image.bytes.is_empty());
            assert!(image.media_type.starts_with("image/"));
        });
    }

    #[test]
    fn parses_chatgpt_plan_without_exposing_account_details() {
        let account = parse_account(&json!({
            "account": {
                "type": "chatgpt",
                "email": "private@example.com",
                "planType": "plus"
            },
            "requiresOpenaiAuth": true
        }));
        assert_eq!(account.auth_mode.as_deref(), Some("chatgpt"));
        assert_eq!(account.plan_type.as_deref(), Some("plus"));
    }

    #[test]
    fn parses_picker_models_and_subscription_quota_without_fabricating_tokens() {
        let models = parse_models(&json!({
            "data": [{
                "id": "gpt-5.6-terra",
                "displayName": "GPT-5.6 Terra",
                "description": "Balanced",
                "hidden": false,
                "isDefault": true,
                "defaultReasoningEffort": "medium",
                "supportedReasoningEfforts": [
                    { "reasoningEffort": "low", "description": "Fast" },
                    { "reasoningEffort": "medium", "description": "Balanced" }
                ]
            }]
        }));
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.6-terra");
        assert_eq!(models[0].default_reasoning_effort, "medium");

        let usage = parse_subscription_usage(&json!({
            "rateLimits": {
                "primary": { "usedPercent": 27, "windowDurationMins": 300, "resetsAt": 1_800_000_000 },
                "secondary": null
            }
        }));
        let primary = usage.primary.expect("primary quota");
        assert_eq!(primary.used_percent, 27);
        assert_eq!(primary.remaining_percent, 73);
    }

    #[test]
    fn detects_provider_tool_attempts() {
        assert!(is_blocked_tool(
            &json!({
                "method": "item/started",
                "params": { "item": { "type": "commandExecution" } }
            }),
            false,
            false
        ));
        assert!(!is_blocked_tool(
            &json!({
                "method": "item/started",
                "params": { "item": { "type": "agentMessage" } }
            }),
            false,
            false
        ));
        let web_search = json!({
            "method": "item/started",
            "params": { "item": { "type": "webSearch" } }
        });
        assert!(is_blocked_tool(&web_search, false, false));
        assert!(!is_blocked_tool(&web_search, true, false));
        let image_generation = json!({
            "method": "item/started",
            "params": { "item": { "type": "imageGeneration" } }
        });
        assert!(is_blocked_tool(&image_generation, false, false));
        assert!(!is_blocked_tool(&image_generation, false, true));
    }

    #[test]
    fn extracts_only_completed_agent_messages() {
        assert_eq!(
            completed_agent_text(&json!({
                "method": "item/completed",
                "params": { "item": { "type": "agentMessage", "text": "done" } }
            }))
            .as_deref(),
            Some("done")
        );
        assert!(completed_agent_text(&json!({
            "method": "item/completed",
            "params": { "item": { "type": "reasoning", "text": "hidden" } }
        }))
        .is_none());
    }

    #[test]
    fn collects_only_http_sources_from_search_items_and_text() {
        let mut sources = Vec::new();
        collect_web_search_source(
            &json!({ "action": { "type": "openPage", "url": "https://example.com/news" } }),
            &mut sources,
        );
        collect_text_sources(
            "See [guide](https://developers.openai.com/api/docs/guides/tools-web-search). Ignore javascript:alert(1)",
            &mut sources,
        );
        assert_eq!(sources.len(), 2);
        assert!(sources
            .iter()
            .all(|source| source.url.starts_with("https://")));
    }
}
