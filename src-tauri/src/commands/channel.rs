use std::collections::HashMap;

use super::cli::{oc_run as oc_run_shared, oc_run_raw, shell_escape};
use super::model::{oc_config_set, mask_secret, mask_url_secret};

async fn oc_run(args: &str) -> Result<String, String> {
    oc_run_shared("channel", args).await
}

/// Validate channel credentials before saving config.
/// Currently supports Telegram (getMe) and Discord (users/@me).
#[tauri::command]
pub async fn validate_channel_credentials(
    channel_id: String,
    config: HashMap<String, String>,
) -> Result<String, String> {
    log::info!("[validate_channel] channel={}, config_keys={:?}", channel_id, config.keys().collect::<Vec<_>>());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    match channel_id.as_str() {
        "telegram" => {
            let token = config
                .get("botToken")
                .ok_or_else(|| {
                    log::error!("[validate_channel] telegram: missing botToken field");
                    "Missing botToken field".to_string()
                })?;
            let url = format!("https://api.telegram.org/bot{}/getMe", token);
            log::info!("[validate_channel] telegram GET {}", mask_url_secret(&url));
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| {
                    log::error!("[validate_channel] telegram request failed: {}", e);
                    format!("Network request failed: {}", e)
                })?;
            let status = resp.status().as_u16();
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| {
                    log::error!("[validate_channel] telegram: failed to parse response: {}", e);
                    format!("Failed to parse response: {}", e)
                })?;
            log::info!("[validate_channel] telegram response: status={}, ok={:?}", status, json.get("ok"));
            if json.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                let bot_name = json
                    .get("result")
                    .and_then(|r| r.get("username"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("unknown");
                log::info!("[validate_channel] telegram bot verified: @{}", bot_name);
                Ok(format!("Telegram Bot verified: @{}", bot_name))
            } else {
                let desc = json
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("Unknown error");
                log::warn!("[validate_channel] telegram validation failed: {}", desc);
                Err(format!("Telegram Bot Token invalid: {}", desc))
            }
        }
        "discord" => {
            let token = config
                .get("token")
                .ok_or_else(|| {
                    log::error!("[validate_channel] discord: missing token field");
                    "Missing token field".to_string()
                })?;
            log::info!("[validate_channel] discord GET users/@me, token={}", mask_secret(token));
            let resp = client
                .get("https://discord.com/api/v10/users/@me")
                .header("Authorization", format!("Bot {}", token))
                .send()
                .await
                .map_err(|e| {
                    log::error!("[validate_channel] discord request failed: {}", e);
                    format!("Network request failed: {}", e)
                })?;
            let status = resp.status().as_u16();
            log::info!("[validate_channel] discord response: status={}", status);
            if resp.status().is_success() {
                let json: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| {
                        log::error!("[validate_channel] discord JSON parse failed: {}", e);
                        format!("Failed to parse response: {}", e)
                    })?;
                let bot_name = json
                    .get("username")
                    .and_then(|u| u.as_str())
                    .unwrap_or("unknown");
                log::info!("[validate_channel] discord bot verified: {}", bot_name);
                Ok(format!("Discord Bot verified: {}", bot_name))
            } else {
                let body = resp.text().await.unwrap_or_else(|e| {
                    log::warn!("[validate_channel] failed to read discord error response body: {}", e);
                    String::new()
                });
                log::warn!("[validate_channel] discord validation failed: status={}, body={}", status, body);
                Err(format!("Discord Bot Token invalid (HTTP {}): {}", status, body))
            }
        }
        _ => {
            log::info!("[validate_channel] {} no validation needed, skipping", channel_id);
            // No validation available for this channel — pass through
            Ok(format!("{} channel does not require validation", channel_id))
        }
    }
}

