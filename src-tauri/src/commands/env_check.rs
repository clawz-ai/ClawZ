use serde::Serialize;
use super::cli::{bg_command, bg_std_command};
use tokio::time::{timeout, Duration};

#[derive(Debug, Serialize, PartialEq)]
pub struct EnvCheckItem {
    pub name: String,
    pub status: String, // "pass" | "warn" | "fail"
    pub message: String,
}

/// Detect user's login shell; fall back to platform default
/// (zsh on macOS since Catalina, bash on Linux).
fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        #[cfg(target_os = "macos")]
        { "/bin/zsh".to_string() }
        #[cfg(not(target_os = "macos"))]
        { "/bin/bash".to_string() }
    })
}

/// Prefix a command with sourcing the user's shell rc file and adding
/// common tool paths (brew opt node, nvm, go, cargo, homebrew).
/// This ensures tools installed by auto_fix_env are found even if
/// the rc file write failed (e.g. .zshrc not writable).
fn rc_prefix(cmd: &str) -> String {
    let shell = user_shell();
    let home = std::env::var("HOME").unwrap_or_default();
    // Extra PATH entries vary by platform.
    #[cfg(target_os = "macos")]
    let extra_paths = format!(
        concat!(
            "export PATH=\"/opt/homebrew/opt/node@22/bin:",
            "/usr/local/opt/node@22/bin:",
            "{home}/go/bin:",
            "{home}/.cargo/bin:",
            "/opt/homebrew/bin:",
            "$PATH\"; ",
        ),
        home = home,
    );
    #[cfg(target_os = "linux")]
    let extra_paths = format!(
        concat!(
            "export PATH=\"/usr/local/bin:",
            "/usr/local/sbin:",
            "{home}/.local/bin:",
            "{home}/.cargo/bin:",
            "{home}/go/bin:",
            "/snap/bin:",
            "$PATH\"; ",
        ),
        home = home,
    );
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let extra_paths = format!(
        "export PATH=\"/usr/local/bin:{home}/.cargo/bin:$PATH\"; ",
        home = home,
    );
    if shell.contains("zsh") {
        format!("{extra_paths}[ -f \"{home}/.zshrc\" ] && source \"{home}/.zshrc\" 2>/dev/null; {cmd}")
    } else {
        format!("{extra_paths}[ -f \"{home}/.bashrc\" ] && source \"{home}/.bashrc\" 2>/dev/null; {cmd}")
    }
}

/// Run a shell command and return trimmed stdout, or None on failure.
/// Sources ~/.zshrc (or ~/.bashrc) so that nvm/node are in PATH,
/// without using `-i` (interactive) which breaks piped commands.
fn run_cmd(cmd: &str, args: &[&str]) -> Option<String> {
    let full_cmd = if args.is_empty() {
        cmd.to_string()
    } else {
        format!("{} {}", cmd, args.iter().map(|a| shell_escape(a)).collect::<Vec<_>>().join(" "))
    };

    let shell = user_shell();
    let wrapped = rc_prefix(&full_cmd);
    log::debug!("[run_cmd] shell={}, cmd={}", shell, full_cmd);
    match bg_std_command(&shell)
        .args(["-l", "-c", &wrapped])
        .output()
    {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            if o.status.success() {
                log::debug!("[run_cmd] ok: {} -> {}", full_cmd, stdout);
                Some(stdout)
            } else {
                log::warn!("[run_cmd] fail: {} exit={}, stdout={}, stderr={}", full_cmd, o.status, stdout, stderr);
                None
            }
        }
        Err(e) => {
            log::error!("[run_cmd] spawn error for {}: {}", full_cmd, e);
            None
        }
    }
}

/// Simple shell argument escaping
fn shell_escape(s: &str) -> String {
    if s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '/' || c == ':') {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// Parse a version string like "v22.12.0" or "22.12.0" into (major, minor, patch).
fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let s = s.trim().trim_start_matches('v');
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() >= 3 {
        Some((
            parts[0].parse().ok()?,
            parts[1].parse().ok()?,
            parts[2].parse().ok()?,
        ))
    } else if parts.len() == 2 {
        Some((parts[0].parse().ok()?, parts[1].parse().ok()?, 0))
    } else {
        None
    }
}

// --- Pure logic functions (testable without shell) ---

#[allow(dead_code)]
fn evaluate_macos_version(version: Option<&str>) -> EnvCheckItem {
    let name = "macOS Version".to_string();
    match version {
        Some(v) => {
            if let Some((major, _, _)) = parse_version(v) {
                if major >= 12 {
                    EnvCheckItem { name, status: "pass".into(), message: format!("macOS {v}") }
                } else {
                    EnvCheckItem { name, status: "fail".into(), message: format!("macOS {v}, requires >= 12.0 (Monterey)") }
                }
            } else {
                EnvCheckItem { name, status: "warn".into(), message: format!("macOS {v} (unable to parse version)") }
            }
        }
        None => EnvCheckItem { name, status: "fail".into(), message: "Unable to detect macOS version".into() },
    }
}

