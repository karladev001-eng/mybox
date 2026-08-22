use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const MAX_JSON_BYTES: u64 = 10 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WorkspaceSettings {
    path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    path: String,
    name: String,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("設定ディレクトリを取得できません: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("設定ディレクトリを作成できません: {error}"))?;
    Ok(directory.join("workspace.json"))
}

fn atomic_write_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "保存先が不正です".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("保存先を作成できません: {error}"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("一時ファイルを作成できません: {error}"))?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer_pretty(&mut writer, value)
            .map_err(|error| format!("JSONを保存できません: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("保存を完了できません: {error}"))?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("保存を同期できません: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("保存内容を置き換えられません: {}", error.error))?;
    Ok(())
}

fn atomic_write_text(path: &Path, value: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "保存先が不正です".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("保存先を作成できません: {error}"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("一時ファイルを作成できません: {error}"))?;
    temporary
        .write_all(value.as_bytes())
        .map_err(|error| format!("テキストを保存できません: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("保存を同期できません: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("保存内容を置き換えられません: {}", error.error))?;
    Ok(())
}

fn save_workspace(app: &AppHandle, path: &Path) -> Result<(), String> {
    let value = serde_json::to_value(WorkspaceSettings {
        path: path.to_path_buf(),
    })
    .map_err(|error| format!("設定を作成できません: {error}"))?;
    atomic_write_json(&settings_path(app)?, &value)
}

fn load_workspace(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let settings: WorkspaceSettings = serde_json::from_reader(BufReader::new(
        File::open(&path).map_err(|error| format!("設定を開けません: {error}"))?,
    ))
    .map_err(|error| format!("設定を読み込めません: {error}"))?;
    if !settings.path.is_dir() {
        return Ok(None);
    }
    Ok(Some(settings.path))
}

fn workspace_info(path: &Path) -> WorkspaceInfo {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Workspace")
        .to_string();
    WorkspaceInfo {
        path: path.to_string_lossy().into_owned(),
        name,
    }
}

fn validate_app_id(app_id: &str) -> Result<(), String> {
    let mut characters = app_id.chars();
    if !matches!(characters.next(), Some(character) if character.is_ascii_lowercase())
        || !characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err("アプリIDが不正です".to_string());
    }
    Ok(())
}

fn validate_key(key: &str, allow_empty: bool) -> Result<(), String> {
    if (key.is_empty() && !allow_empty) || key.contains('\\') || key.contains('\0') {
        return Err("保存キーが不正です".to_string());
    }
    if key.is_empty() && allow_empty {
        return Ok(());
    }
    if key.starts_with('/') || key.ends_with('/') {
        return Err("保存キーが不正です".to_string());
    }
    if Path::new(key)
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("保存キーはアプリ領域の外を参照できません".to_string());
    }
    Ok(())
}

fn app_root(app: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    validate_app_id(app_id)?;
    let workspace =
        load_workspace(app)?.ok_or_else(|| "ワークスペースが選択されていません".to_string())?;
    let root = workspace.join("apps").join(app_id);
    fs::create_dir_all(&root)
        .map_err(|error| format!("アプリ保存領域を作成できません: {error}"))?;
    Ok(root)
}

pub(crate) fn app_value_path(app: &AppHandle, app_id: &str, key: &str) -> Result<PathBuf, String> {
    validate_key(key, false)?;
    let root = app_root(app, app_id)?;
    let mut current = root;
    for component in Path::new(key).components() {
        if let Component::Normal(segment) = component {
            current.push(segment);
            if current.exists()
                && fs::symlink_metadata(&current)
                    .map_err(|error| format!("保存先を確認できません: {error}"))?
                    .file_type()
                    .is_symlink()
            {
                return Err("シンボリックリンク経由の保存は許可されていません".to_string());
            }
        }
    }
    Ok(current)
}

#[tauri::command]
pub fn current_workspace(app: AppHandle) -> Result<Option<WorkspaceInfo>, String> {
    Ok(load_workspace(&app)?.as_deref().map(workspace_info))
}

#[tauri::command]
pub fn open_workspace(app: AppHandle, path: String) -> Result<WorkspaceInfo, String> {
    let selected = PathBuf::from(path);
    if !selected.is_dir() {
        return Err("選択したフォルダーが見つかりません".to_string());
    }
    let selected = selected
        .canonicalize()
        .map_err(|error| format!("保存先を確認できません: {error}"))?;
    for directory in [".mybox", "apps", "resources"] {
        fs::create_dir_all(selected.join(directory))
            .map_err(|error| format!("ワークスペースを初期化できません: {error}"))?;
    }
    save_workspace(&app, &selected)?;
    Ok(workspace_info(&selected))
}