/// Map a frontend field key to the corresponding `openclaw channels add` CLI flag.
fn field_to_cli_flag(channel_id: &str, key: &str) -> Option<&'static str> {
    match (channel_id, key) {
        // Telegram & Discord — both use --token
        ("telegram", "botToken") | ("discord", "token") => Some("--token"),
        // Slack
        ("slack", "botToken") => Some("--bot-token"),
        ("slack", "appToken") => Some("--app-token"),
        // Signal
        ("signal", "account") => Some("--signal-number"),
        ("signal", "httpUrl") => Some("--http-url"),
        // Matrix
        ("matrix", "homeserver") => Some("--homeserver"),
        ("matrix", "userId") => Some("--user-id"),
        ("matrix", "password") => Some("--password"),
        // Google Chat
        ("googlechat", "serviceAccount") => Some("--access-token"),
        ("googlechat", "audience") => Some("--audience"),
        // Mattermost, LINE, Nostr — all use --token
        ("mattermost", "token") | ("line", "token") | ("nostr", "privateKey") => Some("--token"),
        // MS Teams
        ("msteams", "appId") => Some("--bot-token"),
        ("msteams", "appPassword") => Some("--password"),
        // IRC
        ("irc", "host") => Some("--http-host"),
        ("irc", "nick") => Some("--name"),
        _ => None,
    }
}