fn evaluate_nodejs_version(version: Option<&str>) -> EnvCheckItem {
    let name = "Node.js".to_string();
    match version {
        Some(v) => {
            if let Some((major, minor, _)) = parse_version(v) {
                if major > 22 || (major == 22 && minor >= 12) {
                    EnvCheckItem { name, status: "pass".into(), message: v.to_string() }
                } else if major >= 18 {
                    EnvCheckItem { name, status: "warn".into(), message: format!("{v}, recommend upgrading to >= 22.12.0") }
                } else {
                    EnvCheckItem { name, status: "fail".into(), message: format!("{v}, version too old, requires >= 18.0 (recommended >= 22.12.0)") }
                }
            } else {
                EnvCheckItem { name, status: "warn".into(), message: format!("{v} (unable to parse version)") }
            }
        }
        None => EnvCheckItem { name, status: "fail".into(), message: "Node.js not installed, requires >= 22.12.0".into() },
    }
}

fn evaluate_npm_version(version: Option<&str>) -> EnvCheckItem {
    let name = "npm".to_string();
    match version {
        Some(v) => EnvCheckItem { name, status: "pass".into(), message: format!("v{v}") },
        None => EnvCheckItem { name, status: "fail".into(), message: "npm not installed".into() },
    }
}

fn evaluate_npm_registry(registry: Option<&str>, official_accessible: Option<bool>) -> EnvCheckItem {
    let name = "npm Registry".to_string();
    match registry {
        Some(r) => {
            let r = r.trim_end_matches('/');
            if r.contains("npmmirror.com") || r.contains("taobao") {
                EnvCheckItem { name, status: "pass".into(), message: "China mirror".into() }
            } else if r.contains("npmjs.org") || r.contains("npmjs.com") {
                match official_accessible {
                    Some(true) => EnvCheckItem { name, status: "pass".into(), message: "Official registry (connected)".into() },
                    Some(false) => EnvCheckItem { name, status: "warn".into(), message: "Official registry connection timed out, consider switching to a mirror".into() },
                    None => EnvCheckItem { name, status: "warn".into(), message: "Using official registry; users in China may want to switch to a mirror".into() },
                }
            } else {
                EnvCheckItem { name, status: "pass".into(), message: format!("Custom registry: {r}") }
            }
        }
        None => EnvCheckItem { name, status: "warn".into(), message: "Unable to read npm config".into() },
    }
}

fn evaluate_port(lsof_stdout: Option<&str>, ps_detail: Option<&str>) -> EnvCheckItem {
    let name = "Port 18789".to_string();
    match lsof_stdout {
        Some(stdout) if stdout.trim().is_empty() => {
            EnvCheckItem { name, status: "pass".into(), message: "Port available".into() }
        }
        Some(stdout) => {
            // lsof output columns: COMMAND PID USER FD TYPE ...
            let (process, pid) = stdout
                .lines()
                .nth(1)
                .map(|line| {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    let cmd = cols.first().copied().unwrap_or("unknown");
                    let pid = cols.get(1).copied().unwrap_or("?");
                    (cmd, pid)
                })
                .unwrap_or(("unknown process", "?"));

            let detail = ps_detail
                .map(|d| d.trim().to_string())
                .filter(|d| !d.is_empty())
                .unwrap_or_else(|| process.to_string());

            EnvCheckItem {
                name,
                status: "fail".into(),
                message: format!("Occupied by {detail} (PID {pid}), please close it manually"),
            }
        }
        None => EnvCheckItem { name, status: "warn".into(), message: "Unable to detect port status".into() },
    }
}

fn evaluate_disk_space(df_output: Option<&str>) -> EnvCheckItem {
    let name = "Disk Space".to_string();
    match df_output {
        Some(output) => {
            if let Some(line) = output.lines().nth(1) {
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() >= 4 {
                    if let Ok(avail_gb) = cols[3].parse::<u64>() {
                        return if avail_gb >= 2 {
                            EnvCheckItem { name, status: "pass".into(), message: format!("{avail_gb}GB available") }
                        } else {
                            EnvCheckItem { name, status: "fail".into(), message: format!("{avail_gb}GB available, requires >= 2GB") }
                        };
                    }
                }
            }
            EnvCheckItem { name, status: "warn".into(), message: "Unable to parse disk space".into() }
        }
        None => EnvCheckItem { name, status: "warn".into(), message: "Unable to detect disk space".into() },
    }
}

fn evaluate_memory(memsize_bytes: Option<&str>) -> EnvCheckItem {
    let name = "Memory".to_string();
    match memsize_bytes {
        Some(s) => {
            if let Ok(bytes) = s.trim().parse::<u64>() {
                let gb = bytes / (1024 * 1024 * 1024);
                if gb >= 8 {
                    EnvCheckItem { name, status: "pass".into(), message: format!("{gb}GB") }
                } else if gb >= 4 {
                    EnvCheckItem { name, status: "warn".into(), message: format!("{gb}GB, recommended >= 8GB") }
                } else {
                    EnvCheckItem { name, status: "fail".into(), message: format!("{gb}GB, requires >= 4GB") }
                }
            } else {
                EnvCheckItem { name, status: "warn".into(), message: "Unable to parse memory size".into() }
            }
        }
        None => EnvCheckItem { name, status: "warn".into(), message: "Unable to detect memory".into() },
    }
}

