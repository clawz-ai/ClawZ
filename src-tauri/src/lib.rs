mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Capture panics in the log system so they're visible in log files,
    // not silently swallowed by the Tokio runtime.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("[PANIC] {}", info);
        default_hook(info);
    }));

    tauri::Builder::default()
        .setup(|app| {
            if let Ok(resource_dir) = app.path().resource_dir() {
                commands::cli::init_resource_dir(resource_dir);
            }
            // Auto-install CLI symlink (~/.local/bin/openclaw → bundled wrapper)
            tauri::async_runtime::spawn(async {
                match commands::installer::install_cli_symlink().await {
                    Ok(path) => log::info!("CLI symlink ready: {}", path),
                    Err(e) => log::warn!("CLI symlink setup skipped: {}", e),
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin({
            use tauri_plugin_log::{Target, TargetKind, TimezoneStrategy, RotationStrategy};

            // Always log Debug to file so we have full diagnostics;
            // only show Info+ on stdout in release builds.
            let file_level = log::LevelFilter::Debug;
            let stdout_level = if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            };

            tauri_plugin_log::Builder::default()
                .level(file_level)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(10_000_000) // 10 MB per log file
                .rotation_strategy(RotationStrategy::KeepAll)
                .format(|out, message, record| {
                    // JSON-line format: one JSON object per line.
                    // Keeps multi-line JSON payloads on a single line for easy copy.
                    let msg = message.to_string().replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
                    let target = record.target().replace('\\', "\\\\").replace('"', "\\\"");
                    let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
                    out.finish(format_args!(
                        r#"{{"ts":"{ts}","level":"{level}","target":"{target}","msg":"{msg}"}}"#,
                        ts = ts,
                        level = record.level(),
                        target = target,
                        msg = msg,
                    ));
                })
                .targets([
                    // Log file: ~/Library/Logs/com.clawz.app/ClawZ.log
                    Target::new(TargetKind::LogDir { file_name: None }),
                    // Stdout (terminal when launched from CLI)
                    Target::new(TargetKind::Stdout).filter(move |meta| {
                        meta.level() <= stdout_level
                    }),
                    // Webview console (accessible via DevTools)
                    // Filter to Info+ to avoid deadlock: debug logs sent to webview
                    // from within IPC handlers can block when the webview is waiting
                    // for the IPC response.
                    Target::new(TargetKind::Webview).filter(move |meta| {
                        meta.level() <= stdout_level
                    }),
                ])
                .build()
        })
        .invoke_handler(tauri::generate_handler![
            commands::env_check::run_env_check,
            commands::env_check::check_openclaw_installed,

            commands::env_check::auto_fix_env,
            commands::env_check::rename_stale_openclaw_dir,
            commands::gateway::get_gateway_status,
            commands::gateway::start_gateway,
            commands::gateway::stop_gateway,
            commands::gateway::restart_gateway,
            commands::gateway::run_doctor,
            commands::system::get_system_info,
            commands::system::frontend_log,
            commands::installer::install_openclaw,
            commands::installer::uninstall_openclaw,
            commands::installer::install_cli_symlink,
            commands::installer::uninstall_cli_symlink,
            commands::model::validate_api_key,
            commands::model::configure_provider,
            commands::model::start_oauth_flow,
            commands::model::cancel_oauth_flow,
            commands::model::fetch_provider_models,
            commands::model::get_models_status,
            commands::model::list_configured_models,
            commands::model::list_all_available_models,
            commands::model::set_default_model,
            commands::model::add_model_fallback,
            commands::model::remove_model_fallback,
            commands::model::remove_provider,
            commands::channel::add_channel,
            commands::channel::disable_channel,
            commands::channel::remove_channel_account,
            commands::channel::install_channel_plugin,
            commands::channel::validate_channel_credentials,
            commands::channel::list_channel_accounts,
            commands::config::read_openclaw_config,
            commands::logs::read_gateway_logs,
            commands::logs::read_app_logs,
            commands::agents::list_agents,
            commands::agents::create_agent,
            commands::agents::delete_agent,
            commands::agents::get_agent_bindings,
            commands::agents::bind_agent_channel,
            commands::agents::unbind_agent_channel,
            commands::agents::set_agent_model,
            commands::agents::list_agent_sessions,
            commands::config::set_config_value,
            commands::cron::list_cron_jobs,
            commands::cron::create_cron_job,
            commands::cron::edit_cron_job,
            commands::cron::delete_cron_job,
            commands::cron::enable_cron_job,
            commands::cron::disable_cron_job,
            commands::cron::get_cron_runs,
            commands::scenario::apply_scenario,
            commands::scenario::read_agent_persona,
            commands::scenario::set_tools_profile,
            commands::scenario::enable_scenario_skills,
            commands::scenario::list_skills,
            commands::scenario::set_skill_enabled,
            commands::scenario::set_trusted_sources,
            commands::scenario::get_trusted_sources,
            commands::scenario::install_skill_deps,
            commands::usage::compute_usage_stats,
            commands::backup::export_config,
            commands::backup::precheck_backup,
            commands::backup::import_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