/// Add or update a channel account using `openclaw channels add`.
///
/// Uses the official CLI for proper multi-account support.
/// Falls back to `config set` for fields that have no CLI flag (e.g. feishu).
#[tauri::command]
pub async fn add_channel(
    channel_id: String,
    config: HashMap<String, String>,
    allow_from: Vec<String>,
) -> Result<String, String> {
    let account_id = config.get("__accountId").cloned().unwrap_or_default();
    let target_agent = config.get("__targetAgent").cloned().unwrap_or_default();
    let account_name = config.get("__accountName").cloned().unwrap_or_default();
    let skip_auto_bind = config.get("__skipAutoBind").map(|v| v == "1").unwrap_or(false);

    log::info!("[add_channel] channel={}, account={}, config_keys={:?}, allow_from={:?}",
        channel_id, account_id, config.keys().collect::<Vec<_>>(), allow_from);

    // Ensure the channel plugin is enabled before adding
    log::info!("[add_channel] enabling plugin: {}", channel_id);
    match oc_run_raw("channel_enable", &format!("plugins enable {}", shell_escape(&channel_id)), None).await {
        Ok(out) => log::info!("[add_channel] plugin enabled: {}", out.trim()),
        Err(e) => {
            // Ignore "already enabled" — only fail on real errors
            if !e.contains("already") {
                log::warn!("[add_channel] plugin enable warning: {}", e);
            }
        }
    }

    // Build `openclaw channels add` args
    let mut cmd_parts = vec![
        "channels".to_string(),
        "add".to_string(),
        "--channel".to_string(),
        channel_id.clone(),
    ];

    if !account_id.is_empty() {
        cmd_parts.push("--account".to_string());
        cmd_parts.push(account_id.clone());
    }

    if !account_name.is_empty() {
        cmd_parts.push("--name".to_string());
        cmd_parts.push(account_name);
    }

    // Collect fields that have CLI flag mappings
    let mut remaining_fields: Vec<(&String, &String)> = Vec::new();
    for (key, value) in &config {
        if key.starts_with("__") { continue; } // skip internal keys
        if let Some(flag) = field_to_cli_flag(&channel_id, key) {
            cmd_parts.push(flag.to_string());
            cmd_parts.push(value.clone());
        } else {
            remaining_fields.push((key, value));
        }
    }

    // Execute via bundled openclaw
    let args_str = cmd_parts.iter()
        .map(|p| shell_escape(p))
        .collect::<Vec<_>>()
        .join(" ");
    log::info!("[add_channel] running: openclaw channels add --channel {} ...", channel_id);

    let stdout = oc_run_raw("channel_add", &args_str, None).await
        .map_err(|e| format!("Failed to add channel: {}", e))?;
    log::info!("[add_channel] CLI success: {}", stdout.trim());

    // Write remaining fields + policies directly to config file (single file I/O)
    // instead of multiple sequential `openclaw config set` CLI calls
    let prefix = if !account_id.is_empty() && account_id != "default" {
        format!("channels.{}.accounts.{}", channel_id, account_id)
    } else {
        format!("channels.{}", channel_id)
    };

    let has_remaining = !remaining_fields.is_empty() || channel_id == "feishu" || !allow_from.is_empty();
    if has_remaining {
        let home = std::env::var("HOME").map_err(|e| format!("Failed to get HOME: {}", e))?;
        let config_path = std::path::PathBuf::from(&home).join(".openclaw/openclaw.json");
        let content = tokio::fs::read_to_string(&config_path).await
            .map_err(|e| format!("Failed to read config file: {}", e))?;
        let mut root: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config file: {}", e))?;

        // Navigate to the target object using the prefix path
        let parts: Vec<&str> = prefix.split('.').collect();
        let mut target = &mut root;
        for part in &parts {
            if !target.is_object() {
                *target = serde_json::json!({});
            }
            target = target.as_object_mut().unwrap()
                .entry(part.to_string())
                .or_insert(serde_json::json!({}));
        }

        if let Some(obj) = target.as_object_mut() {
            // Write remaining fields
            for (key, value) in &remaining_fields {
                obj.insert((*key).clone(), serde_json::Value::String((*value).clone()));
            }

            // Set policies
            if channel_id == "feishu" {
                obj.insert("dmPolicy".to_string(), serde_json::json!("open"));
                obj.insert("allowFrom".to_string(), serde_json::json!(["*"]));
                obj.insert("groupPolicy".to_string(), serde_json::json!("allowlist"));
            } else if !allow_from.is_empty() {
                obj.insert("allowFrom".to_string(), serde_json::json!(allow_from));
                obj.insert("dmPolicy".to_string(), serde_json::json!("allowlist"));
                obj.insert("groupPolicy".to_string(), serde_json::json!("allowlist"));
            }
        }

        let json_str = serde_json::to_string_pretty(&root)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        tokio::fs::write(&config_path, json_str).await
            .map_err(|e| format!("Failed to write config file: {}", e))?;
        log::info!("[add_channel] wrote remaining fields + policies to config directly");
    }

    // Auto-bind to agent (skip for additional accounts unless explicitly targeted).
    // Always use account-level bind spec (channel:accountId) to avoid channel-level
    // bindings that block all future accounts under the same channel.
    let effective_account = if !account_id.is_empty() {
        account_id.clone()
    } else {
        "default".to_string()
    };
    let bind_spec = format!("{}:{}", channel_id, effective_account);

    if !skip_auto_bind {
        let agent = if target_agent.is_empty() { "main" } else { &target_agent };
        match oc_run(&format!(
            "agents bind --agent {} --bind {} --json",
            shell_escape(agent),
            shell_escape(&bind_spec)
        )).await {
            Ok(_) => log::info!("[add_channel] bound {} to agent {}", bind_spec, agent),
            Err(e) => log::warn!("[add_channel] failed to bind {} to agent {}: {}", bind_spec, agent, e),
        }
    } else {
        // CLI's `channels add` may auto-bind to "main" — undo it so the account
        // stays free for the caller (e.g. Create Agent wizard) to bind later.
        // Only unbind the specific new account — do NOT unbind at channel level,
        // as that would remove existing bindings for other accounts.
        log::info!("[add_channel] skip_auto_bind: ensuring {} is unbound", bind_spec);
        let agents_raw = oc_run_shared("agents", "agents list --json").await.unwrap_or_default();
        let agent_ids = extract_agent_ids(&agents_raw);
        unbind_specs_from_all_agents(&[bind_spec], &agent_ids, "add_channel").await;
    }

    log::info!("[add_channel] {} channel configured successfully", channel_id);
    Ok(format!("{} channel configured successfully", channel_id))
}

