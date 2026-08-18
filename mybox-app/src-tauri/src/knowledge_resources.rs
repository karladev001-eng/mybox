use crate::codex::detect_image;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::{fs, io::Write};
use tauri::AppHandle;

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const APP_ID: &str = "knowledge";

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

/// Reads the file at the path the User's own OS file dialog returned — the
/// same pattern `open_workspace` already uses for a chosen directory — and
/// copies its bytes into this App's private resource namespace, returning an
/// opaque resource ID rather than the path. The frontend never receives a
/// filesystem path for a stored image, only this ID.
#[tauri::command]
pub fn store_knowledge_image(app: AppHandle, path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|error| format!("画像を読み込めません：{error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("画像のサイズが大きすぎます（上限25MB）".to_string());
    }
    let (_, extension) =
        detect_image(&bytes).ok_or_else(|| "対応していない画像形式です（PNG・JPEG・WebPのみ）".to_string())?;
    let resource_id = format!("{}.{extension}", uuid::Uuid::new_v4());
    let key = format!("resources/images/{resource_id}");
    let destination = crate::workspace::app_value_path(&app, APP_ID, &key)?;
    let parent = destination
        .parent()
        .ok_or_else(|| "画像の保存先が不正です".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("画像の保存先を作成できません：{error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("画像の一時ファイルを作成できません：{error}"))?;
    temporary
        .write_all(&bytes)
        .map_err(|error| format!("画像を保存できません：{error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("画像を同期できません：{error}"))?;
    temporary
        .persist(&destination)
        .map_err(|error| format!("画像を確定できません：{}", error.error))?;
    Ok(resource_id)
}

/// Returns a stored image as a data URI. Never a path: the WebView loads the
/// bytes directly rather than being handed anything it could use to reach
/// the rest of the filesystem.
#[tauri::command]
pub fn read_knowledge_image(app: AppHandle, resource_id: String) -> Result<String, String> {
    validate_image_resource_id(&resource_id)?;
    let key = format!("resources/images/{resource_id}");
    let path = crate::workspace::app_value_path(&app, APP_ID, &key)?;
    let bytes = fs::read(path).map_err(|error| format!("画像を開けません：{error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("画像のサイズが不正です".to_string());
    }
    let (media_type, _) =
        detect_image(&bytes).ok_or_else(|| "画像の形式に対応していません".to_string())?;
    Ok(format!(
        "data:{media_type};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_resource_id_with_path_traversal_or_a_disallowed_extension() {
        assert!(validate_image_resource_id("a1b2.png").is_ok());
        assert!(validate_image_resource_id("../secret.png").is_err());
        assert!(validate_image_resource_id("a/b.png").is_err());
        assert!(validate_image_resource_id("a1b2.exe").is_err());
        assert!(validate_image_resource_id(&"a".repeat(65)).is_err());
    }
}
