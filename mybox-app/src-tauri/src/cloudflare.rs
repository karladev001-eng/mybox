use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::v1::{Entry, Error as KeyringError};
use rand::RngCore;
use reqwest::{multipart, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::PathBuf,
    time::Duration,
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

/// The single-file bundle `sync-server/package.json`'s `build` script
/// produces from `src/index.js`. `build.rs` runs that bundler before this
/// crate compiles and fails the build if it is missing, so this always
/// embeds a real, current Worker script rather than a stale one.
const WORKER_SCRIPT: &str = include_str!("../../../sync-server/dist/worker.js");
const WORKER_NAME: &str = "mybox-sync";
const WORKER_CLASS: &str = "ProjectRoom";
const WORKER_DO_BINDING: &str = "PROJECT_ROOM";
/// Matches `sync-server/wrangler.json`, which this deploy path replaces but
/// must stay behaviorally identical to.
const WORKER_COMPATIBILITY_DATE: &str = "2026-08-01";
const WORKER_MIGRATION_TAG: &str = "v1";

const KEYRING_SERVICE: &str = "MyBox";
const KEYRING_API_TOKEN_ACCOUNT: &str = "cloudflare-api-token";
const KEYRING_WORKER_SECRET_ACCOUNT: &str = "cloudflare-worker-secret";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "MyBox";
const API_BASE: &str = "https://api.cloudflare.com/client/v4";
const SECRET_BYTES: usize = 32;

fn credential_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, account).map_err(|error| format!("OSの資格情報ストアを開けません：{error}"))
}

fn store_credential(account: &str, value: &str) -> Result<(), String> {
    credential_entry(account)?
        .set_password(value)
        .map_err(|error| format!("資格情報を保存できません：{error}"))
}

fn read_credential(account: &str) -> Result<Option<Zeroizing<String>>, String> {
    match credential_entry(account)?.get_password() {
        Ok(secret) => Ok(Some(Zeroizing::new(secret))),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("資格情報を読み込めません：{error}")),
    }
}

fn clear_credential(account: &str) -> Result<(), String> {
    match credential_entry(account)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("資格情報を削除できません：{error}")),
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CloudflareSettings {
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    worker_url: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("設定ディレクトリを取得できません：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("設定ディレクトリを作成できません：{error}"))?;
    Ok(directory.join("cloudflare.json"))
}

fn load_settings(app: &AppHandle) -> Result<CloudflareSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(CloudflareSettings::default());
    }
    serde_json::from_reader(BufReader::new(
        File::open(path).map_err(|error| format!("設定を開けません：{error}"))?,
    ))
    .map_err(|error| format!("設定を読み込めません：{error}"))
}

fn save_settings(app: &AppHandle, settings: &CloudflareSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let parent = path.parent().ok_or_else(|| "設定の保存先が不正です".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("設定の一時ファイルを作成できません：{error}"))?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer_pretty(&mut writer, settings).map_err(|error| format!("設定を保存できません：{error}"))?;
        writer.flush().map_err(|error| format!("設定の保存を完了できません：{error}"))?;
    }
    temporary.as_file().sync_all().map_err(|error| format!("設定の保存を同期できません：{error}"))?;
    temporary.persist(&path).map_err(|error| format!("設定を置き換えられません：{}", error.error))?;
    Ok(())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("通信を初期化できません：{error}"))
}

#[derive(Debug, Deserialize)]
struct ApiError {
    #[serde(default)]
    message: String,
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    success: bool,
    #[serde(default)]
    errors: Vec<ApiError>,
    result: Option<T>,
}

fn describe_errors(errors: &[ApiError]) -> String {
    if errors.is_empty() {
        "不明なエラー".to_string()
    } else {
        errors.iter().map(|error| error.message.as_str()).collect::<Vec<_>>().join("; ")
    }
}

async fn call_api<T: serde::de::DeserializeOwned>(
    request: reqwest::RequestBuilder,
) -> Result<T, String> {
    let response = request
        .send()
        .await
        .map_err(|error| format!("Cloudflare APIに接続できません：{error}"))?;
    let status = response.status();
    let body: ApiEnvelope<T> = response
        .json()
        .await
        .map_err(|error| format!("Cloudflare APIの応答を解釈できません：{error}"))?;
    if !body.success {
        if status == StatusCode::FORBIDDEN || status == StatusCode::UNAUTHORIZED {
            return Err(format!(
                "Cloudflare APIトークンが無効か、権限が不足しています：{}",
                describe_errors(&body.errors)
            ));
        }
        return Err(format!("Cloudflare APIがエラーを返しました：{}", describe_errors(&body.errors)));
    }
    body.result.ok_or_else(|| "Cloudflare APIの応答に結果がありません".to_string())
}

