use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use super::cli::bg_std_command;
use std::sync::{mpsc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const BUILD_MANIFEST_JSON: &str = include_str!("../../../build-manifest.json");
const DEFAULT_OPENCLAW_VERSION: &str = "2026.3.8";

fn pinned_openclaw_version() -> &'static str {
    static VERSION: OnceLock<String> = OnceLock::new();
    VERSION
        .get_or_init(|| {
            serde_json::from_str::<serde_json::Value>(BUILD_MANIFEST_JSON)
                .ok()
                .and_then(|manifest| {
                    manifest
                        .get("runtime")?
                        .get("openclaw")?
                        .get("version")?
                        .as_str()
                        .map(str::to_string)
                })
                .unwrap_or_else(|| DEFAULT_OPENCLAW_VERSION.to_string())
        })
        .as_str()
}

#[derive(Clone, Serialize)]
pub struct InstallProgress {
    pub step: usize,       // 0-based step index
    pub total: usize,      // total steps
    pub label: String,     // step description
    pub status: String,    // "running" | "done" | "error"
    pub percent: u32,      // overall progress 0-100
    pub message: String,   // detail message
    pub command: String,   // the shell command being executed
}

/// Strip ANSI escape sequences and carriage returns from terminal output
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip until we find a letter (end of escape sequence)
            for c2 in chars.by_ref() {
                if c2.is_ascii_alphabetic() {
                    break;
                }
            }
        } else if c == '\r' {
            // Skip carriage return (from progress bars)
        } else {
            result.push(c);
        }
    }
    result
}

use super::cli::{user_shell, with_rc};

/// Run a command via login shell, sourcing rc file for nvm/node PATH.
/// Does NOT use `-i` (interactive) to avoid terminal/job-control issues with pipes.
fn shell_run(cmd: &str) -> Result<String, String> {
    let shell = user_shell();
    let wrapped = with_rc(cmd);
    log::info!("[shell_run] shell={}, cmd={}", shell, cmd);
    let output = bg_std_command(&shell)
        .args(["-l", "-c", &wrapped])
        .output()
        .map_err(|e| format!("Failed to execute command: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    log::info!("[shell_run] exit={}, stdout_len={}, stderr_len={}", output.status, stdout.len(), stderr.len());
    log::debug!("[shell_run] stdout={}", &stdout[..stdout.len().min(500)]);
    if !stderr.is_empty() {
        log::debug!("[shell_run] stderr={}", &stderr[..stderr.len().min(500)]);
    }

    if output.status.success() {
        Ok(stdout)
    } else {
        // Prefer stderr for error info, fall back to stdout, then exit code
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Exit code {}", output.status.code().unwrap_or(-1))
        };
        log::error!("[shell_run] failed: {}", &detail[..detail.len().min(500)]);
        Err(detail)
    }
}

/// Run a command with streaming output — emits progress events as output lines arrive.
/// Merges stdout+stderr via `2>&1` so npm progress info is captured.
/// Sources rc file for nvm/node PATH; does NOT use `-i` to avoid pipe issues.
///
/// `idle_timeout_secs`: if no new output is received for this many seconds, the
/// process is considered stuck and will be killed. This is a **dynamic** timeout —
/// as long as the process keeps producing output, it can run indefinitely.
#[allow(clippy::too_many_arguments)]
fn shell_run_streaming(
    cmd: &str,
    app: &AppHandle,
    step: usize,
    total: usize,
    label: &str,
    base_percent: u32,
    target_percent: u32,
    idle_timeout_secs: u64,
) -> Result<String, String> {
    let shell = user_shell();
    let merged_cmd = with_rc(&format!("{cmd} 2>&1"));
    log::info!(
        "[shell_run_streaming] shell={}, cmd={}, idle_timeout={}s",
        shell, cmd, idle_timeout_secs
    );
    let mut child = bg_std_command(&shell)
        .args(["-l", "-c", &merged_cmd])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute command: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();

    // Read lines in a background thread so we can apply recv_timeout on the main thread
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let mut lines = Vec::new();
    let mut line_count = 0u32;
    let max_lines: u32 = 30; // estimate for gradual progress scaling
    let idle_timeout = Duration::from_secs(idle_timeout_secs);

    loop {
        match rx.recv_timeout(idle_timeout) {
            Ok(Ok(line)) => {
                let clean = strip_ansi(&line);
                if clean.trim().is_empty() {
                    continue;
                }
                line_count += 1;
                let frac = (line_count.min(max_lines) as f64) / (max_lines as f64);
                let progress =
                    base_percent + ((target_percent - base_percent) as f64 * frac) as u32;
                emit_progress(
                    app, step, total, label, "running", progress,
                    &truncate(&clean, 80), cmd,
                );
                lines.push(clean);
            }
            Ok(Err(e)) => {
                log::warn!("[shell_run_streaming] IO error reading line: {}", e);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                log::error!(
                    "[shell_run_streaming] idle timeout after {}s with no output, killing process. cmd={}",
                    idle_timeout_secs, cmd
                );
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Command timed out: no output for {} seconds, network may be disconnected or process stuck",
                    idle_timeout_secs
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for command: {e}"))?;

    if status.success() {
        Ok(lines.join("\n"))
    } else {
        // Use last meaningful lines for error info
        let error_output: String = lines
            .iter()
            .rev()
            .take(5)
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let err = if error_output.is_empty() {
            format!("Exit code {}", status.code().unwrap_or(-1))
        } else {
            error_output
        };
        log::error!("[shell_run_streaming] cmd={} failed: {}", cmd, &err[..err.len().min(500)]);
        Err(err)
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: &AppHandle,
    step: usize,
    total: usize,
    label: &str,
    status: &str,
    percent: u32,
    message: &str,
    command: &str,
) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            step,
            total,
            label: label.to_string(),
            status: status.to_string(),
            percent,
            message: message.to_string(),
            command: command.to_string(),
        },
    );
}

/// Truncate a message to at most `max_len` characters for UI display
fn truncate(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_len).collect();
        format!("{truncated}...")
    }
}

