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
const KEYRING_ACCOUNT: &str = "account-access-token";
const GITHUB_PROVIDER: &str = "github";
const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL: &str = "https://api.github.com/user";
const GITHUB_SCOPE: &str = "read:user";
const USER_AGENT: &str = "MyBox";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MIN_POLL_INTERVAL: u64 = 5;
const MAX_POLL_INTERVAL: u64 = 60;
const MAX_POLL_ATTEMPTS: u32 = 180;

/// The OAuth client ID is public by design: the device flow authenticates with
/// it alone and GitHub documents no client secret for this grant. It is
/// supplied at build time so a fork can point at its own OAuth App.
const GITHUB_CLIENT_ID: Option<&str> = option_env!("MYBOX_GITHUB_CLIENT_ID");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredAccount {
    provider: String,
    subject: String,
    display_name: String,
    avatar_url: Option<String>,
    linked_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountSettingsFile {
    version: u32,
    account: Option<StoredAccount>,
}

impl Default for AccountSettingsFile {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            account: None,
        }
    }
}

/// Returned to the frontend. It carries no token, by construction.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    signed_in: bool,
    provider: Option<String>,
    subject: Option<String>,
    display_name: Option<String>,
    avatar_url: Option<String>,
}

impl AccountView {
    fn signed_out() -> Self {
        Self {
            signed_in: false,
            provider: None,
            subject: None,
            display_name: None,
            avatar_url: None,
        }
    }

    fn from_stored(account: &StoredAccount) -> Self {
        Self {
            signed_in: true,
            provider: Some(account.provider.clone()),
            subject: Some(account.subject.clone()),
            display_name: Some(account.display_name.clone()),
            avatar_url: account.avatar_url.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLoginStart {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    interval: Option<u64>,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    id: u64,
    login: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}

fn client_id() -> Result<&'static str, String> {
    match GITHUB_CLIENT_ID {
        Some(value) if !value.trim().is_empty() => Ok(value.trim()),
        _ => Err(
            "GitHubのClient IDが未設定です。OAuth Appを作成し、MYBOX_GITHUB_CLIENT_IDを指定してビルドしてください。"
                .to_string(),
        ),
    }
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("通信を初期化できません：{error}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("アカウント設定ディレクトリを取得できません：{error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("アカウント設定ディレクトリを作成できません：{error}"))?;
    Ok(directory.join("accounts.json"))
}

fn load_settings(app: &AppHandle) -> Result<AccountSettingsFile, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AccountSettingsFile::default());
    }
    let settings: AccountSettingsFile = serde_json::from_reader(BufReader::new(
        File::open(path).map_err(|error| format!("アカウント設定を開けません：{error}"))?,
    ))
    .map_err(|error| format!("アカウント設定を読み込めません：{error}"))?;
    if settings.version != SETTINGS_VERSION {
        return Err("未対応のアカウント設定バージョンです".to_string());
    }
    Ok(settings)
}

fn atomic_write_settings(path: &Path, settings: &AccountSettingsFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "アカウント設定の保存先が不正です".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("アカウント設定の保存先を作成できません：{error}"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("アカウント設定の一時ファイルを作成できません：{error}"))?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer_pretty(&mut writer, settings)
            .map_err(|error| format!("アカウント設定を保存できません：{error}"))?;
        writer
            .flush()
            .map_err(|error| format!("アカウント設定の保存を完了できません：{error}"))?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("アカウント設定の保存を同期できません：{error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("アカウント設定を置き換えられません：{}", error.error))?;
    Ok(())
}

fn save_settings(app: &AppHandle, settings: &AccountSettingsFile) -> Result<(), String> {
    atomic_write_settings(&settings_path(app)?, settings)
}

fn token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("OSの資格情報ストアを開けません：{error}"))
}

fn store_token(token: &str) -> Result<(), String> {
    token_entry()?
        .set_password(token)
        .map_err(|error| format!("アクセストークンを保存できません：{error}"))
}

fn clear_token() -> Result<(), String> {
    match token_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("アクセストークンを削除できません：{error}")),
    }
}

fn read_token() -> Result<Option<Zeroizing<String>>, String> {
    match token_entry()?.get_password() {
        Ok(secret) => Ok(Some(Zeroizing::new(secret))),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("OSの資格情報ストアを読めません：{error}")),
    }
}

fn https_avatar(url: Option<String>) -> Option<String> {
    url.filter(|value| value.starts_with("https://"))
}

async fn fetch_github_user(token: &str) -> Result<GitHubUser, String> {
    let response = http_client()?
        .get(GITHUB_USER_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("GitHubのユーザー情報を取得できません：{error}"))?;
    if response.status() != StatusCode::OK {
        return Err(format!(
            "GitHubのユーザー情報を取得できません（HTTP {}）",
            response.status().as_u16()
        ));
    }
    response
        .json::<GitHubUser>()
        .await
        .map_err(|error| format!("GitHubの応答を解釈できません：{error}"))
}

#[tauri::command]
pub fn account_session(app: AppHandle) -> Result<AccountView, String> {
    let settings = load_settings(&app)?;
    // A stored profile without a token is a signed-out device: the credential
    // store is the authority on whether the session still exists.
    match (settings.account, read_token()?) {
        (Some(account), Some(_)) => Ok(AccountView::from_stored(&account)),
        _ => Ok(AccountView::signed_out()),
    }
}