/// Whether MyBox is ready to deploy: an account ID and API token are stored.
/// Never returns the token itself.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareStatusView {
    configured: bool,
    worker_url: Option<String>,
}

#[tauri::command]
pub fn cloudflare_status(app: AppHandle) -> Result<CloudflareStatusView, String> {
    let settings = load_settings(&app)?;
    let has_token = read_credential(KEYRING_API_TOKEN_ACCOUNT)?.is_some();
    Ok(CloudflareStatusView {
        configured: settings.account_id.is_some() && has_token,
        worker_url: settings.worker_url,
    })
}

#[derive(Debug, Default, Deserialize)]
struct TokenVerifyResult {
    #[serde(default)]
    status: String,
}

/// Calls Cloudflare's own token-verification endpoint — the same check the
/// dashboard's "Test this token" curl command runs — so a bad paste is
/// rejected here with a clear message instead of surfacing later as an
/// opaque deploy failure the User has no way to test themselves.
async fn verify_token(api_token: &str) -> Result<(), String> {
    let result: TokenVerifyResult = call_api(
        http_client()?
            .get(format!("{API_BASE}/user/tokens/verify"))
            .header("Authorization", format!("Bearer {api_token}")),
    )
    .await?;
    if result.status != "active" {
        return Err(format!("APIトークンが有効ではありません（状態：{}）", result.status));
    }
    Ok(())
}

/// Stores the Account ID and API token the User pasted from their own
/// Cloudflare dashboard, after verifying the token against Cloudflare itself.
/// The token is submit-once: it is never read back to the WebView, matching
/// how ADR 0006 already governs other provider API keys. Changing the
/// Account ID forgets any previously deployed Worker URL, since that URL
/// belonged to whatever account the old token pointed at.
#[tauri::command]
pub async fn set_cloudflare_credentials(app: AppHandle, account_id: String, api_token: String) -> Result<(), String> {
    let account_id = account_id.trim();
    let api_token = Zeroizing::new(api_token.trim().to_string());
    if account_id.is_empty() {
        return Err("Account IDを入力してください".to_string());
    }
    if api_token.is_empty() {
        return Err("APIトークンを入力してください".to_string());
    }

    verify_token(api_token.as_str()).await?;

    let mut settings = load_settings(&app)?;
    if settings.account_id.as_deref() != Some(account_id) {
        settings.worker_url = None;
    }
    settings.account_id = Some(account_id.to_string());
    save_settings(&app, &settings)?;
    store_credential(KEYRING_API_TOKEN_ACCOUNT, api_token.as_str())
}

/// Forgets the Cloudflare credentials and any deployed Worker URL. Does not
/// delete the Worker itself — use `delete_sync_server` first if that is
/// wanted, since this command alone would leave it running unmanaged.
#[tauri::command]
pub fn clear_cloudflare_credentials(app: AppHandle) -> Result<(), String> {
    clear_credential(KEYRING_API_TOKEN_ACCOUNT)?;
    clear_credential(KEYRING_WORKER_SECRET_ACCOUNT)?;
    save_settings(&app, &CloudflareSettings::default())
}