#[tauri::command]
pub async fn install_openclaw(app: AppHandle) -> Result<String, String> {
    log::info!("starting OpenClaw installation");
    let total = 6;
    let openclaw_version = pinned_openclaw_version();

    // ── Step 0: Check network connectivity ──────────────────────────────
    // Get user-configured npm registry, use curl to check reachability
    let registry = shell_run("npm config get registry")
        .unwrap_or_else(|_| "https://registry.npmjs.org/".to_string())
        .trim()
        .trim_end_matches('/')
        .to_string();
    let check_url = format!("{}/openclaw", registry);
    let curl_cmd = format!(
        "curl -sI --connect-timeout 10 --max-time 15 \"{}\"",
        check_url
    );
    emit_progress(
        &app, 0, total, "Network check", "running", 1,
        &format!("Checking npm registry connectivity ({})...", registry),
        &curl_cmd,
    );

    match shell_run(&curl_cmd) {
        Ok(resp) => {
            // Any HTTP response means the registry is reachable
            let reachable = resp.contains("HTTP/") && !resp.contains("000");
            if reachable {
                log::info!("[install] npm registry reachable: {}", registry);
                emit_progress(
                    &app, 0, total, "Network check", "done", 3,
                    &format!("npm registry reachable: {}", registry), &curl_cmd,
                );
            } else {
                log::warn!("[install] npm registry responded abnormally: {}", &resp[..resp.len().min(200)]);
                emit_progress(
                    &app, 0, total, "Network check", "done", 3,
                    &format!("npm registry responded (may be restricted): {}", registry), &curl_cmd,
                );
            }
        }
        Err(e) => {
            let user_msg = format!(
                "Unable to connect to npm registry ({}).\n\nSuggestions:\n1. Check your network connection\n2. Try switching registry mirror: npm config set registry https://registry.npmmirror.com\n3. If using a proxy, verify the proxy configuration is correct\n\nDetails: {}",
                registry, truncate(&e, 100)
            );
            log::error!("[install] network check failed: {}", &user_msg);
            emit_progress(
                &app, 0, total, "Network check", "error", 1,
                &user_msg, &curl_cmd,
            );
            return Err(user_msg);
        }
    }

    // ── Step 1: Install CLI ───────────────────────────────────────────
    // SHARP_IGNORE_GLOBAL_LIBVIPS=1 avoids sharp native build errors
    // (official recommendation: https://docs.openclaw.ai/install)
    let install_cmd = format!(
        "SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g openclaw@\"{openclaw_version}\""
    );
    emit_progress(
        &app, 1, total, "Install CLI", "running", 5,
        &format!("Installing OpenClaw ({openclaw_version})..."),
        &install_cmd,
    );

    // idle_timeout = 60s: if npm produces no output for 60 seconds, consider it stuck
    match shell_run_streaming(&install_cmd, &app, 1, total, "Install CLI", 5, 18, 60) {
        Ok(out) => {
            let summary = out.lines().last().unwrap_or(&out);
            emit_progress(
                &app, 1, total, "Install CLI", "done", 20,
                &truncate(summary, 80), &install_cmd,
            );
        }
        Err(e) => {
            let hint = if e.contains("超时") || e.contains("timeout") {
                "Installation unresponsive for too long, network connection may be lost.\nSuggestions:\n1. Check your network connection\n2. Try switching registry mirror: npm config set registry https://registry.npmmirror.com".to_string()
            } else if e.contains("EACCES") || e.contains("permission") {
                format!("Insufficient permissions. Try running in terminal: sudo npm install -g openclaw@\"{openclaw_version}\"")
            } else if e.contains("not found") || e.contains("command not found") {
                "npm not found. Please install Node.js >= 22.12.0 first".to_string()
            } else if e.contains("ENETUNREACH")
                || e.contains("ETIMEDOUT")
                || e.contains("network")
            {
                "Network connection failed. Please check your network and try again".to_string()
            } else if e.contains("404") || e.contains("Not Found") {
                "npm package openclaw not found. Please verify the package name is correct".to_string()
            } else {
                String::new()
            };

            let user_msg = if hint.is_empty() {
                truncate(&e, 200)
            } else {
                format!("{hint}\n\nDetails: {}", truncate(&e, 150))
            };

            log::error!("[install] CLI installation failed: {}", &user_msg);
            emit_progress(
                &app, 1, total, "Install CLI", "error", 5,
                &user_msg, &install_cmd,
            );
            return Err(user_msg);
        }
    }

    // ── Step 2: Initialize configuration (openclaw onboard, officially recommended command) ──
    // --non-interactive: non-interactive mode (ClawZ UI handles onboarding separately)
    // --accept-risk: must explicitly acknowledge risk to use non-interactive mode
    // --skip-channels: channels are configured separately via ClawZ onboarding flow
    // --install-daemon: install system daemon (launchd) for auto-start on boot
    let setup_cmd = "openclaw onboard --non-interactive --accept-risk --skip-channels --install-daemon";
    emit_progress(
        &app, 2, total, "Initialize config", "running", 25,
        "Initializing OpenClaw configuration...", setup_cmd,
    );

    match shell_run_streaming(setup_cmd, &app, 2, total, "Initialize config", 25, 38, 30) {
        Ok(out) => {
            emit_progress(
                &app, 2, total, "Initialize config", "done", 40,
                &truncate(&out, 80), setup_cmd,
            );
        }
        Err(e) => {
            // setup may fail if already configured — check if ~/.openclaw exists
            let home = std::env::var("HOME").unwrap_or_default();
            let openclaw_dir = std::path::Path::new(&home).join(".openclaw");
            if openclaw_dir.exists() {
                emit_progress(
                    &app, 2, total, "Initialize config", "done", 40,
                    "Configuration already exists, skipping initialization", setup_cmd,
                );
            } else {
                let user_msg = format!("Configuration initialization failed: {}", truncate(&e, 150));
                log::error!("[install] {}", &user_msg);
                emit_progress(
                    &app, 2, total, "Initialize config", "error", 25,
                    &user_msg, setup_cmd,
                );
                return Err(user_msg);
            }
        }
    }

    // ── Step 3: Check dependencies (openclaw doctor, officially recommended verification) ──
    let doctor_cmd = "openclaw doctor";
    emit_progress(
        &app, 3, total, "Check dependencies", "running", 45,
        "Checking runtime environment...", doctor_cmd,
    );

    match shell_run_streaming(doctor_cmd, &app, 3, total, "Check dependencies", 45, 58, 30) {
        Ok(out) => {
            emit_progress(
                &app, 3, total, "Check dependencies", "done", 60,
                &truncate(&out, 80), doctor_cmd,
            );
        }
        Err(e) => {
            // doctor failure is non-fatal
            emit_progress(
                &app, 3, total, "Check dependencies", "done", 60,
                &format!("Dependency check completed (some warnings: {})", truncate(&e, 60)),
                doctor_cmd,
            );
        }
    }

    // ── Step 4: Verify data directory ─────────────────────────────────
    let check_desc = "Check ~/.openclaw directory";
    emit_progress(
        &app, 4, total, "Verify data", "running", 65,
        "Verifying data directory...", check_desc,
    );

    let home = std::env::var("HOME").unwrap_or_default();
    let openclaw_dir = std::path::Path::new(&home).join(".openclaw");
    if openclaw_dir.exists() {
        emit_progress(
            &app, 4, total, "Verify data", "done", 80,
            "~/.openclaw data directory is ready", check_desc,
        );
    } else {
        let msg = "Initialization failed: ~/.openclaw directory was not created. Try running openclaw setup in the terminal";
        log::error!("[install] {}", msg);
        emit_progress(&app, 4, total, "Verify data", "error", 65, msg, check_desc);
        return Err(msg.into());
    }

    // ── Step 5: Verify installation ────────────────────────────────────
    let version_cmd = "openclaw --version";
    emit_progress(
        &app, 5, total, "Verify installation", "running", 85,
        "Verifying OpenClaw version...", version_cmd,
    );

    match shell_run(version_cmd) {
        Ok(ver) => {
            let msg = format!("OpenClaw {ver} installed successfully");
            log::info!("{}", msg);
            emit_progress(
                &app, 5, total, "Verify installation", "done", 100,
                &msg, version_cmd,
            );
            Ok(msg)
        }
        Err(e) => {
            let user_msg = format!(
                "Installation verification failed: openclaw command cannot be executed ({})",
                truncate(&e, 100)
            );
            log::error!("{}", user_msg);
            emit_progress(
                &app, 5, total, "Verify installation", "error", 85,
                &user_msg, version_cmd,
            );
            Err(user_msg)
        }
    }
}

