use keyring::v1::{Entry, Error as KeyringError};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;
use zeroize::Zeroizing;

const SETTINGS_VERSION: u32 = 1;
const KEYRING_SERVICE: &str = "MyBox";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const USER_AGENT: &str = "MyBox";

/// A member token is a Project-scoped capability, not an account credential. It
/// rests in the OS credential store, but unlike an OAuth token it is handed to
/// the WebView, because opening the sync socket requires it in the URL. Losing
/// one exposes a single Project on a server its own group runs, and the Owner
/// revokes it by removing that member.
fn token_entry(project_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, &format!("sync-token:{project_id}"))
        .map_err(|error| format!("OSの資格情報ストアを開けません：{error}"))
}

fn store_token(project_id: &str, token: &str) -> Result<(), String> {
    token_entry(project_id)?
        .set_password(token)
        .map_err(|error| format!("同期トークンを保存できません：{error}"))
}

fn read_token(project_id: &str) -> Result<Option<Zeroizing<String>>, String> {
    match token_entry(project_id)?.get_password() {
        Ok(secret) => Ok(Some(Zeroizing::new(secret))),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("OSの資格情報ストアを読めません：{error}")),
    }
}

fn clear_token(project_id: &str) -> Result<(), String> {
    match token_entry(project_id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("同期トークンを削除できません：{error}")),
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EndpointRecord {
    project_id: String,
    endpoint: String,
    role: String,
    connected_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EndpointSettings {
    version: u32,
    endpoints: Vec<EndpointRecord>,
}

impl Default for EndpointSettings {
    fn default() -> Self {
        Self { version: SETTINGS_VERSION, endpoints: Vec::new() }
    }
}

/// Returned to the frontend together with the token needed to open the socket.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointView {
    project_id: String,
    endpoint: String,
    role: String,
    connected_at: String,
    token: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("同期設定ディレクトリを取得できません：{error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("同期設定ディレクトリを作成できません：{error}"))?;
    Ok(directory.join("sync-endpoints.json"))
}

fn load_settings(app: &AppHandle) -> Result<EndpointSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(EndpointSettings::default());
    }
    let settings: EndpointSettings = serde_json::from_reader(BufReader::new(
        File::open(path).map_err(|error| format!("同期設定を開けません：{error}"))?,
    ))
    .map_err(|error| format!("同期設定を読み込めません：{error}"))?;
    if settings.version != SETTINGS_VERSION {
        return Err("未対応の同期設定バージョンです".to_string());
    }
    Ok(settings)
}

fn atomic_write(path: &Path, settings: &EndpointSettings) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "同期設定の保存先が不正です".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("同期設定の保存先を作成できません：{error}"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("同期設定の一時ファイルを作成できません：{error}"))?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer_pretty(&mut writer, settings)
            .map_err(|error| format!("同期設定を保存できません：{error}"))?;
        writer.flush().map_err(|error| format!("同期設定の保存を完了できません：{error}"))?;
    }
    temporary.as_file().sync_all().map_err(|error| format!("同期設定の保存を同期できません：{error}"))?;
    temporary.persist(path).map_err(|error| format!("同期設定を置き換えられません：{}", error.error))?;
    Ok(())
}

fn save_settings(app: &AppHandle, settings: &EndpointSettings) -> Result<(), String> {
    atomic_write(&settings_path(app)?, settings)
}

/// Only https survives, so a member token never crosses the network in the
/// clear. Loopback is allowed so the server can be developed locally.
fn validate_endpoint(endpoint: &str) -> Result<String, String> {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| "サーバーURLの形式を確認してください".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    let is_loopback = host == "127.0.0.1" || host == "localhost" || host == "[::1]";
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && is_loopback) {
        return Err("同期サーバーにはhttpsのURLを指定してください".to_string());
    }
    Ok(trimmed.to_string())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("通信を初期化できません：{error}"))
}

