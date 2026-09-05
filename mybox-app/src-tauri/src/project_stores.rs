use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;
use uuid::Uuid;

const SETTINGS_VERSION: u32 = 1;
const MANIFEST_VERSION: u32 = 3;
const MANIFEST_KIND: &str = "mybox-note-project-store";
const LEGACY_PROJECTS_DIRECTORY: &str = "MyBox Projects";
const MAX_UPDATE_BYTES: usize = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 128 * 1024 * 1024;
const MAX_KNOWN_IDS: usize = 100_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectStoreRecord {
    project_id: String,
    path: PathBuf,
    location_type: String,
    location_label: String,
    connected_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectStoreSettings {
    version: u32,
    stores: Vec<ProjectStoreRecord>,
}

impl Default for ProjectStoreSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            stores: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectManifest {
    version: u32,
    kind: String,
    project_id: String,
    name: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStoreView {
    project_id: String,
    name: String,
    location_type: String,
    location_label: String,
    connected_at: String,
    empty: bool,
    needs_migration: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStoreUpdate {
    id: String,
    update: String,
}

fn now_seconds() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
        .to_string()
}

fn validate_project_id(project_id: &str) -> Result<(), String> {
    if project_id.is_empty()
        || project_id.len() > 160
        || !project_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err("Project IDが不正です".to_string());
    }
    Ok(())
}

fn validate_project_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 120 || trimmed.contains(['\0', '\r', '\n']) {
        return Err("Project名を確認してください".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_project_directory_name(name: &str) -> Result<String, String> {
    let name = validate_project_name(name)?;
    if name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        return Err("Project名にはフォルダー名に使用できない文字を含められません".to_string());
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
    {
        return Err("Project名はWindowsの予約済みフォルダー名にできません".to_string());
    }
    Ok(name)
}

fn path_for_display(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{rest}");
    }
    raw.strip_prefix("\\\\?\\").unwrap_or(&raw).to_string()
}

fn reject_symlink(path: &Path, label: &str) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("{label}を確認できません：{error}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("{label}にシンボリックリンクは使用できません"));
    }
    Ok(())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Project store設定の場所を取得できません：{error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Project store設定の場所を作成できません：{error}"))?;
    Ok(directory.join("project-stores.json"))
}

fn load_settings(app: &AppHandle) -> Result<ProjectStoreSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(ProjectStoreSettings::default());
    }
    let settings: ProjectStoreSettings = serde_json::from_reader(BufReader::new(
        File::open(path).map_err(|error| format!("Project store設定を開けません：{error}"))?,
    ))
    .map_err(|error| format!("Project store設定を読み込めません：{error}"))?;
    if settings.version != SETTINGS_VERSION {
        return Err("未対応のProject store設定です".to_string());
    }
    Ok(settings)
}

fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "保存先が不正です".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("保存先を作成できません：{error}"))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("一時ファイルを作成できません：{error}"))?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer_pretty(&mut writer, value)
            .map_err(|error| format!("JSONを保存できません：{error}"))?;
        writer
            .flush()
            .map_err(|error| format!("保存を完了できません：{error}"))?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("保存を同期できません：{error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("保存内容を置き換えられません：{}", error.error))?;
    Ok(())
}

fn save_settings(app: &AppHandle, settings: &ProjectStoreSettings) -> Result<(), String> {
    atomic_write_json(&settings_path(app)?, settings)
}

fn read_manifest(directory: &Path) -> Result<ProjectManifest, String> {
    reject_symlink(directory, "Projectフォルダー")?;
    let manifest_path = directory.join("manifest.json");
    reject_symlink(&manifest_path, "Project manifest")?;
    let manifest: ProjectManifest = serde_json::from_reader(BufReader::new(
        File::open(manifest_path)
            .map_err(|error| format!("Project manifestを開けません：{error}"))?,
    ))
    .map_err(|error| format!("Project manifestを読み込めません：{error}"))?;
    if !(1..=MANIFEST_VERSION).contains(&manifest.version) || manifest.kind != MANIFEST_KIND {
        return Err("選択したフォルダーは対応するMyBox Note Projectではありません".to_string());
    }
    validate_project_id(&manifest.project_id)?;
    validate_project_name(&manifest.name)?;
    Ok(manifest)
}

