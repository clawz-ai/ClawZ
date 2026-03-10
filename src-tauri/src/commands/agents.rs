use serde::Serialize;
use serde_json::Value;
use std::path::Path;

use super::cli::{oc_run as oc_run_shared, parse_json, shell_escape};

async fn oc_run(args: &str) -> Result<String, String> {
    oc_run_shared("agents", args).await
}

#[derive(Debug, Serialize)]
pub struct AgentInfo {
    pub id: String,
    pub workspace: String,
    pub bindings: u32,
    pub is_default: bool,
    pub identity_name: String,
    pub identity_emoji: String,
    pub agent_dir: String,
    pub created_at: String,
    pub model: String,
}

/// List agents by running `openclaw agents list --json`.
#[tauri::command]
pub async fn list_agents() -> Result<Vec<AgentInfo>, String> {
    log::info!("fetching agent list");
    let stdout = oc_run("agents list --json").await?;
    let arr: Value = parse_json(&stdout, "list_agents")?;

    let agents = arr
        .as_array()
        .ok_or("agents list is not an array")?
        .iter()
        .map(|item| {
            let agent_dir = item
                .get("agentDir")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // Derive created_at from the agent parent directory's birth time
            let created_at = if !agent_dir.is_empty() {
                Path::new(&agent_dir)
                    .parent()
                    .and_then(|p| std::fs::metadata(p).ok())
                    .and_then(|m| m.created().ok())
                    .map(|t| {
                        let dt: chrono::DateTime<chrono::Local> = t.into();
                        dt.format("%Y-%m-%d %H:%M").to_string()
                    })
                    .unwrap_or_default()
            } else {
                String::new()
            };
            // Per-agent model: try JSON output first, then agent settings file
            let mut model = item
                .get("model")
                .or_else(|| item.get("defaultModel"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if model.is_empty() && !agent_dir.is_empty() {
                let settings_path = Path::new(&agent_dir).join("settings.json");
                if let Ok(content) = std::fs::read_to_string(&settings_path) {
                    if let Ok(settings) = serde_json::from_str::<Value>(&content) {
                        model = settings
                            .pointer("/model")
                            .or_else(|| settings.pointer("/defaults/model"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                    }
                }
            }

            AgentInfo {
                id: item
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                workspace: item
                    .get("workspace")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                bindings: item
                    .get("bindings")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32,
                is_default: item
                    .get("isDefault")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                identity_name: item
                    .get("identityName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                identity_emoji: item
                    .get("identityEmoji")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                agent_dir,
                created_at,
                model,
            }
        })
        .collect();

    Ok(agents)
}

// ── A. Create / Delete ──

/// Create a new agent via `openclaw agents add`.
#[tauri::command]
pub async fn create_agent(
    name: String,
    workspace: Option<String>,
    model: Option<String>,
    bindings: Vec<String>,
) -> Result<Value, String> {
    log::info!("[create_agent] name={}, workspace={:?}, model={:?}, bindings={:?}", name, workspace, model, bindings);
    let mut args = format!("agents add {} --non-interactive --json", shell_escape(&name));
    // --non-interactive requires --workspace; auto-generate if not provided
    let ws = workspace.unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let safe_name: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("{}/.openclaw/workspaces/{}_{}", home, safe_name, ts)
    });
    if let Err(e) = std::fs::create_dir_all(&ws) {
        log::error!("[create_agent] failed to create workspace {}: {}", ws, e);
        return Err(format!("Failed to create workspace: {}", e));
    }
    args.push_str(&format!(" --workspace {}", shell_escape(&ws)));
    if let Some(ref m) = model {
        args.push_str(&format!(" --model {}", shell_escape(m)));
    }
    for b in &bindings {
        args.push_str(&format!(" --bind {}", shell_escape(b)));
    }
    let stdout = oc_run(&args).await?;
    log::info!("[create_agent] agent '{}' created successfully", name);
    parse_json(&stdout, "create_agent")
}

/// Delete an agent via `openclaw agents delete --force`.
#[tauri::command]
pub async fn delete_agent(agent_id: String) -> Result<String, String> {
    log::info!("[delete_agent] agent_id={}", agent_id);
    oc_run(&format!(
        "agents delete {} --force --json",
        shell_escape(&agent_id)
    ))
    .await
}

// ── C. Routing Bindings ──

/// Get bindings for a specific agent.
#[tauri::command]
pub async fn get_agent_bindings(agent_id: String) -> Result<Value, String> {
    log::info!("[get_agent_bindings] agent_id={}", agent_id);
    let stdout = oc_run(&format!(
        "agents bindings --agent {} --json",
        shell_escape(&agent_id)
    ))
    .await?;
    parse_json(&stdout, "get_agent_bindings")
}

/// Bind a routing spec to an agent.
///
/// `binding_spec` accepts:
///   - "telegram"       → channel-only
///   - "telegram:ops"   → channel:accountId
#[tauri::command]
pub async fn bind_agent_channel(agent_id: String, binding_spec: String) -> Result<String, String> {
    log::info!("[bind_agent_channel] agent_id={}, spec={}", agent_id, binding_spec);
    oc_run(&format!(
        "agents bind --agent {} --bind {} --json",
        shell_escape(&agent_id),
        shell_escape(&binding_spec)
    ))
    .await
}

/// Unbind a routing spec from an agent.
///
/// `binding_spec` accepts the same formats as bind.
#[tauri::command]
pub async fn unbind_agent_channel(agent_id: String, binding_spec: String) -> Result<String, String> {
    log::info!("[unbind_agent_channel] agent_id={}, spec={}", agent_id, binding_spec);
    oc_run(&format!(
        "agents unbind --agent {} --bind {} --json",
        shell_escape(&agent_id),
        shell_escape(&binding_spec)
    ))
    .await
}

// ── E. Per-agent Model ──

/// Set the model for a specific agent.
///
/// Reads the config to find the agent index, then writes via `config set agents.list.{idx}.model`.
#[tauri::command]
pub async fn set_agent_model(agent_id: String, model: String) -> Result<String, String> {
    log::info!("[set_agent_model] agent_id={}, model={}", agent_id, model);

    // Read config to find agent index
    let config = super::config::read_openclaw_config().await?;
    let list = config
        .pointer("/agents/list")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Failed to read agents.list".to_string())?;

    let idx = list
        .iter()
        .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(&agent_id))
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

    let path = format!("agents.list.{}.model", idx);
    super::model::oc_config_set(&path, &model).await?;
    log::info!("[set_agent_model] agent '{}' model updated to {}", agent_id, model);
    Ok(format!("Agent {} model updated to {}", agent_id, model))
}

// ── F. Sessions & Stats ──

/// List sessions for a specific agent by reading sessions.json.
#[tauri::command]
pub async fn list_agent_sessions(agent_id: String) -> Result<Value, String> {
    log::info!("[list_agent_sessions] agent_id={}", agent_id);
    let home = std::env::var("HOME").map_err(|e| {
        log::error!("[list_agent_sessions] failed to get HOME: {}", e);
        "Failed to get HOME directory".to_string()
    })?;
    let sessions_file = std::path::PathBuf::from(&home)
        .join(".openclaw/agents")
        .join(&agent_id)
        .join("sessions/sessions.json");

    if !sessions_file.exists() {
        return Ok(Value::Array(vec![]));
    }

    let content = tokio::fs::read_to_string(&sessions_file)
        .await
        .map_err(|e| {
            log::error!("[list_agent_sessions] failed to read sessions.json: {}", e);
            format!("Failed to read sessions.json: {}", e)
        })?;

    parse_json(&content, "list_agent_sessions")
}