#[derive(Debug, Deserialize)]
struct JoinResponse {
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InviteResponse {
    #[serde(default)]
    invite: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn now_seconds() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
        .to_string()
}

async fn record_membership(
    app: &AppHandle,
    project_id: &str,
    endpoint: &str,
    body: JoinResponse,
) -> Result<EndpointView, String> {
    let token = body.token.ok_or_else(|| {
        let reason = body.error.unwrap_or_else(|| "不明なエラー".to_string());
        format!("同期サーバーに接続できません：{reason}")
    })?;
    let role = body.role.unwrap_or_else(|| "editor".to_string());

    store_token(project_id, &token)?;
    let mut settings = load_settings(app)?;
    settings.endpoints.retain(|item| item.project_id != project_id);
    let record = EndpointRecord {
        project_id: project_id.to_string(),
        endpoint: endpoint.to_string(),
        role: role.clone(),
        connected_at: now_seconds(),
    };
    settings.endpoints.push(record.clone());
    save_settings(app, &settings)?;

    Ok(EndpointView {
        project_id: record.project_id,
        endpoint: record.endpoint,
        role: record.role,
        connected_at: record.connected_at,
        token: Some(token),
    })
}

#[tauri::command]
pub fn sync_endpoints(app: AppHandle) -> Result<Vec<EndpointView>, String> {
    Ok(load_settings(&app)?
        .endpoints
        .into_iter()
        .map(|record| EndpointView {
            token: read_token(&record.project_id).ok().flatten().map(|value| value.to_string()),
            project_id: record.project_id,
            endpoint: record.endpoint,
            role: record.role,
            connected_at: record.connected_at,
        })
        .collect())
}

/// Claims a Project on a server the caller operates, proving it with the
/// server secret. The secret is used for this one request and never stored.
#[tauri::command]
pub async fn connect_sync_endpoint(
    app: AppHandle,
    project_id: String,
    endpoint: String,
    secret: String,
    profile_id: String,
) -> Result<EndpointView, String> {
    let endpoint = validate_endpoint(&endpoint)?;
    let secret = Zeroizing::new(secret);
    let response = http_client()?
        .post(format!("{endpoint}/projects/{project_id}/claim"))
        .json(&serde_json::json!({
            "projectId": project_id,
            "profileId": profile_id,
            "secret": secret.as_str(),
        }))
        .send()
        .await
        .map_err(|error| format!("同期サーバーに接続できません：{error}"))?;

    if response.status() == StatusCode::NOT_FOUND {
        return Err("そのURLに同期サーバーが見つかりません".to_string());
    }
    let body: JoinResponse = response
        .json()
        .await
        .map_err(|error| format!("同期サーバーの応答を解釈できません：{error}"))?;
    record_membership(&app, &project_id, &endpoint, body).await
}

/// Joins a Project on someone else's server with an invite they issued.
#[tauri::command]
pub async fn join_sync_endpoint(
    app: AppHandle,
    project_id: String,
    endpoint: String,
    invite: String,
    profile_id: String,
) -> Result<EndpointView, String> {
    let endpoint = validate_endpoint(&endpoint)?;
    let invite = Zeroizing::new(invite);
    let response = http_client()?
        .post(format!("{endpoint}/projects/{project_id}/join"))
        .json(&serde_json::json!({ "invite": invite.as_str(), "profileId": profile_id }))
        .send()
        .await
        .map_err(|error| format!("同期サーバーに接続できません：{error}"))?;

    let body: JoinResponse = response
        .json()
        .await
        .map_err(|error| format!("同期サーバーの応答を解釈できません：{error}"))?;
    record_membership(&app, &project_id, &endpoint, body).await
}

/// Issues an invite for someone else. The value is returned once for the Owner
/// to pass along and is deliberately not stored.
#[tauri::command]
pub async fn create_sync_invite(app: AppHandle, project_id: String, role: String) -> Result<String, String> {
    let settings = load_settings(&app)?;
    let record = settings
        .endpoints
        .iter()
        .find(|item| item.project_id == project_id)
        .ok_or_else(|| "このProjectは同期サーバーに接続されていません".to_string())?;
    let token = read_token(&project_id)?.ok_or_else(|| "同期トークンが見つかりません".to_string())?;

    let response = http_client()?
        .post(format!("{}/projects/{}/invites", record.endpoint, project_id))
        .header("Authorization", format!("Bearer {}", token.as_str()))
        .json(&serde_json::json!({ "role": role }))
        .send()
        .await
        .map_err(|error| format!("同期サーバーに接続できません：{error}"))?;

    let body: InviteResponse = response
        .json()
        .await
        .map_err(|error| format!("同期サーバーの応答を解釈できません：{error}"))?;
    body.invite.ok_or_else(|| {
        format!("招待を作成できません：{}", body.error.unwrap_or_else(|| "不明なエラー".to_string()))
    })
}

/// Stops syncing on this device. The Project keeps its local copy, and the
/// member remains on the server until its Owner removes them.
#[tauri::command]
pub fn disconnect_sync_endpoint(app: AppHandle, project_id: String) -> Result<(), String> {
    clear_token(&project_id)?;
    let mut settings = load_settings(&app)?;
    settings.endpoints.retain(|item| item.project_id != project_id);
    save_settings(&app, &settings)
}

fn endpoint_for(app: &AppHandle, project_id: &str) -> Result<(EndpointRecord, Zeroizing<String>), String> {
    let settings = load_settings(app)?;
    let record = settings
        .endpoints
        .iter()
        .find(|item| item.project_id == project_id)
        .ok_or_else(|| "このProjectは同期サーバーに接続されていません".to_string())?
        .clone();
    let token = read_token(project_id)?.ok_or_else(|| "同期トークンが見つかりません".to_string())?;
    Ok((record, token))
}

/// Field names mirror the server's wire format (`profile_id`, `joined_at`)
/// rather than this file's usual camelCase, because this struct round-trips
/// the server's JSON response straight through to the JS caller, which maps
/// them to camelCase itself.
#[derive(Debug, Deserialize, Serialize)]
pub struct MemberView {
    profile_id: String,
    role: String,
    joined_at: i64,
}

#[derive(Debug, Deserialize)]
struct MembersResponse {
    #[serde(default)]
    members: Option<Vec<MemberView>>,
    #[serde(default)]
    error: Option<String>,
}

/// Lists a Project's members. Only its Owner may call this; the server enforces
/// that independently of what this command's caller believes their role is.
#[tauri::command]
pub async fn list_sync_members(app: AppHandle, project_id: String) -> Result<Vec<MemberView>, String> {
    let (record, token) = endpoint_for(&app, &project_id)?;
    let response = http_client()?
        .get(format!("{}/projects/{}/members", record.endpoint, project_id))
        .header("Authorization", format!("Bearer {}", token.as_str()))
        .send()
        .await
        .map_err(|error| format!("同期サーバーに接続できません：{error}"))?;

    let body: MembersResponse = response
        .json()
        .await
        .map_err(|error| format!("同期サーバーの応答を解釈できません：{error}"))?;
    body.members.ok_or_else(|| {
        format!("メンバー一覧を取得できません：{}", body.error.unwrap_or_else(|| "不明なエラー".to_string()))
    })
}

#[derive(Debug, Deserialize)]
struct RemoveMemberResponse {
    #[serde(default)]
    removed: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

/// Removes a member. The server refuses removing the Project's Owner and closes
/// that member's open sockets immediately rather than waiting for their next
/// request, so revocation takes effect during an open session.
#[tauri::command]
pub async fn remove_sync_member(app: AppHandle, project_id: String, profile_id: String) -> Result<(), String> {
    let (record, token) = endpoint_for(&app, &project_id)?;
    let response = http_client()?
        .post(format!("{}/projects/{}/members/remove", record.endpoint, project_id))
        .header("Authorization", format!("Bearer {}", token.as_str()))
        .json(&serde_json::json!({ "profileId": profile_id }))
        .send()
        .await
        .map_err(|error| format!("同期サーバーに接続できません：{error}"))?;

    let body: RemoveMemberResponse = response
        .json()
        .await
        .map_err(|error| format!("同期サーバーの応答を解釈できません：{error}"))?;
    if body.removed.is_some() {
        Ok(())
    } else {
        Err(format!("メンバーを削除できません：{}", body.error.unwrap_or_else(|| "不明なエラー".to_string())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_endpoint_must_be_https_unless_it_is_loopback() {
        assert_eq!(validate_endpoint("https://sync.example.workers.dev/").unwrap(), "https://sync.example.workers.dev");
        assert!(validate_endpoint("http://127.0.0.1:8787").is_ok());
        assert!(validate_endpoint("http://localhost:8787").is_ok());
        assert!(validate_endpoint("http://sync.example.com").is_err());
        assert!(validate_endpoint("ftp://sync.example.com").is_err());
        assert!(validate_endpoint("not a url").is_err());
    }

    #[test]
    fn stored_settings_never_serialize_a_token() {
        let settings = EndpointSettings {
            version: SETTINGS_VERSION,
            endpoints: vec![EndpointRecord {
                project_id: "p".into(),
                endpoint: "https://sync.example".into(),
                role: "owner".into(),
                connected_at: "0".into(),
            }],
        };
        let serialized = serde_json::to_string(&settings).unwrap();
        assert!(!serialized.to_lowercase().contains("token"));
    }
}