/// Uninstall OpenClaw using the official `openclaw uninstall` command.
///
/// This is more robust than `npm uninstall -g` because it:
/// - Works regardless of installation method (npm/pnpm/yarn/manual)
/// - Properly removes the launchd/systemd service
/// - Cleans up state, workspace, and app directories
///
/// After the official uninstall, we attempt to remove the CLI binary itself
/// by detecting its location via `which openclaw`.
#[tauri::command]
pub async fn uninstall_openclaw(remove_data: bool) -> Result<String, String> {
    log::info!("starting OpenClaw uninstallation (remove_data={})", remove_data);

    let shell = user_shell();

    // 1. Stop gateway via bundled runtime (best-effort, works without system openclaw in PATH)
    let _ = super::cli::oc_run_raw("uninstall_stop", "gateway stop", None).await;
    log::info!("attempted to stop Gateway");

    // 1.5. Remove CLI symlink and restore user's original if any
    match uninstall_cli_symlink().await {
        Ok(msg) => log::info!("[uninstall] CLI symlink: {}", msg),
        Err(e) => log::warn!("[uninstall] CLI symlink cleanup failed: {}", e),
    }

    // 2. Auto-backup before destructive operations
    let mut backup_path: Option<String> = None;
    let home = std::env::var("HOME").unwrap_or_default();
    let openclaw_dir = std::path::Path::new(&home).join(".openclaw");
    if openclaw_dir.exists() {
        let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let dest = format!("{}/Desktop/clawz-backup-before-uninstall-{}.zip", home, ts);
        log::info!("[uninstall] auto-backup to {}", dest);
        match super::backup::export_config(dest.clone()).await {
            Ok(_) => {
                log::info!("[uninstall] auto-backup succeeded: {}", dest);
                backup_path = Some(dest);
            }
            Err(e) => {
                log::warn!("[uninstall] auto-backup failed (continuing uninstall): {}", e);
            }
        }
    }

    // 3. Use official `openclaw uninstall` via bundled runtime to remove service + data.
    //    Using oc_run() ensures this works even when system PATH has no openclaw binary.
    //    --service: always remove the daemon service
    //    --state/--workspace: only when remove_data is true
    let uninstall_flags = if remove_data {
        "--all --non-interactive --yes"
    } else {
        "--service --non-interactive --yes"
    };
    let uninstall_args = format!("uninstall {}", uninstall_flags);
    log::info!("[uninstall] running: openclaw {}", uninstall_args);
    match super::cli::oc_run_raw("uninstall", &uninstall_args, None).await {
        Ok(out) => log::info!("[uninstall] openclaw uninstall succeeded: {}", out.trim()),
        Err(e) => {
            // Non-fatal: uninstall may fail if already partially removed
            log::warn!("[uninstall] openclaw uninstall failed (continuing): {}", e);
        }
    }

    // 4. Remove the CLI binary itself (only relevant for legacy system-installed openclaw)
    //    Detect location first to handle npm/pnpm/homebrew/manual installs.
    let which_cmd = with_rc("which openclaw");
    let which_output = bg_std_command(&shell)
        .args(["-l", "-c", &which_cmd])
        .output();

    if let Ok(wo) = which_output {
        let bin_path = String::from_utf8_lossy(&wo.stdout).trim().to_string();
        if !bin_path.is_empty() && wo.status.success() {
            log::info!("[uninstall] CLI located at: {}", bin_path);

            // Try npm uninstall first (covers npm/pnpm global installs)
            let npm_result = bg_std_command(&shell)
                .args(["-l", "-c", &with_rc("npm uninstall -g openclaw")])
                .output();
            let npm_ok = npm_result.as_ref().map(|o| o.status.success()).unwrap_or(false);

            if npm_ok {
                log::info!("[uninstall] npm uninstall -g openclaw succeeded");
            } else {
                // npm failed — try direct removal (e.g. manual install, homebrew symlink)
                log::warn!("[uninstall] npm uninstall failed, attempting direct removal of {}", bin_path);
                if let Err(e) = std::fs::remove_file(&bin_path) {
                    log::warn!("[uninstall] failed to directly remove {}: {}, may require sudo", bin_path, e);
                    // Not fatal — user can manually remove
                } else {
                    log::info!("[uninstall] directly removed {}", bin_path);
                }
            }
        }
    }

    // 5. Verify removal
    let verify_cmd = with_rc("which openclaw");
    let verify = bg_std_command(&shell)
        .args(["-l", "-c", &verify_cmd])
        .output();
    let still_exists = verify.as_ref().map(|o| o.status.success()).unwrap_or(false);

    let backup_note = backup_path
        .map(|p| format!("\nBackup saved to: {}", p))
        .unwrap_or_default();

    if still_exists {
        let path = String::from_utf8_lossy(&verify.unwrap().stdout).trim().to_string();
        log::warn!("[uninstall] CLI still exists at: {}", path);
        Ok(format!("OpenClaw service and data have been cleaned up, but CLI still exists at {} and may need to be removed manually{}", path, backup_note))
    } else {
        log::info!("[uninstall] OpenClaw fully uninstalled");
        Ok(format!("OpenClaw has been successfully uninstalled{}", backup_note))
    }
}

