mod agent_providers;
mod codex;
mod workspace;

pub fn run() {
    tauri::Builder::default()
        .manage(agent_providers::ProviderSecretLock::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
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
            workspace::current_workspace,
            workspace::open_workspace,
            workspace::read_app_json,
            workspace::write_app_json,
            workspace::delete_app_value,
            workspace::list_app_keys,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MyBox");
}