// --- Check functions that call shell commands ---

#[cfg(target_os = "macos")]
fn check_macos_version() -> EnvCheckItem {
    let v = run_cmd("sw_vers", &["-productVersion"]);
    evaluate_macos_version(v.as_deref())
}

#[cfg(target_os = "linux")]
fn check_linux_version() -> EnvCheckItem {
    let name = "Linux Version".to_string();
    // Try lsb_release first, fall back to /etc/os-release
    if let Some(desc) = run_cmd("lsb_release", &["-ds"]) {
        return EnvCheckItem { name, status: "pass".into(), message: desc };
    }
    if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
        for line in content.lines() {
            if let Some(val) = line.strip_prefix("PRETTY_NAME=") {
                let val = val.trim_matches('"');
                return EnvCheckItem { name, status: "pass".into(), message: val.to_string() };
            }
        }
    }
    EnvCheckItem { name, status: "warn".into(), message: "Unable to detect Linux version".into() }
}

fn check_nodejs() -> EnvCheckItem {
    let v = run_cmd("node", &["-v"]);
    evaluate_nodejs_version(v.as_deref())
}

fn check_npm() -> EnvCheckItem {
    let v = run_cmd("npm", &["-v"]);
    evaluate_npm_version(v.as_deref())
}

/// Quick connectivity check: curl with 5s connect timeout.
fn test_registry_accessible(url: &str) -> bool {
    let script = format!(
        "curl -sS --connect-timeout 5 -o /dev/null -w '%{{http_code}}' {}",
        shell_escape(url)
    );
    bg_std_command("bash")
        .args(["-c", &script])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            let code = String::from_utf8_lossy(&o.stdout).trim().to_string();
            code.starts_with('2') || code.starts_with('3')
        })
        .unwrap_or(false)
}

fn check_npm_registry() -> EnvCheckItem {
    let v = run_cmd("npm", &["config", "get", "registry"]);
    let is_official = v.as_deref()
        .map(|r| r.contains("npmjs.org") || r.contains("npmjs.com"))
        .unwrap_or(false);
    let accessible = if is_official {
        Some(test_registry_accessible("https://registry.npmjs.org/"))
    } else {
        None
    };
    evaluate_npm_registry(v.as_deref(), accessible)
}

fn check_port_18789() -> EnvCheckItem {
    let shell = user_shell();
    let output = bg_std_command(&shell)
        .args(["-l", "-c", "lsof -i :18789 -sTCP:LISTEN"])
        .output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            // Extract PID from lsof output, then get full command via ps
            let ps_detail = stdout
                .lines()
                .nth(1)
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|pid| {
                    // ps -p <pid> -o comm= gives the full process path
                    run_cmd("ps", &["-p", pid, "-o", "comm="])
                });
            evaluate_port(Some(&stdout), ps_detail.as_deref())
        }
        Err(_) => evaluate_port(None, None),
    }
}

#[cfg(target_os = "macos")]
fn check_xcode_clt() -> EnvCheckItem {
    let name = "Xcode CLT".to_string();
    // xcode-select -p returns 0 if CLT is installed
    let shell = user_shell();
    let output = bg_std_command(&shell)
        .args(["-l", "-c", "xcode-select -p"])
        .output();
    match output {
        Ok(o) if o.status.success() => {
            EnvCheckItem { name, status: "pass".into(), message: "Installed".into() }
        }
        _ => {
            EnvCheckItem { name, status: "fail".into(), message: "Xcode Command Line Tools not installed (required for git and other tools)".into() }
        }
    }
}

fn check_disk_space() -> EnvCheckItem {
    // macOS: `df -g` outputs 1G-blocks; Linux: `df -BG` outputs in G units
    #[cfg(target_os = "macos")]
    let v = run_cmd("df", &["-g", "/"]);
    #[cfg(target_os = "linux")]
    let v = run_cmd("df", &["-BG", "/"]).map(|s| {
        // Linux `df -BG` outputs values like "52G" — strip the "G" suffix for parsing
        s.lines()
            .map(|line| {
                line.split_whitespace()
                    .map(|col| col.strip_suffix('G').unwrap_or(col))
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .collect::<Vec<_>>()
            .join("\n")
    });
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let v = run_cmd("df", &["-g", "/"]);
    evaluate_disk_space(v.as_deref())
}

fn check_memory() -> EnvCheckItem {
    #[cfg(target_os = "macos")]
    let v = run_cmd("sysctl", &["-n", "hw.memsize"]);
    #[cfg(target_os = "linux")]
    let v = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|content| {
            content
                .lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| {
                    // Format: "MemTotal:       16384000 kB"
                    l.split_whitespace()
                        .nth(1)
                        .and_then(|kb| kb.parse::<u64>().ok())
                        .map(|kb| (kb * 1024).to_string()) // convert kB → bytes
                })
        });
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let v: Option<String> = None;
    evaluate_memory(v.as_deref())
}

