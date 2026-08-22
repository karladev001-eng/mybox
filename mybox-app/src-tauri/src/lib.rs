mod accounts;
mod agent_providers;
mod cloudflare;
mod codex;
mod image_studio_resources;
mod knowledge_resources;
mod sync_endpoints;
mod workspace;

#[cfg(windows)]
fn disable_browser_accelerators(webview: tauri::webview::PlatformWebview) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    unsafe {
        let core_webview = webview
            .controller()
            .CoreWebView2()
            .map_err(|error| format!("WebView2を取得できません: {error}"))?;
        let settings = core_webview
            .Settings()
            .map_err(|error| format!("WebView2設定を取得できません: {error}"))?;
        let settings3 = settings
            .cast::<ICoreWebView2Settings3>()
            .map_err(|error| format!("WebView2のキー設定を取得できません: {error}"))?;
        settings3
            .SetAreBrowserAcceleratorKeysEnabled(false)
            .map_err(|error| {
                format!("WebView2のブラウザーショートカットを停止できません: {error}")
            })?;
    }

    Ok(())
}

#[cfg(windows)]
fn configure_windows_webview(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use std::sync::{Arc, Mutex};
    use tauri::Manager;

    let main_webview = app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::other("main WebViewが見つかりません"))?;
    let outcome = Arc::new(Mutex::new(None));
    let callback_outcome = Arc::clone(&outcome);

    main_webview.with_webview(move |webview| {
        *callback_outcome
            .lock()
            .expect("WebView設定結果をロックできません") =
            Some(disable_browser_accelerators(webview));
    })?;

    outcome
        .lock()
        .map_err(|_| std::io::Error::other("WebView設定結果を読み取れません"))?
        .take()
        .ok_or_else(|| std::io::Error::other("WebView設定が実行されませんでした"))?
        .map_err(std::io::Error::other)?;

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(windows)]
            configure_windows_webview(app)?;
            Ok(())
        })
        .manage(agent_providers::ProviderSecretLock::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            accounts::account_session,
            accounts::begin_github_device_login,
            accounts::complete_github_device_login,
            accounts::sign_out_account,
            sync_endpoints::sync_endpoints,
            sync_endpoints::connect_sync_endpoint,
            sync_endpoints::join_sync_endpoint,
            sync_endpoints::create_sync_invite,
            sync_endpoints::disconnect_sync_endpoint,
            sync_endpoints::list_sync_members,
            sync_endpoints::remove_sync_member,
            cloudflare::cloudflare_status,
            cloudflare::set_cloudflare_credentials,
            cloudflare::clear_cloudflare_credentials,
            cloudflare::deploy_sync_server,
            cloudflare::delete_sync_server,
            agent_providers::agent_provider_settings,
            agent_providers::configure_openai_api_provider,
            agent_providers::disconnect_openai_api_provider,
            agent_providers::configure_local_llm_provider,
            agent_providers::disconnect_local_llm_provider,
            agent_providers::set_active_agent_provider,
            agent_providers::openai_api_generate,
            agent_providers::local_llm_generate,
            codex::codex_subscription_status,
            codex::codex_subscription_login,
            codex::codex_subscription_skills,
            codex::codex_subscription_models,
            codex::codex_subscription_usage,
            codex::codex_subscription_generate,
            codex::read_chat_image,
            image_studio_resources::generate_image_studio,
            image_studio_resources::store_image_studio_reference,
            image_studio_resources::store_image_studio_reference_bytes,
            image_studio_resources::read_image_studio_resource,
            image_studio_resources::delete_image_studio_resource,
            knowledge_resources::store_knowledge_image,
            knowledge_resources::store_knowledge_image_bytes,
            knowledge_resources::read_knowledge_image,
            workspace::current_workspace,
            workspace::open_workspace,
            workspace::read_app_json,
            workspace::write_app_json,
            workspace::read_app_text,
            workspace::write_app_text,
            workspace::delete_app_value,
            workspace::list_app_keys,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MyBox");
}