fn location_label(project_directory: &Path) -> String {
    let project_parent = project_directory.parent();
    let provider = project_parent
        .and_then(|path| {
            if path.file_name().and_then(|name| name.to_str()) == Some(LEGACY_PROJECTS_DIRECTORY) {
                path.parent()
            } else {
                Some(path)
            }
        })
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("クラウドフォルダー");
    format!(
        "{provider} / {}",
        project_directory
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Note Project")
    )
}

fn store_is_empty(directory: &Path) -> bool {
    fs::read_dir(directory.join("updates"))
        .map(|entries| {
            !entries.filter_map(Result::ok).any(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("bin")
            })
        })
        .unwrap_or(true)
}

fn store_directory_needs_migration(path: &Path, manifest: &ProjectManifest) -> bool {
    path.file_name().and_then(|value| value.to_str()) != Some(manifest.name.as_str())
        || path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|value| value.to_str())
            == Some(LEGACY_PROJECTS_DIRECTORY)
}

fn internal_store_directory(app: &AppHandle, project_name: &str) -> Result<PathBuf, String> {
    let state_path = crate::workspace::app_value_path(app, "knowledge", "state.json")?;
    let root = state_path
        .parent()
        .ok_or_else(|| "Noteの保存場所を取得できません".to_string())?;
    Ok(root.join(project_name))
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_for_display(left).eq_ignore_ascii_case(&path_for_display(right))
}

fn record_store(
    app: &AppHandle,
    path: PathBuf,
    manifest: &ProjectManifest,
    location_type: &str,
) -> Result<ProjectStoreView, String> {
    let mut settings = load_settings(app)?;
    let connected_at = now_seconds();
    let label = if location_type == "app" {
        "MyBoxアプリ内".to_string()
    } else {
        location_label(&path)
    };
    let empty = store_is_empty(&path);
    let record = ProjectStoreRecord {
        project_id: manifest.project_id.clone(),
        path,
        location_type: location_type.to_string(),
        location_label: label.clone(),
        connected_at: connected_at.clone(),
    };
    settings
        .stores
        .retain(|item| item.project_id != manifest.project_id);
    settings.stores.push(record);
    save_settings(app, &settings)?;
    Ok(ProjectStoreView {
        project_id: manifest.project_id.clone(),
        name: manifest.name.clone(),
        location_type: location_type.to_string(),
        location_label: label,
        connected_at,
        empty,
        needs_migration: false,
    })
}

fn configured_store(
    app: &AppHandle,
    project_id: &str,
) -> Result<(PathBuf, ProjectManifest), String> {
    validate_project_id(project_id)?;
    let settings = load_settings(app)?;
    let record = settings
        .stores
        .into_iter()
        .find(|item| item.project_id == project_id)
        .ok_or_else(|| "このProjectの保存場所が設定されていません".to_string())?;
    if !record.path.is_dir() {
        return Err("Projectの保存場所が見つかりません".to_string());
    }
    let canonical = record
        .path
        .canonicalize()
        .map_err(|error| format!("Projectの保存場所を確認できません：{error}"))?;
    let manifest = read_manifest(&canonical)?;
    if manifest.project_id != project_id {
        return Err("Project storeのIDが接続設定と一致しません".to_string());
    }
    Ok((canonical, manifest))
}