fn generate_secret() -> String {
    let mut bytes = [0u8; SECRET_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn worker_secret() -> Result<String, String> {
    if let Some(existing) = read_credential(KEYRING_WORKER_SECRET_ACCOUNT)? {
        return Ok(existing.to_string());
    }
    let secret = generate_secret();
    store_credential(KEYRING_WORKER_SECRET_ACCOUNT, &secret)?;
    Ok(secret)
}

#[derive(Debug, Deserialize)]
struct SubdomainResult {
    subdomain: String,
}

/// Deploys (or redeploys) the one Worker this account hosts every shared
/// Project's Durable Object on. Idempotent: calling this again after
/// `sync-server`'s code changes just updates that same Worker in place, and
/// reuses the already-generated `SERVER_SECRET` rather than rotating it,
/// so Projects already claimed on it keep working.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployedServer {
    endpoint: String,
    secret: String,
}

#[tauri::command]
pub async fn deploy_sync_server(app: AppHandle) -> Result<DeployedServer, String> {
    let settings = load_settings(&app)?;
    let account_id = settings
        .account_id
        .ok_or_else(|| "Cloudflareのアカウント情報が設定されていません".to_string())?;
    let api_token = read_credential(KEYRING_API_TOKEN_ACCOUNT)?
        .ok_or_else(|| "Cloudflare APIトークンが設定されていません".to_string())?;
    let secret = worker_secret()?;
    let client = http_client()?;

    let metadata = serde_json::json!({
        "main_module": "worker.js",
        "compatibility_date": WORKER_COMPATIBILITY_DATE,
        "compatibility_flags": ["nodejs_compat"],
        "observability": { "enabled": true },
        "bindings": [
            { "type": "durable_object_namespace", "name": WORKER_DO_BINDING, "class_name": WORKER_CLASS },
            { "type": "secret_text", "name": "SERVER_SECRET", "text": secret },
        ],
        // Unlike `sync-server/wrangler.json`'s own config format (which wraps this in an
        // array), the raw Script Upload API's `migrations` field for a single migration
        // step is one object, not a list of them — confirmed against a live deploy
        // after the array form failed with "cannot unmarshal array into ... ActorMigrations".
        "migrations": { "tag": WORKER_MIGRATION_TAG, "new_sqlite_classes": [WORKER_CLASS] },
    });

    let form = multipart::Form::new()
        .part(
            "metadata",
            multipart::Part::text(metadata.to_string()).mime_str("application/json").map_err(|error| error.to_string())?,
        )
        .part(
            "worker.js",
            // Cloudflare resolves `main_module` against each part's filename, not
            // just its form field name (`Part::text` alone omits filename and gave
            // "Uncaught Error: No such module: worker.js" against a live deploy).
            multipart::Part::text(WORKER_SCRIPT)
                .file_name("worker.js")
                .mime_str("application/javascript+module")
                .map_err(|error| error.to_string())?,
        );

    call_api::<serde_json::Value>(
        client
            .put(format!("{API_BASE}/accounts/{account_id}/workers/scripts/{WORKER_NAME}"))
            .header("Authorization", format!("Bearer {}", api_token.as_str()))
            .multipart(form),
    )
    .await?;

    call_api::<serde_json::Value>(
        client
            .post(format!("{API_BASE}/accounts/{account_id}/workers/scripts/{WORKER_NAME}/subdomain"))
            .header("Authorization", format!("Bearer {}", api_token.as_str()))
            .json(&serde_json::json!({ "enabled": true })),
    )
    .await?;

    let subdomain: SubdomainResult = call_api(
        client
            .get(format!("{API_BASE}/accounts/{account_id}/workers/subdomain"))
            .header("Authorization", format!("Bearer {}", api_token.as_str())),
    )
    .await?;

    let endpoint = format!("https://{WORKER_NAME}.{}.workers.dev", subdomain.subdomain);
    let mut next_settings = load_settings(&app)?;
    next_settings.worker_url = Some(endpoint.clone());
    save_settings(&app, &next_settings)?;

    Ok(DeployedServer { endpoint, secret })
}

/// Deletes the Worker from Cloudflare. Distinct from disconnecting one
/// Project (`disconnect_sync_endpoint`), because this Worker may host
/// several Projects' Durable Objects at once; deleting it ends all of them.
#[tauri::command]
pub async fn delete_sync_server(app: AppHandle) -> Result<(), String> {
    let settings = load_settings(&app)?;
    let account_id = settings
        .account_id
        .ok_or_else(|| "Cloudflareのアカウント情報が設定されていません".to_string())?;
    let api_token = read_credential(KEYRING_API_TOKEN_ACCOUNT)?
        .ok_or_else(|| "Cloudflare APIトークンが設定されていません".to_string())?;

    call_api::<serde_json::Value>(
        http_client()?
            .delete(format!("{API_BASE}/accounts/{account_id}/workers/scripts/{WORKER_NAME}?force=true"))
            .header("Authorization", format!("Bearer {}", api_token.as_str())),
    )
    .await?;

    clear_credential(KEYRING_WORKER_SECRET_ACCOUNT)?;
    let mut next_settings = load_settings(&app)?;
    next_settings.worker_url = None;
    save_settings(&app, &next_settings)
}