#[tauri::command]
pub fn read_app_json(app: AppHandle, app_id: String, key: String) -> Result<Option<Value>, String> {
    let path = app_value_path(&app, &app_id, &key)?;
    if !path.exists() {
        return Ok(None);
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("保存データを確認できません: {error}"))?;
    if metadata.len() > MAX_JSON_BYTES {
        return Err("保存データがJSON状態の上限を超えています".to_string());
    }
    serde_json::from_reader(BufReader::new(
        File::open(path).map_err(|error| format!("保存データを開けません: {error}"))?,
    ))
    .map(Some)
    .map_err(|error| format!("保存データを読み込めません: {error}"))
}

#[tauri::command]
pub fn write_app_json(
    app: AppHandle,
    app_id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    let serialized_size = serde_json::to_vec(&value)
        .map_err(|error| format!("JSONを検証できません: {error}"))?
        .len() as u64;
    if serialized_size > MAX_JSON_BYTES {
        return Err("JSON状態は10MB以下にしてください".to_string());
    }
    let path = app_value_path(&app, &app_id, &key)?;
    atomic_write_json(&path, &value)
}

#[tauri::command]
pub fn read_app_text(
    app: AppHandle,
    app_id: String,
    key: String,
) -> Result<Option<String>, String> {
    let path = app_value_path(&app, &app_id, &key)?;
    if !path.exists() {
        return Ok(None);
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("保存テキストを確認できません: {error}"))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err("テキストは256KiB以下にしてください".to_string());
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("UTF-8テキストを読み込めません: {error}"))
}

#[tauri::command]
pub fn write_app_text(
    app: AppHandle,
    app_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    if value.len() as u64 > MAX_TEXT_BYTES {
        return Err("テキストは256KiB以下にしてください".to_string());
    }
    let path = app_value_path(&app, &app_id, &key)?;
    atomic_write_text(&path, &value)
}

#[tauri::command]
pub fn delete_app_value(app: AppHandle, app_id: String, key: String) -> Result<bool, String> {
    let path = app_value_path(&app, &app_id, &key)?;
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path)
        .map(|_| true)
        .map_err(|error| format!("保存データを削除できません: {error}"))
}

fn collect_keys(root: &Path, current: &Path, keys: &mut Vec<String>) -> Result<(), String> {
    for entry in
        fs::read_dir(current).map_err(|error| format!("保存データを一覧できません: {error}"))?
    {
        let entry = entry.map_err(|error| format!("保存データを一覧できません: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("保存データを確認できません: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_keys(root, &entry.path(), keys)?;
        } else if file_type.is_file() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|_| "保存データの相対パスを作成できません".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            keys.push(relative);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_app_keys(
    app: AppHandle,
    app_id: String,
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    let prefix = prefix.unwrap_or_default();
    validate_key(&prefix, true)?;
    let root = app_root(&app, &app_id)?;
    let mut keys = Vec::new();
    collect_keys(&root, &root, &mut keys)?;
    keys.retain(|key| key.starts_with(&prefix));
    keys.sort();
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::{atomic_write_json, atomic_write_text, validate_app_id, validate_key};
    use serde_json::json;

    #[test]
    fn accepts_namespaced_storage_keys() {
        assert!(validate_app_id("notes-app").is_ok());
        assert!(validate_key("notes/note-1.json", false).is_ok());
    }

    #[test]
    fn rejects_paths_outside_the_app_namespace() {
        assert!(validate_key("../notes/private.json", false).is_err());
        assert!(validate_key("/absolute.json", false).is_err());
        assert!(validate_key("folder\\private.json", false).is_err());
    }

    #[test]
    fn atomically_replaces_existing_json() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("state.json");
        atomic_write_json(&path, &json!({ "revision": 1 })).expect("initial write");
        atomic_write_json(&path, &json!({ "revision": 2 })).expect("replacement write");
        let value: serde_json::Value =
            serde_json::from_reader(std::fs::File::open(path).expect("open state"))
                .expect("read state");
        assert_eq!(value, json!({ "revision": 2 }));
    }

    #[test]
    fn atomically_replaces_utf8_text() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("template.md");
        atomic_write_text(&path, "世界観").expect("initial write");
        atomic_write_text(&path, "水彩").expect("replacement write");
        assert_eq!(std::fs::read_to_string(path).expect("read text"), "水彩");
    }
}