fn prepare_store(
    directory: &Path,
    project_id: &str,
    name: &str,
) -> Result<ProjectManifest, String> {
    let manifest_path = directory.join("manifest.json");
    if directory.exists() {
        if !directory.is_dir() {
            return Err("Project名と同じファイルが保存先にあります".to_string());
        }
        reject_symlink(directory, "Project store")?;
        if manifest_path.exists() {
            let mut existing = read_manifest(directory)?;
            if existing.project_id != project_id {
                return Err("同じ保存先に別のProjectがあります".to_string());
            }
            if existing.name != name {
                existing.name = name.to_string();
                atomic_write_json(&manifest_path, &existing)?;
            }
            fs::create_dir_all(directory.join("updates"))
                .map_err(|error| format!("更新フォルダーを作成できません：{error}"))?;
            reject_symlink(&directory.join("updates"), "更新フォルダー")?;
            return Ok(existing);
        }
        if fs::read_dir(directory)
            .map_err(|error| format!("保存先を確認できません：{error}"))?
            .next()
            .is_some()
        {
            return Err("Project名と同じ空でないフォルダーが保存先にあります".to_string());
        }
    }
    fs::create_dir_all(directory.join("updates"))
        .map_err(|error| format!("Project storeを作成できません：{error}"))?;
    reject_symlink(directory, "Project store")?;
    reject_symlink(&directory.join("updates"), "更新フォルダー")?;
    let manifest = ProjectManifest {
        version: MANIFEST_VERSION,
        kind: MANIFEST_KIND.to_string(),
        project_id: project_id.to_string(),
        name: name.to_string(),
        created_at: now_seconds(),
    };
    atomic_write_json(&manifest_path, &manifest)?;
    Ok(manifest)
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "更新の保存先が不正です".to_string())?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("更新の一時ファイルを作成できません：{error}"))?;
    temporary
        .write_all(bytes)
        .map_err(|error| format!("更新を書き込めません：{error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("更新を同期できません：{error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("更新を保存できません：{}", error.error))?;
    Ok(())
}

fn copy_existing_updates(
    app: &AppHandle,
    project_id: &str,
    destination: &Path,
) -> Result<(), String> {
    let Ok((source, _)) = configured_store(app, project_id) else {
        return Ok(());
    };
    if source == destination {
        return Ok(());
    }
    for entry in fs::read_dir(source.join("updates"))
        .map_err(|error| format!("現在のProject storeを開けません：{error}"))?
        .filter_map(Result::ok)
    {
        let source_path = entry.path();
        if source_path.extension().and_then(|value| value.to_str()) != Some("bin") {
            continue;
        }
        reject_symlink(&source_path, "更新ファイル")?;
        let bytes =
            fs::read(&source_path).map_err(|error| format!("更新ファイルを読めません：{error}"))?;
        if bytes.len() > MAX_UPDATE_BYTES {
            return Err("Project storeの更新ファイルが大きすぎます".to_string());
        }
        let target = destination.join("updates").join(entry.file_name());
        if !target.exists() {
            atomic_write_bytes(&target, &bytes)?;
        }
    }
    Ok(())
}

fn write_snapshot(directory: &Path, snapshot: Option<&str>) -> Result<(), String> {
    let Some(snapshot) = snapshot else {
        return Ok(());
    };
    let bytes = BASE64
        .decode(snapshot)
        .map_err(|_| "ProjectのPageスナップショット形式が不正です".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_UPDATE_BYTES {
        return Err("ProjectのPageスナップショットサイズが不正です".to_string());
    }
    let updates_directory = directory.join("updates");
    let id = Uuid::new_v4().to_string();
    atomic_write_bytes(&updates_directory.join(format!("{id}.bin")), &bytes)
}

fn renamed_store_directory(record: &ProjectStoreRecord, name: &str) -> Result<PathBuf, String> {
    let parent = record
        .path
        .parent()
        .ok_or_else(|| "現在のProject storeの場所が不正です".to_string())?;
    let base = if record.location_type == "external"
        && parent.file_name().and_then(|value| value.to_str()) == Some(LEGACY_PROJECTS_DIRECTORY)
    {
        parent
            .parent()
            .ok_or_else(|| "現在のProject storeの場所が不正です".to_string())?
    } else {
        parent
    };
    Ok(base.join(name))
}

#[tauri::command]
pub fn project_stores(app: AppHandle) -> Result<Vec<ProjectStoreView>, String> {
    let settings = load_settings(&app)?;
    let mut result = Vec::new();
    for record in settings.stores {
        if !record.path.is_dir() {
            continue;
        }
        let Ok(manifest) = read_manifest(&record.path) else {
            continue;
        };
        if manifest.project_id != record.project_id {
            continue;
        }
        let needs_migration = store_directory_needs_migration(&record.path, &manifest)
            || (record.location_type == "app"
                && !same_path(
                    &record.path,
                    &internal_store_directory(&app, &manifest.name)?,
                ));
        result.push(ProjectStoreView {
            project_id: record.project_id,
            name: manifest.name,
            location_type: record.location_type,
            location_label: record.location_label,
            connected_at: record.connected_at,
            empty: store_is_empty(&record.path),
            needs_migration,
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn project_store_path(app: AppHandle, project_id: String) -> Result<String, String> {
    validate_project_id(&project_id)?;
    if let Some(record) = load_settings(&app)?
        .stores
        .into_iter()
        .find(|item| item.project_id == project_id)
    {
        return Ok(path_for_display(&record.path));
    }
    Ok(path_for_display(&crate::workspace::app_value_path(
        &app,
        "knowledge",
        "state.json",
    )?))
}

#[tauri::command]
pub fn move_project_store(
    app: AppHandle,
    project_id: String,
    project_name: String,
    parent_path: String,
    snapshot: Option<String>,
) -> Result<ProjectStoreView, String> {
    validate_project_id(&project_id)?;
    let name = validate_project_directory_name(&project_name)?;
    let parent = PathBuf::from(parent_path);
    if !parent.is_dir() {
        return Err("選択した保存先が見つかりません".to_string());
    }
    reject_symlink(&parent, "選択した保存先")?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("保存先を確認できません：{error}"))?;
    let project_directory = canonical_parent.join(&name);
    let manifest = prepare_store(&project_directory, &project_id, &name)?;
    copy_existing_updates(&app, &project_id, &project_directory)?;
    write_snapshot(&project_directory, snapshot.as_deref())?;
    record_store(&app, project_directory, &manifest, "external")
}

#[tauri::command]
pub fn attach_project_store(app: AppHandle, path: String) -> Result<ProjectStoreView, String> {
    let directory = PathBuf::from(path);
    if !directory.is_dir() {
        return Err("選択したProjectフォルダーが見つかりません".to_string());
    }
    reject_symlink(&directory, "Projectフォルダー")?;
    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("Projectフォルダーを確認できません：{error}"))?;
    let manifest = read_manifest(&canonical)?;
    record_store(&app, canonical, &manifest, "external")
}

#[tauri::command]
pub fn ensure_app_project_store(
    app: AppHandle,
    project_id: String,
    project_name: String,
    snapshot: Option<String>,
) -> Result<ProjectStoreView, String> {
    validate_project_id(&project_id)?;
    let name = validate_project_directory_name(&project_name)?;
    if let Some(record) = load_settings(&app)?
        .stores
        .into_iter()
        .find(|item| item.project_id == project_id)
    {
        if record.path.file_name().and_then(|value| value.to_str()) != Some(name.as_str()) {
            return rename_project_store(app, project_id, name, snapshot);
        }
        let manifest = read_manifest(&record.path)?;
        let needs_migration = store_directory_needs_migration(&record.path, &manifest)
            || (record.location_type == "app"
                && !same_path(
                    &record.path,
                    &internal_store_directory(&app, &manifest.name)?,
                ));
        if store_is_empty(&record.path) {
            write_snapshot(&record.path, snapshot.as_deref())?;
        }
        return Ok(ProjectStoreView {
            project_id,
            name: manifest.name,
            location_type: record.location_type,
            location_label: record.location_label,
            connected_at: record.connected_at,
            empty: store_is_empty(&record.path),
            needs_migration,
        });
    }
    let directory = internal_store_directory(&app, &name)?;
    let manifest = prepare_store(&directory, &project_id, &name)?;
    write_snapshot(&directory, snapshot.as_deref())?;
    record_store(&app, directory, &manifest, "app")
}

#[tauri::command]
pub fn move_project_store_to_app(
    app: AppHandle,
    project_id: String,
    project_name: String,
    snapshot: Option<String>,
) -> Result<ProjectStoreView, String> {
    validate_project_id(&project_id)?;
    let name = validate_project_directory_name(&project_name)?;
    let directory = internal_store_directory(&app, &name)?;
    let manifest = prepare_store(&directory, &project_id, &name)?;
    copy_existing_updates(&app, &project_id, &directory)?;
    write_snapshot(&directory, snapshot.as_deref())?;
    record_store(&app, directory, &manifest, "app")
}

#[tauri::command]
pub fn forget_project_store(app: AppHandle, project_id: String) -> Result<(), String> {
    validate_project_id(&project_id)?;
    let mut settings = load_settings(&app)?;
    settings.stores.retain(|item| item.project_id != project_id);
    save_settings(&app, &settings)
}

#[tauri::command]
pub fn rename_project_store(
    app: AppHandle,
    project_id: String,
    project_name: String,
    snapshot: Option<String>,
) -> Result<ProjectStoreView, String> {
    validate_project_id(&project_id)?;
    let name = validate_project_directory_name(&project_name)?;
    let settings = load_settings(&app)?;
    let record = settings
        .stores
        .into_iter()
        .find(|item| item.project_id == project_id)
        .ok_or_else(|| "このProjectの保存場所が設定されていません".to_string())?;
    let (source, _) = configured_store(&app, &project_id)?;
    let destination = renamed_store_directory(&record, &name)?;
    let manifest = prepare_store(&destination, &project_id, &name)?;
    if source != destination {
        copy_existing_updates(&app, &project_id, &destination)?;
    }
    write_snapshot(&destination, snapshot.as_deref())?;
    record_store(&app, destination, &manifest, &record.location_type)
}

#[tauri::command]
pub fn read_project_store_updates(
    app: AppHandle,
    project_id: String,
    known_ids: Vec<String>,
) -> Result<Vec<ProjectStoreUpdate>, String> {
    if known_ids.len() > MAX_KNOWN_IDS {
        return Err("同期済み更新の一覧が大きすぎます".to_string());
    }
    let known: HashSet<&str> = known_ids.iter().map(String::as_str).collect();
    let (directory, _) = configured_store(&app, &project_id)?;
    let updates_directory = directory.join("updates");
    fs::create_dir_all(&updates_directory)
        .map_err(|error| format!("更新フォルダーを作成できません：{error}"))?;
    reject_symlink(&updates_directory, "更新フォルダー")?;
    let mut paths = fs::read_dir(&updates_directory)
        .map_err(|error| format!("更新フォルダーを開けません：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("bin"))
        .collect::<Vec<_>>();
    paths.sort();
    let mut total = 0usize;
    let mut result = Vec::new();
    for path in paths {
        reject_symlink(&path, "更新ファイル")?;
        let id = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if id.is_empty() || known.contains(id) {
            continue;
        }
        let bytes =
            fs::read(&path).map_err(|error| format!("更新ファイルを読めません：{error}"))?;
        if bytes.len() > MAX_UPDATE_BYTES {
            return Err("Project storeの更新ファイルが大きすぎます".to_string());
        }
        total = total.saturating_add(bytes.len());
        if total > MAX_RESPONSE_BYTES {
            return Err(
                "未同期の更新が多すぎます。クラウド同期が完了してから再度お試しください"
                    .to_string(),
            );
        }
        result.push(ProjectStoreUpdate {
            id: id.to_string(),
            update: BASE64.encode(bytes),
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn write_project_store_update(
    app: AppHandle,
    project_id: String,
    update: String,
) -> Result<String, String> {
    let bytes = BASE64
        .decode(update)
        .map_err(|_| "同期更新の形式が不正です".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_UPDATE_BYTES {
        return Err("同期更新のサイズが不正です".to_string());
    }
    let (directory, mut manifest) = configured_store(&app, &project_id)?;
    // Upgrade before accepting new writes. Older hosts reject version 3 rather
    // than projecting away conversation metadata they do not understand.
    if manifest.version < MANIFEST_VERSION {
        manifest.version = MANIFEST_VERSION;
        atomic_write_json(&directory.join("manifest.json"), &manifest)?;
    }
    let updates_directory = directory.join("updates");
    fs::create_dir_all(&updates_directory)
        .map_err(|error| format!("更新フォルダーを作成できません：{error}"))?;
    reject_symlink(&updates_directory, "更新フォルダー")?;
    let id = Uuid::new_v4().to_string();
    let destination = updates_directory.join(format!("{id}.bin"));
    let mut temporary = NamedTempFile::new_in(&updates_directory)
        .map_err(|error| format!("更新の一時ファイルを作成できません：{error}"))?;
    temporary
        .write_all(&bytes)
        .map_err(|error| format!("更新を書き込めません：{error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("更新を同期できません：{error}"))?;
    temporary
        .persist(destination)
        .map_err(|error| format!("更新を保存できません：{}", error.error))?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_ids_cannot_escape_the_selected_directory() {
        assert!(validate_project_id("project-1234_ab.cd").is_ok());
        for invalid in [
            "",
            "../outside",
            "folder/project",
            "project\\child",
            "日本語",
        ] {
            assert!(
                validate_project_id(invalid).is_err(),
                "{invalid} must be rejected"
            );
        }
    }

    #[test]
    fn manifests_are_versioned_and_provider_neutral() {
        let temporary = tempfile::tempdir().expect("temp dir");
        let directory = temporary.path().join("project-safe");
        fs::create_dir_all(&directory).expect("project dir");
        let manifest = ProjectManifest {
            version: MANIFEST_VERSION,
            kind: MANIFEST_KIND.to_string(),
            project_id: "project-safe".to_string(),
            name: "Cloud Project".to_string(),
            created_at: "1".to_string(),
        };
        atomic_write_json(&directory.join("manifest.json"), &manifest).expect("manifest");
        let restored = read_manifest(&directory).expect("valid manifest");
        assert_eq!(restored.project_id, "project-safe");

        let unsupported = ProjectManifest {
            version: MANIFEST_VERSION + 1,
            ..manifest
        };
        atomic_write_json(&directory.join("manifest.json"), &unsupported)
            .expect("unsupported manifest");
        assert!(read_manifest(&directory).is_err());
    }

    #[test]
    fn display_paths_hide_windows_verbatim_prefixes() {
        assert_eq!(
            path_for_display(Path::new(r"\\?\E:\notes\state.json")),
            r"E:\notes\state.json"
        );
        assert_eq!(
            path_for_display(Path::new(r"\\?\UNC\server\notes\state.json")),
            r"\\server\notes\state.json"
        );
        assert_eq!(
            path_for_display(Path::new(r"E:\notes\state.json")),
            r"E:\notes\state.json"
        );
    }

    #[test]
    fn project_names_are_safe_exact_directory_names() {
        assert_eq!(
            validate_project_directory_name("製品ロードマップ").expect("valid name"),
            "製品ロードマップ"
        );
        for invalid in [".", "..", "CON", "com1.txt", "a/b", "a\\b", "name."] {
            assert!(
                validate_project_directory_name(invalid).is_err(),
                "{invalid} must be rejected"
            );
        }
    }

    #[test]
    fn renamed_legacy_external_stores_leave_the_wrapper_directory() {
        let record = ProjectStoreRecord {
            project_id: "project-1".to_string(),
            path: PathBuf::from("D:/Cloud/MyBox Projects/project-1"),
            location_type: "external".to_string(),
            location_label: "Cloud / project-1".to_string(),
            connected_at: "1".to_string(),
        };
        assert_eq!(
            renamed_store_directory(&record, "Roadmap").expect("destination"),
            PathBuf::from("D:/Cloud/Roadmap")
        );
    }

    #[test]
    fn legacy_id_directories_are_reported_for_migration() {
        let manifest = ProjectManifest {
            version: MANIFEST_VERSION,
            kind: MANIFEST_KIND.to_string(),
            project_id: "project-1".to_string(),
            name: "Prompts".to_string(),
            created_at: "1".to_string(),
        };
        assert!(store_directory_needs_migration(
            Path::new("G:/MyBox Projects/project-1"),
            &manifest
        ));
        assert!(!store_directory_needs_migration(
            Path::new("G:/Prompts"),
            &manifest
        ));
    }

    #[test]
    fn page_snapshot_is_written_before_a_store_can_be_recorded() {
        let temporary = tempfile::tempdir().expect("temp dir");
        let directory = temporary.path().join("Roadmap");
        fs::create_dir_all(directory.join("updates")).expect("updates dir");

        write_snapshot(&directory, Some("cGFnZXM=")).expect("snapshot");

        let files = fs::read_dir(directory.join("updates"))
            .expect("updates")
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);
        assert_eq!(fs::read(files[0].path()).expect("bytes"), b"pages");
    }

    #[test]
    fn a_nonempty_same_named_directory_is_not_claimed_as_a_project_store() {
        let temporary = tempfile::tempdir().expect("temp dir");
        let directory = temporary.path().join("Roadmap");
        fs::create_dir_all(&directory).expect("project dir");
        fs::write(directory.join("personal.txt"), b"keep me").expect("existing file");

        assert!(prepare_store(&directory, "project-1", "Roadmap").is_err());
        assert!(!directory.join("manifest.json").exists());
    }
}