/// Collect all bind specs for a channel by reading config directly (no CLI calls).
/// Returns account-level specs like ["telegram:bot1", "telegram:bot2"] or ["telegram"]
/// for flat-config channels.
fn collect_channel_bind_specs(channel_id: &str) -> Vec<String> {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return vec![channel_id.to_string()],
    };
    let config_path = std::path::Path::new(&home).join(".openclaw/openclaw.json");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return vec![channel_id.to_string()],
    };
    let root: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return vec![channel_id.to_string()],
    };

    let mut specs = Vec::new();
    if let Some(accounts) = root.pointer(&format!("/channels/{}/accounts", channel_id))
        .and_then(|v| v.as_object())
    {
        for acct_id in accounts.keys() {
            if acct_id == "default" {
                specs.push(channel_id.to_string());
            } else {
                specs.push(format!("{}:{}", channel_id, acct_id));
            }
        }
    }
    if specs.is_empty() {
        specs.push(channel_id.to_string());
    }
    specs
}

/// Extract agent IDs from a JSON agent list string.
fn extract_agent_ids(agents_raw: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(agents_raw)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|a| a.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect()
}

/// Unbind a set of bind specs from all agents concurrently.
async fn unbind_specs_from_all_agents(bind_specs: &[String], agent_ids: &[String], tag: &str) {
    let mut handles = Vec::new();
    for aid in agent_ids {
        for spec in bind_specs {
            let aid = aid.clone();
            let spec = spec.clone();
            let tag = tag.to_string();
            handles.push(tokio::spawn(async move {
                let cmd = format!("agents unbind --agent {} --bind {} --json",
                    shell_escape(&aid), shell_escape(&spec));
                match oc_run_shared("agents", &cmd).await {
                    Ok(_) => log::info!("[{}] unbound {} from agent {}", tag, spec, aid),
                    Err(e) => log::warn!("[{}] failed to unbind {} from {}: {}", tag, spec, aid, e),
                }
            }));
        }
    }
    for h in handles {
        let _ = h.await;
    }
}

/// Disable a channel: set enabled=false and unbind it from all agents.
#[tauri::command]
pub async fn disable_channel(channel_id: String) -> Result<String, String> {
    log::info!("[disable_channel] channel={}", channel_id);
    let prefix = format!("channels.{}", channel_id);
    oc_config_set(&format!("{}.enabled", prefix), "false").await?;

    // Read config directly for account IDs (instant file read, no CLI call)
    let bind_specs = collect_channel_bind_specs(&channel_id);

    // Get agent list (single CLI call)
    let agents_raw = oc_run_shared("agents", "agents list --json").await.unwrap_or_default();
    let agent_ids = extract_agent_ids(&agents_raw);

    // Unbind all (agent, spec) pairs concurrently
    unbind_specs_from_all_agents(&bind_specs, &agent_ids, "disable_channel").await;

    log::info!("[disable_channel] {} disabled", channel_id);
    Ok(format!("{} channel disabled", channel_id))
}

/// Remove a specific channel account via `openclaw channels remove`.
#[tauri::command]
pub async fn remove_channel_account(
    channel_id: String,
    account_id: String,
) -> Result<String, String> {
    log::info!("[remove_channel_account] channel={}, account={}", channel_id, account_id);
    let args = format!(
        "channels remove --channel {} --account {} --delete",
        shell_escape(&channel_id),
        shell_escape(&account_id),
    );
    oc_run_raw("channel_remove", &args, None).await
        .map_err(|e| format!("Failed to delete account: {}", e))?;

    // Unbind from all agents concurrently
    let bind_spec = if !account_id.is_empty() && account_id != "default" {
        format!("{}:{}", channel_id, account_id)
    } else {
        channel_id.clone()
    };
    let agents_raw = oc_run_shared("agents", "agents list --json").await.unwrap_or_default();
    let agent_ids = extract_agent_ids(&agents_raw);
    unbind_specs_from_all_agents(&[bind_spec], &agent_ids, "remove_channel_account").await;

    log::info!("[remove_channel_account] {} account {} removed", channel_id, account_id);
    Ok(format!("{} account {} deleted", channel_id, account_id))
}