// ── CLI symlink management ───────────────────────────────────────────

const CLI_SYMLINK_BACKUP_SUFFIX: &str = ".pre-clawz";

/// Resolve the target path for the `~/.local/bin/openclaw` symlink.
/// Returns the path to `cli/openclaw` wrapper inside the app's resources.
fn resolve_cli_wrapper() -> Result<PathBuf, String> {
    let res = super::cli::RESOURCE_DIR
        .get()
        .ok_or("resource dir not initialized")?;
    let wrapper = res.join("cli/openclaw");
    if wrapper.exists() {
        Ok(wrapper)
    } else {
        Err(format!("CLI wrapper not found: {}", wrapper.display()))
    }
}

/// Return `~/.local/bin/openclaw`.
fn symlink_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".local/bin/openclaw"))
}

/// Install (or refresh) the `~/.local/bin/openclaw` → bundled CLI symlink.
///
/// - If no file exists at the target: create symlink directly.
/// - If a symlink already points into a ClawZ.app: refresh it.
/// - If a regular file or foreign symlink exists: back it up as
///   `openclaw.pre-clawz`, then create our symlink.
///
/// Called automatically on app startup and can be invoked manually.
#[tauri::command]
pub async fn install_cli_symlink() -> Result<String, String> {
    let wrapper = resolve_cli_wrapper()?;
    let link = symlink_path()?;
    let link_dir = link.parent().ok_or("invalid symlink path")?;

    // Ensure ~/.local/bin/ exists
    if !link_dir.exists() {
        std::fs::create_dir_all(link_dir)
            .map_err(|e| format!("Failed to create {}: {}", link_dir.display(), e))?;
        log::info!("[cli_symlink] created {}", link_dir.display());
    }

    if link.exists() || link.symlink_metadata().is_ok() {
        // Something exists at the target path
        if let Ok(target) = std::fs::read_link(&link) {
            // It's a symlink
            let target_str = target.to_string_lossy();
            if target_str.contains("ClawZ.app") || target_str.contains("clawz") {
                // Our symlink — refresh it
                std::fs::remove_file(&link)
                    .map_err(|e| format!("Failed to remove old symlink: {}", e))?;
                log::info!("[cli_symlink] refreshing existing ClawZ symlink");
            } else {
                // Foreign symlink — back it up
                let backup = link.with_extension(
                    format!("pre-clawz{}", target.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default())
                );
                backup_existing(&link, &backup)?;
            }
        } else {
            // Regular file — back it up
            let backup_path = link.with_file_name(
                format!("openclaw{}", CLI_SYMLINK_BACKUP_SUFFIX)
            );
            backup_existing(&link, &backup_path)?;
        }
    }

    #[cfg(unix)]
    std::os::unix::fs::symlink(&wrapper, &link)
        .map_err(|e| format!("Failed to create symlink: {}", e))?;

    #[cfg(not(unix))]
    return Err("CLI symlink is only supported on macOS/Linux".to_string());

    log::info!(
        "[cli_symlink] {} → {}",
        link.display(),
        wrapper.display()
    );

    // Ensure ~/.local/bin is in PATH
    ensure_local_bin_in_path();

    Ok(link.to_string_lossy().to_string())
}

