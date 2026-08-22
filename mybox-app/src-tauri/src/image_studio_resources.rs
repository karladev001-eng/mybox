use crate::codex::{detect_image, generate_image_for_app};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf};
use tauri::AppHandle;

const APP_ID: &str = "image-studio";
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceReference {
    app_id: String,
    resource_id: String,
    media_type: String,
    revision: u32,
    #[serde(default, rename = "name")]
    _name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageStudioGenerateRequest {
    prompt: String,
    #[serde(default)]
    references: Vec<ResourceReference>,
    generation_id: String,
}

fn validate_resource_id(resource_id: &str) -> Result<(), String> {
    if resource_id.is_empty()
        || resource_id.len() > 80
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

fn persist(app: &AppHandle, bytes: &[u8], folder: &str) -> Result<Value, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("画像は25MB以下にしてください".to_string());
    }
    let (media_type, extension) =
        detect_image(bytes).ok_or_else(|| "PNG・JPEG・WebPのみ対応しています".to_string())?;
    let resource_id = format!("{}.{}", uuid::Uuid::new_v4(), extension);
    let destination = crate::workspace::app_value_path(
        app,
        APP_ID,
        &format!("resources/{folder}/{resource_id}"),
    )?;
    let parent = destination
        .parent()
        .ok_or_else(|| "画像の保存先が不正です".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("画像の保存先を作成できません：{error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("一時ファイルを作成できません：{error}"))?;
    temporary
        .write_all(bytes)
        .map_err(|error| format!("画像を保存できません：{error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("画像を同期できません：{error}"))?;
    temporary
        .persist(destination)
        .map_err(|error| format!("画像を確定できません：{}", error.error))?;
    Ok(
        json!({ "appId": APP_ID, "resourceId": resource_id, "mediaType": media_type, "revision": 1 }),
    )
}

fn resource_path(app: &AppHandle, reference: &ResourceReference) -> Result<PathBuf, String> {
    if reference.app_id != APP_ID || reference.revision < 1 {
        return Err("参照画像の所有Appまたはrevisionが不正です".to_string());
    }
    validate_resource_id(&reference.resource_id)?;
    let expected_media = match reference.resource_id.rsplit('.').next() {
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "",
    };
    if reference.media_type != expected_media {
        return Err("参照画像のmediaTypeが一致しません".to_string());
    }
    for folder in ["references", "generated-images"] {
        let path = crate::workspace::app_value_path(
            app,
            APP_ID,
            &format!("resources/{folder}/{}", reference.resource_id),
        )?;
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("参照画像が見つかりません".to_string())
}

#[tauri::command]
pub fn store_image_studio_reference(app: AppHandle, path: String) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| format!("画像を読み込めません：{error}"))?;
    persist(&app, &bytes, "references")
}

#[tauri::command]
pub fn store_image_studio_reference_bytes(app: AppHandle, data: String) -> Result<Value, String> {
    let bytes = BASE64_STANDARD
        .decode(data.as_bytes())
        .map_err(|error| format!("画像データを解釈できません：{error}"))?;
    persist(&app, &bytes, "references")
}

#[tauri::command]
pub fn read_image_studio_resource(app: AppHandle, resource_id: String) -> Result<String, String> {
    validate_resource_id(&resource_id)?;
    for folder in ["generated-images", "references"] {
        let path = crate::workspace::app_value_path(
            &app,
            APP_ID,
            &format!("resources/{folder}/{resource_id}"),
        )?;
        if path.is_file() {
            let bytes = fs::read(path).map_err(|error| format!("画像を開けません：{error}"))?;
            if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
                return Err("画像のサイズが不正です".to_string());
            }
            let (media_type, _) =
                detect_image(&bytes).ok_or_else(|| "画像形式に対応していません".to_string())?;
            return Ok(format!(
                "data:{media_type};base64,{}",
                BASE64_STANDARD.encode(bytes)
            ));
        }
    }
    Err("画像が見つかりません".to_string())
}

#[tauri::command]
pub fn delete_image_studio_resource(app: AppHandle, resource_id: String) -> Result<(), String> {
    validate_resource_id(&resource_id)?;
    let path = crate::workspace::app_value_path(
        &app,
        APP_ID,
        &format!("resources/generated-images/{resource_id}"),
    )?;
    if path.is_file() {
        fs::remove_file(path).map_err(|error| format!("生成画像を完全削除できません：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn generate_image_studio(
    app: AppHandle,
    request: ImageStudioGenerateRequest,
) -> Result<Value, String> {
    if request.generation_id.trim().is_empty() || request.references.len() > 4 {
        return Err("生成IDまたは参照画像数が不正です".to_string());
    }
    let paths = request
        .references
        .iter()
        .map(|reference| resource_path(&app, reference))
        .collect::<Result<Vec<_>, _>>()?;
    let resource = generate_image_for_app(&app, request.prompt, paths, APP_ID).await?;
    let serialized =
        serde_json::to_value(resource).map_err(|error| format!("生成結果を返せません：{error}"))?;
    Ok(json!({
        "resource": { "appId": APP_ID, "resourceId": serialized["resourceId"], "mediaType": serialized["mediaType"], "revision": 1, "name": request.generation_id },
        "actual": { "width": serialized["width"], "height": serialized["height"] },
        "revisedPrompt": serialized["revisedPrompt"]
    }))
}

#[cfg(test)]
mod tests {
    use super::validate_resource_id;

    #[test]
    fn rejects_traversal_and_unknown_image_extensions() {
        assert!(validate_resource_id("image.png").is_ok());
        assert!(validate_resource_id("../image.png").is_err());
        assert!(validate_resource_id("image.gif").is_err());
    }
}
