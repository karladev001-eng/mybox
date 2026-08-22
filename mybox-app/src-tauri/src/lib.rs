mod accounts;
mod agent_providers;
mod cloudflare;
mod codex;
mod image_studio_resources;
mod knowledge_resources;
mod sync_endpoints;
mod workspace;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

#[derive(Default)]
struct WorkflowBackground(AtomicBool);

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn workflow_background_enabled(state: tauri::State<'_, WorkflowBackground>) -> bool {
    state.0.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_workflow_background(state: tauri::State<'_, WorkflowBackground>, enabled: bool) -> bool {
    state.0.store(enabled, Ordering::SeqCst);
    enabled
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    restore_main_window(&app);
}

#[tauri::command]
fn exit_mybox(app: tauri::AppHandle, state: tauri::State<'_, WorkflowBackground>) {
    state.0.store(false, Ordering::SeqCst);
    app.exit(0);
}

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
        .manage(WorkflowBackground::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(windows)]
            configure_windows_webview(app)?;
            let mut tray = tauri::tray::TrayIconBuilder::with_id("mybox")
                .tooltip("MyBox")
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_tray_icon_event(|tray, event| {
                if matches!(event, tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. }) {
                    restore_main_window(tray.app_handle());
                }
            })
            .build(app)?;
            if std::env::args().any(|arg| arg == "--background") {
                app.state::<WorkflowBackground>()
                    .0
                    .store(true, Ordering::SeqCst);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<WorkflowBackground>()
                    .0
                    .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
            workflow_background_enabled,
            set_workflow_background,
            show_main_window,
            exit_mybox,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MyBox");
}