/// Back up an existing file/symlink before overwriting.
fn backup_existing(original: &Path, backup: &Path) -> Result<(), String> {
    if backup.exists() {
        std::fs::remove_file(backup)
            .map_err(|e| format!("Failed to remove old backup: {}", e))?;
    }
    std::fs::rename(original, backup)
        .map_err(|e| format!("Failed to backup {} → {}: {}", original.display(), backup.display(), e))?;
    log::info!(
        "[cli_symlink] backed up {} → {}",
        original.display(),
        backup.display()
    );
    Ok(())
}

/// Remove the CLI symlink. If a `.pre-clawz` backup exists, restore it.
#[tauri::command]
pub async fn uninstall_cli_symlink() -> Result<String, String> {
    let link = symlink_path()?;

    if !link.exists() && link.symlink_metadata().is_err() {
        return Ok("Symlink does not exist, no cleanup needed".to_string());
    }

    // Only remove if it's our symlink (points into ClawZ.app)
    if let Ok(target) = std::fs::read_link(&link) {
        let target_str = target.to_string_lossy();
        if !target_str.contains("ClawZ.app") && !target_str.contains("clawz") {
            log::info!("[cli_symlink] {} is not a ClawZ symlink, skipping", link.display());
            return Ok("Not a ClawZ symlink, skipped".to_string());
        }
    }

    std::fs::remove_file(&link)
        .map_err(|e| format!("Failed to remove symlink: {}", e))?;
    log::info!("[cli_symlink] removed {}", link.display());

    // Restore backup if exists
    let backup = link.with_file_name(format!("openclaw{}", CLI_SYMLINK_BACKUP_SUFFIX));
    if backup.exists() {
        std::fs::rename(&backup, &link)
            .map_err(|e| format!("Failed to restore backup: {}", e))?;
        log::info!("[cli_symlink] restored backup {}", link.display());
        return Ok(format!("Restored original openclaw: {}", link.display()));
    }

    Ok("CLI symlink removed".to_string())
}

