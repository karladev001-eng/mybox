use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{env, path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

const SHORT_TIMEOUT: Duration = Duration::from_secs(12);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const GENERATION_TIMEOUT: Duration = Duration::from_secs(240);
const MAX_PROMPT_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug)]
enum CodexLauncher {
    Direct(PathBuf),
    #[cfg(windows)]
    CommandShim(PathBuf),
}

impl CodexLauncher {
    fn command(&self, args: &[&str]) -> Command {
        match self {
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
        }
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexGenerateResponse {
    text: String,
    data: Option<Value>,
}

#[derive(Default, Debug)]
struct AccountState {
    auth_mode: Option<String>,
    plan_type: Option<String>,
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

async fn status_for(launcher: CodexLauncher) -> CodexSubscriptionStatus {
    let version = codex_version(&launcher).await;
    let account = match AppServer::start(&launcher).await {
        Ok(mut server) => {
            let result = read_account(&mut server).await;
            server.stop().await;
            result
        }
        Err(error) => Err(error),
    };

    match account {
        Ok(account) => CodexSubscriptionStatus {
            available: true,
            connected: account.auth_mode.as_deref() == Some("chatgpt"),
            version,
            auth_mode: account.auth_mode,
            plan_type: account.plan_type,
            error: None,
        },
        Err(error) => CodexSubscriptionStatus {
            available: true,
            connected: false,
            version,
            auth_mode: None,
            plan_type: None,
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

fn validate_generate_request(request: &CodexGenerateRequest) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("AIへの依頼を入力してください".to_string());
    }
    if request.prompt.len() > MAX_PROMPT_BYTES {
        return Err("AIへの依頼が長すぎます".to_string());
    }
    if let Some(model) = &request.model {
        let valid = !model.is_empty()
            && model.len() <= 80
            && model
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character));
        if !valid {
            return Err("モデルIDが不正です".to_string());
        }
    }
    Ok(())
}

fn is_blocked_tool(message: &Value) -> bool {
    if message.get("method").and_then(Value::as_str) != Some("item/started") {
        return false;
    }
    matches!(
        message.pointer("/params/item/type").and_then(Value::as_str),
        Some(
            "commandExecution"
                | "fileChange"
                | "mcpToolCall"
                | "dynamicToolCall"
                | "webSearch"
                | "imageView"
        )
    )
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

    let mut thread_params = json!({
        "cwd": isolated.path().to_string_lossy(),
        "approvalPolicy": "never",
        "sandbox": "read-only",
        "ephemeral": true,
        "serviceName": "mybox",
        "baseInstructions": "You are an inference adapter for MyBox. Never use tools, commands, files, network access, MCP, or external resources. Work only from the text in the user message and return the requested answer or structured JSON."
    });
    if let Some(model) = &request.model {
        thread_params["model"] = Value::String(model.clone());
    }
    server
        .send(&json!({
            "method": "thread/start",
            "id": 2,
            "params": thread_params
        }))
        .await?;
    let thread = server.response(2, SHORT_TIMEOUT).await?;
    let thread_id = thread
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .ok_or_else(|| "CodexがスレッドIDを返しませんでした".to_string())?
        .to_string();

    let mut turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": request.prompt }],
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly", "networkAccess": false }
    });
    if let Some(schema) = request.response_schema {
        turn_params["outputSchema"] = schema;
    }
    server
        .send(&json!({
            "method": "turn/start",
            "id": 3,
            "params": turn_params
        }))
        .await?;

    let outcome = timeout(GENERATION_TIMEOUT, async {
        let mut accepted = false;
        let mut answer = None;
        loop {
            let message = server.next_message().await?;
            if message.get("id").and_then(Value::as_i64) == Some(3) {
                if let Some(error) = message.get("error") {
                    return Err(rpc_error(error));
                }
                accepted = true;
                continue;
            }
            if is_blocked_tool(&message) {
                return Err(
                    "AIプロバイダーが禁止されたツールを要求したため停止しました".to_string()
                );
            }
            if let Some(text) = completed_agent_text(&message) {
                answer = Some(text);
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
                return answer.ok_or_else(|| "Codexが回答を返しませんでした".to_string());
            }
        }
    })
    .await
    .map_err(|_| "AIの応答がタイムアウトしました".to_string())?;

    server.stop().await;
    let text = outcome?;
    let data = expects_data
        .then(|| serde_json::from_str(&text).ok())
        .flatten();
    Ok(CodexGenerateResponse { text, data })
}

#[tauri::command]
pub async fn codex_subscription_generate(
    request: CodexGenerateRequest,
) -> Result<CodexGenerateResponse, String> {
    let launcher = find_codex().ok_or_else(|| "Codex CLIをインストールしてください".to_string())?;
    generate_with_server(&launcher, request).await
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
                },
            )
            .await
            .expect("ChatGPT subscription response");
            assert_eq!(response.text.trim(), "OK");
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
    fn detects_provider_tool_attempts() {
        assert!(is_blocked_tool(&json!({
            "method": "item/started",
            "params": { "item": { "type": "commandExecution" } }
        })));
        assert!(!is_blocked_tool(&json!({
            "method": "item/started",
            "params": { "item": { "type": "agentMessage" } }
        })));
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
}