#[tauri::command]
pub async fn begin_github_device_login() -> Result<DeviceLoginStart, String> {
    let response = http_client()?
        .post(GITHUB_DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id()?), ("scope", GITHUB_SCOPE)])
        .send()
        .await
        .map_err(|error| format!("GitHubに接続できません：{error}"))?;
    if response.status() != StatusCode::OK {
        return Err(format!(
            "GitHubのサインインを開始できません（HTTP {}）",
            response.status().as_u16()
        ));
    }
    let body: DeviceCodeResponse = response
        .json()
        .await
        .map_err(|error| format!("GitHubの応答を解釈できません：{error}"))?;
    Ok(DeviceLoginStart {
        device_code: body.device_code,
        user_code: body.user_code,
        verification_uri: body.verification_uri,
        interval: body.interval.unwrap_or(MIN_POLL_INTERVAL).clamp(MIN_POLL_INTERVAL, MAX_POLL_INTERVAL),
        expires_in: body.expires_in.unwrap_or(900),
    })
}

#[tauri::command]
pub async fn complete_github_device_login(
    app: AppHandle,
    device_code: String,
    interval: u64,
) -> Result<AccountView, String> {
    let id = client_id()?;
    let client = http_client()?;
    let mut wait = interval.clamp(MIN_POLL_INTERVAL, MAX_POLL_INTERVAL);

    for _ in 0..MAX_POLL_ATTEMPTS {
        tokio::time::sleep(Duration::from_secs(wait)).await;
        let response = client
            .post(GITHUB_TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", id),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|error| format!("GitHubに接続できません：{error}"))?;
        let body: TokenResponse = response
            .json()
            .await
            .map_err(|error| format!("GitHubの応答を解釈できません：{error}"))?;

        if let Some(token) = body.access_token {
            let token = Zeroizing::new(token);
            let user = fetch_github_user(&token).await?;
            store_token(&token)?;
            let account = StoredAccount {
                provider: GITHUB_PROVIDER.to_string(),
                subject: user.id.to_string(),
                display_name: user.name.filter(|n| !n.trim().is_empty()).unwrap_or(user.login),
                avatar_url: https_avatar(user.avatar_url),
                linked_at: linked_at_now(),
            };
            let mut settings = load_settings(&app)?;
            settings.account = Some(account.clone());
            save_settings(&app, &settings)?;
            return Ok(AccountView::from_stored(&account));
        }

        match body.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => {
                wait = body
                    .interval
                    .unwrap_or(wait + MIN_POLL_INTERVAL)
                    .clamp(MIN_POLL_INTERVAL, MAX_POLL_INTERVAL);
            }
            Some("expired_token") => return Err("コードの有効期限が切れました。もう一度お試しください。".to_string()),
            Some("access_denied") => return Err("サインインがキャンセルされました。".to_string()),
            Some(other) => return Err(format!("GitHubのサインインに失敗しました：{other}")),
            None => return Err("GitHubのサインインに失敗しました。".to_string()),
        }
    }
    Err("サインインが完了しませんでした。もう一度お試しください。".to_string())
}

#[tauri::command]
pub fn sign_out_account(app: AppHandle) -> Result<AccountView, String> {
    clear_token()?;
    let mut settings = load_settings(&app)?;
    settings.account = None;
    save_settings(&app, &settings)?;
    Ok(AccountView::signed_out())
}

/// Unix seconds, kept as a string so the record stays readable without pulling
/// in a date dependency for one field.
fn linked_at_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_view_never_carries_a_token() {
        let account = StoredAccount {
            provider: GITHUB_PROVIDER.to_string(),
            subject: "42".to_string(),
            display_name: "Kan".to_string(),
            avatar_url: Some("https://avatars.example/u/42.png".to_string()),
            linked_at: "0".to_string(),
        };
        let serialized = serde_json::to_value(AccountView::from_stored(&account)).unwrap();
        assert!(serialized.get("accessToken").is_none());
        assert!(serialized.get("token").is_none());
        assert_eq!(serialized.get("subject").unwrap(), "42");
        assert_eq!(serialized.get("signedIn").unwrap(), true);
    }

    #[test]
    fn stored_settings_never_serialize_a_token() {
        let settings = AccountSettingsFile {
            version: SETTINGS_VERSION,
            account: Some(StoredAccount {
                provider: GITHUB_PROVIDER.to_string(),
                subject: "42".to_string(),
                display_name: "Kan".to_string(),
                avatar_url: None,
                linked_at: "0".to_string(),
            }),
        };
        let serialized = serde_json::to_string(&settings).unwrap();
        assert!(!serialized.contains("Token"));
        assert!(!serialized.contains("token"));
    }

    #[test]
    fn only_https_avatars_survive() {
        assert_eq!(https_avatar(Some("http://a/b.png".into())), None);
        assert_eq!(
            https_avatar(Some("https://a/b.png".into())),
            Some("https://a/b.png".to_string())
        );
        assert_eq!(https_avatar(None), None);
    }

    #[test]
    fn a_missing_client_id_explains_the_setup_step() {
        if GITHUB_CLIENT_ID.is_none() {
            assert!(client_id().unwrap_err().contains("MYBOX_GITHUB_CLIENT_ID"));
        }
    }
}