/// Ensure `~/.local/bin` is in the user's shell profile PATH.
/// Appends `export PATH="$HOME/.local/bin:$PATH"` if not already present.
fn ensure_local_bin_in_path() {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return,
    };

    // Check if ~/.local/bin is already in PATH
    if let Ok(path) = std::env::var("PATH") {
        let local_bin = format!("{}/.local/bin", home);
        if path.split(':').any(|p| p == local_bin) {
            return;
        }
    }

    let line = "\nexport PATH=\"$HOME/.local/bin:$PATH\"  # Added by ClawZ\n";

    // Try common profile files in order
    for rc in &[".zshrc", ".bashrc", ".profile"] {
        let rc_path = PathBuf::from(&home).join(rc);
        if rc_path.exists() {
            // Check if already added
            if let Ok(content) = std::fs::read_to_string(&rc_path) {
                if content.contains("/.local/bin") {
                    log::debug!("[cli_symlink] {} already contains .local/bin PATH", rc);
                    return;
                }
            }
            match std::fs::OpenOptions::new().append(true).open(&rc_path) {
                Ok(mut f) => {
                    use std::io::Write;
                    if f.write_all(line.as_bytes()).is_ok() {
                        log::info!("[cli_symlink] added ~/.local/bin to {}", rc);
                        return;
                    }
                }
                Err(e) => {
                    log::warn!("[cli_symlink] cannot write to {}: {}", rc, e);
                }
            }
        }
    }
    log::warn!("[cli_symlink] no writable shell profile found, please manually add ~/.local/bin to PATH");
}
