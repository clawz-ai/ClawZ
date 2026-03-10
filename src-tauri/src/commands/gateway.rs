use serde::Serialize;
use serde_json::Value;
use std::process::Stdio;
#[allow(unused_imports)]
use tokio::time::{timeout, Duration};

use super::cli::{oc_run, oc_run_raw, user_shell, with_rc, bg_command};

#[derive(Debug, Serialize)]
pub struct GatewayInfo {
    pub running: bool,
    pub url: String,
    pub uptime: String,
}

#[derive(Debug, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_tokens: u64,
}

#[derive(Debug, Serialize)]
pub struct AgentsInfo {
    pub count: u32,
    pub list: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ChannelsInfo {
    pub configured: Vec<String>,
    pub enabled: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SecurityInfo {
    pub critical: u32,
    pub warnings: u32,
    pub info: u32,
    pub findings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SessionsInfo {
    pub total: u32,
}

#[derive(Debug, Serialize)]
pub struct StatusData {
    pub gateway: GatewayInfo,
    pub model: ModelInfo,
    pub agents: AgentsInfo,
    pub channels: ChannelsInfo,
    pub security: SecurityInfo,
    pub sessions: SessionsInfo,
}

/// Convert a raw model id like "deepseek-chat" into a friendlier name like "DeepSeek Chat".
fn prettify_model_id(id: &str) -> String {
    if id == "未配置" || id.is_empty() {
        return id.to_string();
    }
    id.split(['-', '_'])
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    let upper: String = first.to_uppercase().collect();
                    format!("{}{}", upper, chars.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Try to detect gateway process uptime by finding the process listening on
/// the gateway port and reading its elapsed time via `ps`.
/// Uses shell because it relies on system tools (lsof, ps), not openclaw CLI.
async fn detect_gateway_uptime(gw_url: &str) -> String {
    // Extract port from URL like "ws://127.0.0.1:18789"
    let port = gw_url
        .rsplit(':')
        .next()
        .and_then(|p| p.trim_end_matches('/').parse::<u16>().ok())
        .unwrap_or(18789);

    // Find PID listening on gateway port, then get its elapsed time
    let cmd = format!(
        "lsof -ti tcp:{} -sTCP:LISTEN 2>/dev/null | head -1 | xargs -I{{}} ps -o etime= -p {{}} 2>/dev/null",
        port
    );
    let wrapped = with_rc(&cmd);
    let output = bg_command(user_shell())
        .args(["-l", "-c", &wrapped])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let raw = String::from_utf8_lossy(&o.stdout).trim().to_string();
            format_etime(&raw)
        }
        Ok(o) => {
            log::debug!("detect_gateway_uptime: command exit code {}", o.status);
            String::new()
        }
        Err(e) => {
            log::warn!("detect_gateway_uptime: execution failed: {}", e);
            String::new()
        }
    }
}

/// Convert `ps -o etime` output like "3-12:30:45", "12:30:45", "30:45", "45"
/// into a locale-neutral string like "3d12h", "5h30m", "10m".
/// Frontend is responsible for translating d/h/m units.
fn format_etime(etime: &str) -> String {
    if etime.is_empty() {
        return String::new();
    }
    let (days, hms) = if let Some(idx) = etime.find('-') {
        let d: u64 = etime[..idx].trim().parse().unwrap_or(0);
        (d, &etime[idx + 1..])
    } else {
        (0, etime)
    };

    let parts: Vec<u64> = hms
        .split(':')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let (hours, minutes) = match parts.len() {
        3 => (parts[0], parts[1]),
        2 => (0, parts[0]),
        _ => return String::new(),
    };

    let total_hours = days * 24 + hours;
    if total_hours >= 24 {
        let d = total_hours / 24;
        let h = total_hours % 24;
        if h > 0 {
            format!("{}d{}h", d, h)
        } else {
            format!("{}d", d)
        }
    } else if total_hours > 0 {
        if minutes > 0 {
            format!("{}h{}m", total_hours, minutes)
        } else {
            format!("{}h", total_hours)
        }
    } else {
        format!("{}m", minutes.max(1))
    }
}

// ── Service conflict resolution ───────────────────────────────────────
// Before installing our bundled gateway service, evict any pre-existing
// system-installed gateway to prevent port conflicts and stale plists.

const GATEWAY_PORT: u16 = 18789;

/// Unload any existing gateway system service, then kill orphaned processes
/// on the gateway port. Best-effort — failures are logged but not fatal.
async fn evict_existing_gateway() {
    evict_system_service().await;
    kill_port_holders(GATEWAY_PORT).await;
}

/// Platform-specific system service unload.
async fn evict_system_service() {
    #[cfg(target_os = "macos")]
    {
        let uid = unsafe { libc::getuid() };
        let target = format!("gui/{}/ai.openclaw.gateway", uid);

        // Check if service is loaded
        let loaded = bg_command("launchctl")
            .args(["print", &target])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);

        if loaded {
            log::info!("found loaded gateway service, unloading: {}", target);
            match timeout(
                Duration::from_secs(10),
                bg_command("launchctl")
                    .args(["bootout", &target])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output(),
            )
            .await
            {
                Ok(Ok(o)) => log::info!("launchctl bootout: exit={}", o.status),
                Ok(Err(e)) => log::warn!("launchctl bootout failed: {}", e),
                Err(_) => log::warn!("launchctl bootout timed out (10s)"),
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let _ = bg_command("systemctl")
            .args(["--user", "stop", "openclaw-gateway.service"])
            .output()
            .await;
        let _ = bg_command("systemctl")
            .args(["--user", "disable", "openclaw-gateway.service"])
            .output()
            .await;
    }

    #[cfg(target_os = "windows")]
    {
        // Windows scheduled task name used by openclaw
        let _ = bg_command("schtasks")
            .args(["/End", "/TN", "OpenClaw Gateway"])
            .output()
            .await;
    }
}

/// Kill any process listening on the given TCP port.
async fn kill_port_holders(port: u16) {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let cmd = format!(
            "lsof -ti tcp:{} -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null",
            port
        );
        match bg_command(user_shell())
            .args(["-c", &cmd])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
        {
            Ok(s) => {
                if s.success() {
                    log::info!("cleaned up orphaned process on port {}", port);
                }
            }
            Err(e) => log::debug!("port cleanup failed (non-fatal): {}", e),
        }
    }

    #[cfg(target_os = "windows")]
    {
        // netstat + taskkill on Windows
        let cmd = format!(
            "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a",
            port
        );
        let _ = bg_command("cmd")
            .args(["/C", &cmd])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
}

/// Run `openclaw status --json` and parse the rich status data.
#[tauri::command]
pub async fn get_gateway_status() -> Result<StatusData, String> {
    let json_str = oc_run("gateway_status", "status --json").await?;
    let root: Value = super::cli::parse_json(&json_str, "get_gateway_status")?;

    // Gateway
    let gw_running = root
        .pointer("/gateway/reachable")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let gw_url = root
        .pointer("/gateway/url")
        .and_then(|v| v.as_str())
        .unwrap_or("ws://127.0.0.1:18789")
        .to_string();
    // Try to parse uptime from JSON first, then fall back to process-based detection
    let mut gw_uptime = root
        .pointer("/gateway/uptime")
        .and_then(|v| v.as_str())
        .or_else(|| root.pointer("/uptime").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    // If no uptime from JSON and gateway is running, try to get it from the process
    if gw_uptime.is_empty() && gw_running {
        gw_uptime = detect_gateway_uptime(&gw_url).await;
    }

    // Model — lives under sessions.defaults
    let model_id = root
        .pointer("/sessions/defaults/model")
        .and_then(|v| v.as_str())
        .unwrap_or("未配置")
        .to_string();
    // Try to get a friendly display name; fall back to prettifying the model id
    let model_name = root
        .pointer("/sessions/defaults/modelName")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| prettify_model_id(&model_id));
    let context_tokens = root
        .pointer("/sessions/defaults/contextTokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // Agents
    let agent_count = root
        .pointer("/agents/agents")
        .and_then(|v| v.as_array())
        .map(|a| a.len() as u64)
        .unwrap_or(0) as u32;
    let agent_list: Vec<String> = root
        .pointer("/agents/agents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    item.get("id")
                        .or_else(|| item.get("name"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                })
                .collect()
        })
        .unwrap_or_default();

    // Channels — parse from channelSummary text lines
    // Format: "Telegram: configured" or "Telegram: ok (@bot)"
    let mut configured = Vec::new();
    let mut enabled = Vec::new();
    if let Some(summary) = root.get("channelSummary").and_then(|v| v.as_array()) {
        for line in summary {
            if let Some(s) = line.as_str() {
                // Skip indented sub-lines (start with spaces)
                if s.starts_with(' ') {
                    continue;
                }
                // Parse "ChannelName: status"
                if let Some(colon) = s.find(':') {
                    let name = s[..colon].trim().to_lowercase();
                    let status_part = s[colon + 1..].trim();
                    configured.push(name.clone());
                    // "ok" or "configured" means enabled
                    if status_part.starts_with("ok") || status_part.starts_with("configured") {
                        enabled.push(name);
                    }
                }
            }
        }
    }

    // Security — at /securityAudit
    let critical = root
        .pointer("/securityAudit/summary/critical")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let warnings = root
        .pointer("/securityAudit/summary/warn")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let info_count = root
        .pointer("/securityAudit/summary/info")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let mut findings = Vec::new();
    if let Some(sec) = root.pointer("/securityAudit/findings").and_then(|v| v.as_array()) {
        for finding in sec {
            let severity = finding
                .get("severity")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = finding
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !title.is_empty() {
                findings.push(format!("[{}] {}", severity, title));
            }
        }
    }

    // Sessions
    let session_total = root
        .pointer("/agents/totalSessions")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    Ok(StatusData {
        gateway: GatewayInfo {
            running: gw_running,
            url: gw_url,
            uptime: gw_uptime,
        },
        model: ModelInfo {
            id: model_id,
            name: model_name,
            context_tokens,
        },
        agents: AgentsInfo {
            count: agent_count,
            list: agent_list,
        },
        channels: ChannelsInfo {
            configured,
            enabled,
        },
        security: SecurityInfo {
            critical,
            warnings,
            info: info_count,
            findings,
        },
        sessions: SessionsInfo {
            total: session_total,
        },
    })
}

/// Run `openclaw doctor` and return the raw output.
/// Uses a 15-second timeout to prevent hanging if the command requires interaction.
#[tauri::command]
pub async fn run_doctor() -> Result<String, String> {
    oc_run_raw("doctor", "doctor", Some(15)).await
}

#[tauri::command]
pub async fn start_gateway() -> Result<String, String> {
    log::info!("starting gateway");

    // Ensure gateway.mode=local is set — required since openclaw v2026.3.8.
    // Without this, the gateway daemon refuses to start with
    // "Gateway start blocked: set gateway.mode=local".
    if let Err(e) = super::model::oc_config_set("gateway.mode", "local").await {
        log::warn!("failed to set gateway.mode=local: {}", e);
    }

    // Evict any pre-existing gateway service (e.g. installed by system openclaw)
    // and kill orphaned processes on the gateway port.
    evict_existing_gateway().await;

    // Install our launchd/systemd service pointing to the bundled runtime,
    // then start it.
    if let Err(e) = oc_run_raw("gateway_install", "gateway install", None).await {
        log::warn!("gateway install output: {}", e);
    }

    oc_run_raw("gateway_start", "gateway start", None).await
}

#[tauri::command]
pub async fn restart_gateway() -> Result<String, String> {
    oc_run_raw("gateway_restart", "gateway restart", None).await
}

#[tauri::command]
pub async fn stop_gateway() -> Result<String, String> {
    oc_run_raw("gateway_stop", "gateway stop", None).await
}
