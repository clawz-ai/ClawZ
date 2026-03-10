use serde_json::Value;
use super::model::oc_config_set;

/// Resolve the openclaw config file path (~/.openclaw/openclaw.json).
fn resolve_config_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| {
        log::error!("[config] failed to get HOME: {}", e);
        "Failed to get HOME directory".to_string()
    })?;
    Ok(std::path::PathBuf::from(home)
        .join(".openclaw")
        .join("openclaw.json"))
}

/// Read the full openclaw.json config and return it as JSON.
#[tauri::command]
pub async fn read_openclaw_config() -> Result<Value, String> {
    let config_path = resolve_config_path()?;
    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| {
            log::error!(
                "[read_openclaw_config] failed to read config file {}: {}",
                config_path.display(),
                e
            );
            format!("Failed to read config file: {}", e)
        })?;
    let root: Value = super::cli::parse_json(&content, "read_openclaw_config")?;
    Ok(root)
}

/// Set a config value via `openclaw config set`.
#[tauri::command]
pub async fn set_config_value(path: String, value: String) -> Result<String, String> {
    log::info!("[set_config_value] path={}, value={}", path, value);
    oc_config_set(&path, &value).await?;
    log::info!("[set_config_value] config {} updated", path);
    Ok(format!("Config {} updated", path))
}