// --- Tauri commands ---

#[tauri::command]
pub async fn run_env_check() -> Result<Vec<EnvCheckItem>, String> {
    log::info!("[run_env_check] Starting environment check");
    let mut results = Vec::new();

    // Platform-specific OS checks
    #[cfg(target_os = "macos")]
    {
        results.push(check_macos_version());
        results.push(check_xcode_clt());
    }
    #[cfg(target_os = "linux")]
    {
        results.push(check_linux_version());
    }

    // Cross-platform checks
    results.push(check_nodejs());
    results.push(check_npm());
    results.push(check_npm_registry());
    results.push(check_port_18789());
    results.push(check_disk_space());
    results.push(check_memory());

    for item in &results {
        log::info!("[run_env_check] {} = {} ({})", item.name, item.status, item.message);
    }
    Ok(results)
}

/// Returns install status:
/// - "installed"     — node + openclaw available (bundled or system) + ~/.openclaw dir exists
/// - "not_installed" — node + openclaw available but ~/.openclaw not yet initialized (first run)
/// - "stale_dir"     — node/openclaw unavailable but ~/.openclaw exists (broken bundle)
#[tauri::command]
pub fn check_openclaw_installed() -> String {
    let node_path = super::cli::bundled_node();
    // bundled_node() returns an absolute path when bundled, or "node" (relative) as fallback.
    // In dev mode (no bundled node), also probe common system install locations so that
    // developers with node via Homebrew / system package manager are correctly detected.
    let node_ok = if node_path.is_absolute() {
        node_path.exists()
    } else {
        // Relative "node" fallback — check well-known system paths before giving up.
        // oc_run() resolves node via the inherited shell PATH at runtime, but here we need
        // a synchronous existence check without spawning a subprocess.
        #[cfg(target_os = "macos")]
        let system_nodes: &[&str] = &[
            "/opt/homebrew/bin/node",  // Homebrew (Apple Silicon)
            "/usr/local/bin/node",     // Homebrew (Intel) / manual
            "/usr/bin/node",           // system package managers
        ];
        #[cfg(target_os = "linux")]
        let system_nodes: &[&str] = &[
            "/usr/bin/node",           // apt/dnf
            "/usr/local/bin/node",     // manual install
            "/snap/bin/node",          // snap
        ];
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let system_nodes: &[&str] = &[
            "/usr/bin/node",
            "/usr/local/bin/node",
        ];
        system_nodes
            .iter()
            .any(|p| std::path::Path::new(p).exists())
    };

    let cli_found = node_ok && super::cli::bundled_openclaw().is_ok();
    let home = std::env::var("HOME").unwrap_or_default();
    let dir_exists = std::path::Path::new(&home).join(".openclaw").exists();

    match (cli_found, dir_exists) {
        (true, true) => "installed".into(),
        (true, false) => "not_installed".into(), // first run: runtime ready, not yet initialized
        (false, true) => "stale_dir".into(),
        (false, false) => "not_installed".into(),
    }
}

/// Rename ~/.openclaw to ~/.openclaw.bak.{timestamp} so a fresh install can proceed.
#[tauri::command]
pub async fn rename_stale_openclaw_dir() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Unable to determine HOME directory")?;
    let openclaw_dir = std::path::PathBuf::from(&home).join(".openclaw");
    if !openclaw_dir.exists() {
        return Ok("Directory does not exist, no rename needed".into());
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let backup = std::path::PathBuf::from(&home).join(format!(".openclaw.bak.{}", ts));
    log::info!("Renaming {:?} -> {:?}", openclaw_dir, backup);
    tokio::fs::rename(&openclaw_dir, &backup)
        .await
        .map_err(|e| format!("Rename failed: {}", e))?;
    Ok(format!("Renamed to {}", backup.display()))
}

const FIX_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes
const KILL_TIMEOUT: Duration = Duration::from_secs(15);