/// Read accounts configured under a channel from openclaw.json.
#[tauri::command]
pub async fn list_channel_accounts(channel_id: String) -> Result<serde_json::Value, String> {
    log::info!("[list_channel_accounts] channel={}", channel_id);
    let home = std::env::var("HOME").map_err(|e| {
        log::error!("[list_channel_accounts] failed to get HOME: {}", e);
        "Failed to get HOME directory".to_string()
    })?;
    let config_path = std::path::Path::new(&home).join(".openclaw/openclaw.json");
    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| {
            log::error!("[list_channel_accounts] failed to read config: {}", e);
            format!("Failed to read config: {}", e)
        })?;
    let root: serde_json::Value = super::cli::parse_json(&content, "list_channel_accounts")?;
    let accounts = root
        .pointer(&format!("/channels/{}/accounts", channel_id))
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    Ok(accounts)
}

/// Install a channel plugin via `openclaw plugins install <package>`.
#[tauri::command]
pub async fn install_channel_plugin(plugin: String) -> Result<String, String> {
    log::info!("installing channel plugin: {}", plugin);
    let args = format!("plugins install {}", shell_escape(&plugin));
    let result = oc_run_raw("plugin_install", &args, None).await;

    let stdout = match &result {
        Ok(out) => out.clone(),
        Err(e) => {
            // Check if this is an "already exists" case — treat as success
            if e.contains("already exists") {
                log::info!("plugin already exists: {}", plugin);
                String::new()
            } else {
                log::error!("plugin installation failed: {} - {}", plugin, e);
                return Err(format!("Plugin installation failed: {}", e));
            }
        }
    };

    log::info!("plugin ready: {}", plugin);

    let plugin_id = plugin.rsplit('/').next().unwrap_or(&plugin);

    // Post-install cleanup: edit openclaw.json directly because
    // `openclaw config unset` is unreliable for plugins.entries.
    if let Ok(home) = std::env::var("HOME") {
        let config_path = std::path::Path::new(&home).join(".openclaw/openclaw.json");
        if let Ok(content) = tokio::fs::read_to_string(&config_path).await {
            if let Ok(mut root) = serde_json::from_str::<serde_json::Value>(&content) {
                let mut changed = false;

                // 1. Remove plugins.entries.{id} — duplicates plugins.installs.{id}
                if let Some(entries) = root.pointer_mut("/plugins/entries") {
                    if let Some(obj) = entries.as_object_mut() {
                        if obj.remove(plugin_id).is_some() {
                            log::info!("cleaned up plugins.entries.{}", plugin_id);
                            changed = true;
                        }
                    }
                }

                // 2. Add plugin_id to plugins.allow if not already present
                let allow = root
                    .pointer_mut("/plugins/allow")
                    .and_then(|v| v.as_array_mut());
                if let Some(arr) = allow {
                    let id_val = serde_json::Value::String(plugin_id.to_string());
                    if !arr.contains(&id_val) {
                        arr.push(id_val);
                        log::info!("added {} to plugins.allow", plugin_id);
                        changed = true;
                    }
                } else {
                    // plugins.allow doesn't exist — create it
                    if let Some(plugins) = root.get_mut("plugins").and_then(|v| v.as_object_mut()) {
                        plugins.insert(
                            "allow".to_string(),
                            serde_json::json!([plugin_id]),
                        );
                        log::info!("created plugins.allow: [{}]", plugin_id);
                        changed = true;
                    }
                }

                if changed {
                    if let Ok(json_str) = serde_json::to_string_pretty(&root) {
                        if let Err(e) = tokio::fs::write(&config_path, json_str).await {
                            log::warn!("failed to write config file: {}", e);
                        }
                    }
                }
            }
        }
    }

    Ok(stdout.trim().to_string())
}