/// Filter out shell profile noise (e.g. .zprofile errors about missing brew).
/// These are harmless startup warnings that clutter error messages.
fn filter_shell_noise(s: &str) -> String {
    s.lines()
        .filter(|line| {
            let l = line.trim();
            // Skip .zprofile/.zshrc/.bashrc sourcing errors (missing brew, nvm, etc.)
            if (l.contains(".zprofile:") || l.contains(".zshrc:") || l.contains(".bashrc:") || l.contains(".bash_profile:"))
                && (l.contains("no such file or directory") || l.contains("command not found"))
            {
                return false;
            }
            true
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Run an async shell command with timeout. Returns Ok(stdout) or Err(message).
/// Uses the user's login shell so that PATH, nvm, etc. are available.
async fn run_fix_cmd(script: &str, dur: Duration) -> Result<String, String> {
    let shell = user_shell();
    log::info!("[run_fix_cmd] shell={}, script={}", shell, script);
    let wrapped = rc_prefix(script);
    let child = bg_command(&shell)
        .args(["-l", "-c", &wrapped])
        .output();
    match timeout(dur, child).await {
        Ok(Ok(o)) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let stderr_raw = String::from_utf8_lossy(&o.stderr).trim().to_string();
            let stderr = filter_shell_noise(&stderr_raw);
            log::info!("[run_fix_cmd] exit={}, stdout={}, stderr={}", o.status, stdout, stderr_raw);
            if o.status.success() {
                Ok(stdout)
            } else {
                let msg = if stderr.is_empty() { stdout.clone() } else { stderr };
                Err(format!("Execution failed (exit {}): {}", o.status.code().unwrap_or(-1), if msg.is_empty() { "unknown error".into() } else { msg }))
            }
        }
        Ok(Err(e)) => {
            log::error!("[run_fix_cmd] spawn error: {e}");
            Err(format!("Execution failed: {e}"))
        }
        Err(_) => {
            log::error!("[run_fix_cmd] timeout after {}s", dur.as_secs());
            Err(format!("Operation timed out ({}s), please check your network connection and try again", dur.as_secs()))
        }
    }
}

#[tauri::command]
pub async fn auto_fix_env(item_name: String) -> Result<String, String> {
    log::info!("[auto_fix_env] item={}", item_name);
    match item_name.as_str() {
        "Node.js" => {
            let home = std::env::var("HOME").unwrap_or_default();
            let nvm_dir = format!("{}/.nvm", home);
            let has_nvm = std::path::Path::new(&format!("{}/nvm.sh", nvm_dir)).exists();
            log::info!("[auto_fix_env] home={}, nvm_dir={}, has_nvm={}", home, nvm_dir, has_nvm);

            // Use taobao mirror for Node.js downloads (much faster in China)
            let node_mirror = "export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node";

            // Shell profile to write nvm init — .zshrc on macOS, .bashrc on Linux
            #[cfg(target_os = "macos")]
            let shell_rc = format!("{}/.zshrc", home);
            #[cfg(not(target_os = "macos"))]
            let shell_rc = format!("{}/.bashrc", home);

            if has_nvm {
                // nvm already installed — just install Node 22
                let script = format!(
                    "export NVM_DIR=\"{nvm}\" && source \"{nvm}/nvm.sh\" && {mirror} && nvm install 22 && nvm use 22 && nvm alias default 22",
                    nvm = nvm_dir,
                    mirror = node_mirror,
                );
                run_fix_cmd(&script, FIX_TIMEOUT).await?;
                return Ok("Node.js 22 installed successfully".into());
            }

            // macOS: try Homebrew
            #[cfg(target_os = "macos")]
            if run_cmd("brew", &["--version"]).is_some() {
                log::info!("[auto_fix_env] using brew to install node@22");
                let script = concat!(
                    "brew install node@22 2>&1; ",
                    "{ ",
                    "  chmod -R u+w /usr/local/include/node /usr/local/lib/node_modules 2>/dev/null; ",
                    "  brew link --overwrite node@22 2>&1; ",
                    "} || { ",
                    "  BREW_PREFIX=$(brew --prefix 2>/dev/null || echo /usr/local); ",
                    "  NODE_BIN=\"$BREW_PREFIX/opt/node@22/bin\"; ",
                    "  if [ -x \"$NODE_BIN/node\" ]; then ",
                    "    WROTE=0; ",
                    "    for RC in \"$HOME/.zshrc\" \"$HOME/.zprofile\" \"$HOME/.profile\"; do ",
                    "      if [ -w \"$RC\" ] || { touch \"$RC\" 2>/dev/null && [ -w \"$RC\" ]; }; then ",
                    "        grep -q 'node@22/bin' \"$RC\" 2>/dev/null || ",
                    "        printf '\\nexport PATH=\"%s:$PATH\"\\n' \"$NODE_BIN\" >> \"$RC\"; ",
                    "        WROTE=1; break; ",
                    "      fi; ",
                    "    done; ",
                    "    export PATH=\"$NODE_BIN:$PATH\"; ",
                    "  fi; ",
                    "}; ",
                    "node -v"
                );
                run_fix_cmd(script, FIX_TIMEOUT).await?;
                return Ok("Node.js 22 installed successfully (via Homebrew)".into());
            }

            // Linux: try apt or dnf
            #[cfg(target_os = "linux")]
            if run_cmd("apt-get", &["--version"]).is_some() {
                log::info!("[auto_fix_env] using apt to install nodejs");
                let script = concat!(
                    "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && ",
                    "sudo apt-get install -y nodejs && ",
                    "node -v"
                );
                run_fix_cmd(script, FIX_TIMEOUT).await?;
                return Ok("Node.js 22 installed successfully (via apt)".into());
            }
            #[cfg(target_os = "linux")]
            if run_cmd("dnf", &["--version"]).is_some() {
                log::info!("[auto_fix_env] using dnf to install nodejs");
                let script = concat!(
                    "curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && ",
                    "sudo dnf install -y nodejs && ",
                    "node -v"
                );
                run_fix_cmd(script, FIX_TIMEOUT).await?;
                return Ok("Node.js 22 installed successfully (via dnf)".into());
            }

            // Fallback: install nvm via tarball (all platforms)
            log::info!("[auto_fix_env] installing nvm via tarball (no git needed)");
            let script = format!(
                concat!(
                    "mkdir -p \"{nvm}\" && ",
                    "{{ curl -fsSL --connect-timeout 15 https://github.com/nvm-sh/nvm/archive/refs/tags/v0.40.3.tar.gz || ",
                    "curl -fsSL --connect-timeout 15 https://gitee.com/mirrors/nvm/repository/archive/v0.40.3.tar.gz; }} ",
                    "| tar -xz -C \"{nvm}\" --strip-components=1 && ",
                    "echo '\\nexport NVM_DIR=\"{nvm}\"\\n[ -s \"{nvm}/nvm.sh\" ] && source \"{nvm}/nvm.sh\"' >> \"{rc}\" && ",
                    "export NVM_DIR=\"{nvm}\" && ",
                    "source \"{nvm}/nvm.sh\" && ",
                    "{mirror} && ",
                    "nvm install 22 && nvm use 22 && nvm alias default 22"
                ),
                nvm = nvm_dir,
                rc = shell_rc,
                mirror = node_mirror,
            );
            run_fix_cmd(&script, FIX_TIMEOUT).await?;
            Ok("nvm + Node.js 22 installed successfully".into())
        }
        #[cfg(target_os = "macos")]
        "Xcode CLT" => {
            // Install Xcode Command Line Tools via softwareupdate (silent, no GUI)
            log::info!("[auto_fix_env] installing Xcode CLT via softwareupdate");
            let script = concat!(
                "touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress && ",
                "PROD=$(softwareupdate -l 2>/dev/null | grep -o 'Command Line Tools.*' | head -1) && ",
                "if [ -z \"$PROD\" ]; then echo 'No CLT package found' >&2 && exit 1; fi && ",
                "softwareupdate -i \"$PROD\" --verbose && ",
                "rm -f /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress"
            );
            run_fix_cmd(script, Duration::from_secs(600)).await?; // 10 min timeout
            Ok("Xcode Command Line Tools installed successfully".into())
        }
        "npm Registry" => {
            let script = "npm config set registry https://registry.npmmirror.com";
            run_fix_cmd(script, Duration::from_secs(30)).await?;
            Ok("Switched to China mirror registry".into())
        }
        "Port 18789" => {
            let script = concat!(
                "pids=$(lsof -t -i :18789 -sTCP:LISTEN 2>/dev/null); ",
                "if [ -z \"$pids\" ]; then exit 0; fi; ",
                "echo $pids | xargs kill 2>/dev/null; sleep 1; ",
                "pids=$(lsof -t -i :18789 -sTCP:LISTEN 2>/dev/null); ",
                "if [ -z \"$pids\" ]; then exit 0; fi; ",
                "echo $pids | xargs kill -9 2>/dev/null; sleep 1; ",
                "pids=$(lsof -t -i :18789 -sTCP:LISTEN 2>/dev/null); ",
                "if [ -n \"$pids\" ]; then echo STILL_OCCUPIED >&2 && exit 1; fi"
            );
            run_fix_cmd(script, KILL_TIMEOUT).await?;
            Ok("Port 18789 released".into())
        }
        _ => Err(format!("Auto-fix not supported for: {item_name}")),
    }
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;

    // -- parse_version tests --

    #[test]
    fn parse_version_standard() {
        assert_eq!(parse_version("22.12.0"), Some((22, 12, 0)));
    }

    #[test]
    fn parse_version_with_v_prefix() {
        assert_eq!(parse_version("v22.12.0"), Some((22, 12, 0)));
    }

    #[test]
    fn parse_version_with_whitespace() {
        assert_eq!(parse_version("  v20.11.1\n"), Some((20, 11, 1)));
    }

    #[test]
    fn parse_version_two_parts() {
        assert_eq!(parse_version("15.3"), Some((15, 3, 0)));
    }

    #[test]
    fn parse_version_single_number() {
        assert_eq!(parse_version("22"), None);
    }

    #[test]
    fn parse_version_empty() {
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn parse_version_non_numeric() {
        assert_eq!(parse_version("abc.def.ghi"), None);
    }

    // -- macOS version evaluation --

    #[test]
    fn macos_version_pass_15() {
        let item = evaluate_macos_version(Some("15.3.1"));
        assert_eq!(item.status, "pass");
        assert!(item.message.contains("15.3.1"));
    }

    #[test]
    fn macos_version_pass_12() {
        let item = evaluate_macos_version(Some("12.0"));
        assert_eq!(item.status, "pass");
    }

    #[test]
    fn macos_version_fail_11() {
        let item = evaluate_macos_version(Some("11.7.0"));
        assert_eq!(item.status, "fail");
        assert!(item.message.contains("Monterey"));
    }

    #[test]
    fn macos_version_none() {
        let item = evaluate_macos_version(None);
        assert_eq!(item.status, "fail");
    }

    // -- Node.js version evaluation --

    #[test]
    fn nodejs_pass_v22_12() {
        let item = evaluate_nodejs_version(Some("v22.12.0"));
        assert_eq!(item.status, "pass");
    }

    #[test]
    fn nodejs_pass_v23() {
        let item = evaluate_nodejs_version(Some("v23.1.0"));
        assert_eq!(item.status, "pass");
    }

    #[test]
    fn nodejs_warn_v22_11() {
        let item = evaluate_nodejs_version(Some("v22.11.0"));
        assert_eq!(item.status, "warn");
        assert!(item.message.contains("22.12.0"));
    }

    #[test]
    fn nodejs_warn_v20() {
        let item = evaluate_nodejs_version(Some("v20.11.0"));
        assert_eq!(item.status, "warn");
    }

    #[test]
    fn nodejs_warn_v18() {
        let item = evaluate_nodejs_version(Some("v18.20.0"));
        assert_eq!(item.status, "warn");
    }

    #[test]
    fn nodejs_fail_v16() {
        let item = evaluate_nodejs_version(Some("v16.0.0"));
        assert_eq!(item.status, "fail");
    }

    #[test]
    fn nodejs_warn_v19() {
        let item = evaluate_nodejs_version(Some("v19.0.0"));
        assert_eq!(item.status, "warn");
    }

    #[test]
    fn nodejs_fail_not_installed() {
        let item = evaluate_nodejs_version(None);
        assert_eq!(item.status, "fail");
        assert!(item.message.contains("not installed"));
    }

    // -- npm version evaluation --

    #[test]
    fn npm_pass() {
        let item = evaluate_npm_version(Some("10.2.0"));
        assert_eq!(item.status, "pass");
        assert_eq!(item.message, "v10.2.0");
    }

    #[test]
    fn npm_fail() {
        let item = evaluate_npm_version(None);
        assert_eq!(item.status, "fail");
    }

    // -- npm registry evaluation --

    #[test]
    fn registry_npmmirror_pass() {
        let item = evaluate_npm_registry(Some("https://registry.npmmirror.com/"), None);
        assert_eq!(item.status, "pass");
        assert!(item.message.contains("China"));
    }

    #[test]
    fn registry_taobao_pass() {
        let item = evaluate_npm_registry(Some("https://registry.npm.taobao.org/"), None);
        assert_eq!(item.status, "pass");
    }

    #[test]
    fn registry_npmjs_accessible() {
        let item = evaluate_npm_registry(Some("https://registry.npmjs.org/"), Some(true));
        assert_eq!(item.status, "pass");
        assert!(item.message.contains("connected"));
    }

    #[test]
    fn registry_npmjs_unreachable() {
        let item = evaluate_npm_registry(Some("https://registry.npmjs.org/"), Some(false));
        assert_eq!(item.status, "warn");
        assert!(item.message.contains("timed out"));
    }

    #[test]
    fn registry_npmjs_no_connectivity_info() {
        let item = evaluate_npm_registry(Some("https://registry.npmjs.org/"), None);
        assert_eq!(item.status, "warn");
    }

    #[test]
    fn registry_custom_pass() {
        let item = evaluate_npm_registry(Some("https://npm.company.internal/"), None);
        assert_eq!(item.status, "pass");
        assert!(item.message.contains("Custom registry"));
    }

    #[test]
    fn registry_none() {
        let item = evaluate_npm_registry(None, None);
        assert_eq!(item.status, "warn");
    }

    // -- port evaluation --

    #[test]
    fn port_free() {
        let item = evaluate_port(Some(""), None);
        assert_eq!(item.status, "pass");
    }

    #[test]
    fn port_occupied() {
        let lsof = "COMMAND   PID USER   FD   TYPE\nnode    12345 user   22u  IPv4";
        let item = evaluate_port(Some(lsof), None);
        assert_eq!(item.status, "fail");
        assert!(item.message.contains("node"));
        assert!(item.message.contains("12345"));
    }

    #[test]
    fn port_occupied_with_ps_detail() {
        let lsof = "COMMAND   PID USER   FD   TYPE\nnode    12345 user   22u  IPv4";
        let item = evaluate_port(Some(lsof), Some("/usr/local/bin/node"));
        assert_eq!(item.status, "fail");
        assert!(item.message.contains("/usr/local/bin/node"));
        assert!(item.message.contains("12345"));
    }

    #[test]
    fn port_check_failed() {
        let item = evaluate_port(None, None);
        assert_eq!(item.status, "warn");
    }

    // -- disk space evaluation --

    #[test]
    fn disk_space_plenty() {
        let df = "Filesystem 1G-blocks Used Available Capacity\n/dev/disk3s1 460 200 52 44%";
        let item = evaluate_disk_space(Some(df));
        assert_eq!(item.status, "pass");
        assert!(item.message.contains("52GB"));
    }

    #[test]
    fn disk_space_low() {
        let df = "Filesystem 1G-blocks Used Available Capacity\n/dev/disk3s1 460 459 1 100%";
        let item = evaluate_disk_space(Some(df));
        assert_eq!(item.status, "fail");
        assert!(item.message.contains("1GB"));
    }

    #[test]
    fn disk_space_parse_error() {
        let item = evaluate_disk_space(Some("garbage output"));
        assert_eq!(item.status, "warn");
    }

    #[test]
    fn disk_space_none() {
        let item = evaluate_disk_space(None);
        assert_eq!(item.status, "warn");
    }

    // -- memory evaluation --

    #[test]
    fn memory_16gb() {
        // 16GB in bytes
        let item = evaluate_memory(Some("17179869184"));
        assert_eq!(item.status, "pass");
        assert!(item.message.contains("16GB"));
    }

    #[test]
    fn memory_8gb() {
        let item = evaluate_memory(Some("8589934592"));
        assert_eq!(item.status, "pass");
        assert!(item.message.contains("8GB"));
    }

    #[test]
    fn memory_4gb_warn() {
        let item = evaluate_memory(Some("4294967296"));
        assert_eq!(item.status, "warn");
        assert!(item.message.contains("4GB"));
    }

    #[test]
    fn memory_2gb_fail() {
        let item = evaluate_memory(Some("2147483648"));
        assert_eq!(item.status, "fail");
    }

    #[test]
    fn memory_parse_error() {
        let item = evaluate_memory(Some("not_a_number"));
        assert_eq!(item.status, "warn");
    }

    #[test]
    fn memory_none() {
        let item = evaluate_memory(None);
        assert_eq!(item.status, "warn");
    }

    // -- shell_escape tests --
    // Bug: macOS GUI apps don't inherit terminal PATH, so all commands
    // must go through `bash -l -c "cmd args"`. shell_escape ensures
    // arguments with special characters are safely passed.

    #[test]
    fn shell_escape_simple_arg() {
        // Alphanumeric, hyphens, dots, slashes — no escaping needed
        assert_eq!(shell_escape("node"), "node");
        assert_eq!(shell_escape("-v"), "-v");
        assert_eq!(shell_escape("/usr/local/bin/node"), "/usr/local/bin/node");
        assert_eq!(shell_escape("v22.12.0"), "v22.12.0");
    }

    #[test]
    fn shell_escape_url_with_colon() {
        // Colons are allowed without escaping (used in registry URLs)
        assert_eq!(
            shell_escape("https://registry.npmmirror.com"),
            "https://registry.npmmirror.com"
        );
    }

    #[test]
    fn shell_escape_arg_with_spaces() {
        // Spaces trigger single-quote wrapping
        assert_eq!(shell_escape("hello world"), "'hello world'");
    }

    #[test]
    fn shell_escape_arg_with_single_quotes() {
        // Single quotes in the value must be escaped
        assert_eq!(shell_escape("it's"), "'it'\\''s'");
    }

    #[test]
    fn shell_escape_arg_with_special_chars() {
        // Shell metacharacters should be wrapped
        assert_eq!(shell_escape("foo;bar"), "'foo;bar'");
        assert_eq!(shell_escape("$(whoami)"), "'$(whoami)'");
        assert_eq!(shell_escape("a&b"), "'a&b'");
    }

    // -- run_cmd command string building --
    // Regression: Command::new("npm").args(["-v"]) fails in GUI apps
    // because /usr/local/bin is not in PATH. run_cmd must use bash -l -c.

    #[test]
    fn run_cmd_builds_correct_command_no_args() {
        // Verify the full_cmd construction logic (extracted from run_cmd)
        let cmd = "sw_vers";
        let args: &[&str] = &[];
        let full_cmd = if args.is_empty() {
            cmd.to_string()
        } else {
            format!("{} {}", cmd, args.iter().map(|a| shell_escape(a)).collect::<Vec<_>>().join(" "))
        };
        assert_eq!(full_cmd, "sw_vers");
    }

    #[test]
    fn run_cmd_builds_correct_command_with_args() {
        let cmd = "npm";
        let args: &[&str] = &["config", "get", "registry"];
        let full_cmd = format!("{} {}", cmd, args.iter().map(|a| shell_escape(a)).collect::<Vec<_>>().join(" "));
        assert_eq!(full_cmd, "npm config get registry");
    }

    #[test]
    fn run_cmd_builds_correct_command_with_special_args() {
        let cmd = "npm";
        let args: &[&str] = &["config", "set", "registry", "https://registry.npmmirror.com"];
        let full_cmd = format!("{} {}", cmd, args.iter().map(|a| shell_escape(a)).collect::<Vec<_>>().join(" "));
        assert_eq!(full_cmd, "npm config set registry https://registry.npmmirror.com");
    }

    // -- parse_version with openclaw-style versions --
    // Bug: openclaw --version returns "2026.3.2" (year-based versioning).
    // parse_version must handle this format correctly.

    #[test]
    fn parse_version_year_based() {
        assert_eq!(parse_version("2026.3.2"), Some((2026, 3, 2)));
    }

    #[test]
    fn parse_version_year_based_with_newline() {
        assert_eq!(parse_version("2026.3.2\n"), Some((2026, 3, 2)));
    }
}
