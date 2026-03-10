use std::path::PathBuf;
use std::process::Stdio;
use std::sync::OnceLock;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

/// Create a `tokio::process::Command` for a background (non-GUI) subprocess.
///
/// On macOS, child processes inherit the parent Tauri app's bundle context,
/// causing the OS to register them with the Window Server and display a
/// transient Dock/menu-bar icon. Two mitigations are applied:
/// 1. Unset GUI-session env vars (`__CFBundleIdentifier`, `__ApplePID`,
///    `TERM_PROGRAM`) so Core Foundation does not recognize the child.
/// 2. `pre_exec(setsid)` creates a **new session**, which implicitly creates
///    a new process group AND detaches from the controlling terminal / GUI
///    session. This is the strongest Unix isolation primitive.
///
/// NOTE: `process_group(0)` must NOT be used together with `setsid()`.
/// Rust's Command calls `setpgid(0,0)` before `pre_exec` closures, making
/// the child a process-group leader — and `setsid()` fails (EPERM) if the
/// caller is already a PG leader.
pub fn bg_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "macos")]
    {
        cmd.env_remove("__CFBundleIdentifier");
        cmd.env_remove("__ApplePID");
        cmd.env_remove("TERM_PROGRAM");
        // Safety: setsid() is async-signal-safe (POSIX). After fork the child
        // is NOT a process-group leader (its PID is fresh, PGID is inherited),
        // so setsid() is guaranteed to succeed.
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }
    cmd
}

/// Synchronous variant for use with `std::process::Command`.
pub fn bg_std_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::process::CommandExt;
        cmd.env_remove("__CFBundleIdentifier");
        cmd.env_remove("__ApplePID");
        cmd.env_remove("TERM_PROGRAM");
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }
    cmd
}

/// Initialized once in `lib.rs::setup()` with the app's resource directory.
/// Used to locate the bundled openclaw package at runtime.
pub(crate) static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_resource_dir(path: PathBuf) {
    let _ = RESOURCE_DIR.set(path);
}

/// Resolve the bundled Node.js binary.
///
/// Production layout differs by platform:
/// - macOS: `{RESOURCE_DIR}/NodeHelper.app/Contents/MacOS/node`
///   (Helper app with LSUIElement=true suppresses Dock icons)
/// - Linux: `{RESOURCE_DIR}/node/bin/node`
///
/// In dev mode it falls back to the system `node`.
pub fn bundled_node() -> PathBuf {
    // Production: resource dir set by setup()
    if let Some(res) = RESOURCE_DIR.get() {
        #[cfg(target_os = "macos")]
        {
            let node = res.join("NodeHelper.app/Contents/MacOS/node");
            if node.exists() {
                return node;
            }
        }
        #[cfg(target_os = "linux")]
        {
            let node = res.join("node/bin/node");
            if node.exists() {
                return node;
            }
        }
    }
    // Dev fallback: probe common system paths.
    #[cfg(target_os = "macos")]
    let candidates: &[&str] = &[
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    #[cfg(target_os = "linux")]
    let candidates: &[&str] = &[
        "/usr/bin/node",
        "/usr/local/bin/node",
        "/snap/bin/node",
    ];
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let candidates: &[&str] = &["/usr/bin/node", "/usr/local/bin/node"];

    for candidate in candidates {
        if std::path::Path::new(candidate).exists() {
            return PathBuf::from(candidate);
        }
    }
    // Last resort: hope it's in PATH
    PathBuf::from("node")
}

/// Resolve the bundled `openclaw.mjs` entry point.
///
/// Tries the bundled resources first (production), then common system locations
/// (Homebrew, npm global) for development convenience.
pub fn bundled_openclaw() -> Result<PathBuf, String> {
    // Production: resource dir set by setup()
    if let Some(res) = RESOURCE_DIR.get() {
        let p = res.join("openclaw/node_modules/openclaw/openclaw.mjs");
        if p.exists() {
            return Ok(p);
        }
    }
    // Dev fallback: check common npm global install paths
    #[cfg(target_os = "macos")]
    let candidates: &[&str] = &[
        "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs",
        "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
    ];
    #[cfg(target_os = "linux")]
    let candidates: &[&str] = &[
        "/usr/lib/node_modules/openclaw/openclaw.mjs",
        "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
    ];
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let candidates: &[&str] = &[
        "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
    ];
    for candidate in candidates {
        if std::path::Path::new(candidate).exists() {
            return Ok(PathBuf::from(candidate));
        }
    }
    Err("openclaw.mjs not found — bundled resource missing".to_string())
}

/// Truncate a string for logging (first N bytes + "…" if truncated).
/// Safely handles multi-byte UTF-8 by finding the nearest char boundary.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…({} bytes total)", &s[..end], s.len())
    }
}

/// Extract the JSON portion from CLI output that may contain plugin log noise.
/// Strips `[plugins]` and `Config ` lines first, then finds the first `{` or `[`.
pub fn extract_json(raw: &str) -> String {
    let cleaned: String = raw
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.starts_with("[plugins]") && !t.starts_with("Config ")
        })
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = cleaned.trim();
    let obj = trimmed.find('{');
    let arr = trimmed.find('[');
    let start = match (obj, arr) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => {
            log::warn!(
                "[extract_json] no JSON delimiter found, raw={}",
                truncate(raw, 500)
            );
            return trimmed.to_string();
        }
    };
    trimmed[start..].to_string()
}

/// Pick the most meaningful error line from noisy CLI output,
/// skipping plugin registration and config warning lines.
pub fn pick_error(s: &str) -> String {
    s.lines()
        .rev()
        .find(|l| {
            let t = l.trim();
            !t.is_empty()
                && !t.starts_with("[plugins]")
                && !t.starts_with("Config ")
                && !t.starts_with("- plugins.")
        })
        .unwrap_or(s.trim())
        .trim()
        .to_string()
}

fn has_json(raw: &str) -> bool {
    let json = extract_json(raw);
    let trimmed = json.trim();
    trimmed.starts_with('{') || trimmed.starts_with('[')
}

/// Run an `openclaw` CLI subcommand via the bundled Node.js runtime.
///
/// `args` is a shell-style argument string (e.g. `"agents list --json"` or
/// `"channels add --channel 'telegram' --token 'abc'"`) — single-quoted values
/// produced by `shell_escape()` are parsed by `shlex` into a proper argv.
///
/// Logging strategy:
/// - `info`  : command string, exit status, extracted JSON length
/// - `debug` : full raw stdout/stderr
/// - `warn`  : non-empty stderr on success
/// - `error` : command failure with full stdout + stderr
pub async fn oc_run(tag: &str, args: &str) -> Result<String, String> {
    let node = bundled_node();
    let openclaw = bundled_openclaw()?;

    let argv = shlex::split(args).ok_or_else(|| {
        format!("[oc_run:{}] failed to parse args: {}", tag, args)
    })?;

    log::info!(
        "[oc_run:{}] node={}, argv={:?}",
        tag,
        node.display(),
        argv
    );

    let t0 = std::time::Instant::now();
    let output = timeout(
        Duration::from_secs(30),
        bg_command(&node)
            .arg(&openclaw)
            .args(&argv)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| {
        log::error!("[oc_run:{}] command timed out (30s): openclaw {}", tag, args);
        format!("Command timed out (30s): openclaw {}", args)
    })?
    .map_err(|e| {
        log::error!("[oc_run:{}] failed to spawn process: {}", tag, e);
        format!("Failed to execute openclaw: {}", e)
    })?;
    let elapsed = t0.elapsed();

    let raw_stdout = String::from_utf8_lossy(&output.stdout);
    let raw_stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        let json = extract_json(&raw_stdout);

        log::info!(
            "[oc_run:{}] ok ({:.1}s) json_len={}",
            tag,
            elapsed.as_secs_f64(),
            json.len()
        );
        log::debug!(
            "[oc_run:{}] raw_stdout={}",
            tag,
            truncate(&raw_stdout, 2000)
        );
        if !raw_stderr.trim().is_empty() {
            log::debug!(
                "[oc_run:{}] stderr(warn)={}",
                tag,
                truncate(&raw_stderr, 1000)
            );
        }

        Ok(json)
    } else {
        if has_json(&raw_stdout) {
            let json = extract_json(&raw_stdout);
            log::warn!(
                "[oc_run:{}] exit={} ({:.1}s) but stdout has JSON (json_len={}), returning it",
                tag,
                output.status,
                elapsed.as_secs_f64(),
                json.len()
            );
            log::info!(
                "[oc_run:{}] conflict_json={}",
                tag,
                truncate(&json, 2000)
            );
            log::debug!(
                "[oc_run:{}] stderr={}",
                tag,
                truncate(&raw_stderr, 1000)
            );
            return Ok(json);
        }

        let msg = if !raw_stderr.trim().is_empty() {
            pick_error(&raw_stderr)
        } else if !raw_stdout.trim().is_empty() {
            pick_error(&raw_stdout)
        } else {
            format!("exit code: {}", output.status)
        };

        log::error!(
            "[oc_run:{}] command failed ({:.1}s) exit={}: {}",
            tag,
            elapsed.as_secs_f64(),
            output.status,
            msg
        );
        log::error!(
            "[oc_run:{}] stdout={}",
            tag,
            truncate(&raw_stdout, 2000)
        );
        log::error!(
            "[oc_run:{}] stderr={}",
            tag,
            truncate(&raw_stderr, 2000)
        );
        Err(msg)
    }
}

/// Like `oc_run()` but returns raw stdout (no JSON extraction).
/// Useful for commands like `doctor` that produce human-readable output,
/// or `gateway start/stop/restart` whose output is a plain status message.
///
/// Accepts an optional custom timeout (defaults to 30s).
pub async fn oc_run_raw(tag: &str, args: &str, timeout_secs: Option<u64>) -> Result<String, String> {
    let node = bundled_node();
    let openclaw = bundled_openclaw()?;

    let argv = shlex::split(args).ok_or_else(|| {
        format!("[oc_run_raw:{}] failed to parse args: {}", tag, args)
    })?;

    log::info!(
        "[oc_run_raw:{}] node={}, argv={:?}",
        tag,
        node.display(),
        argv
    );

    let secs = timeout_secs.unwrap_or(30);
    let t0 = std::time::Instant::now();
    let output = timeout(
        Duration::from_secs(secs),
        bg_command(&node)
            .arg(&openclaw)
            .args(&argv)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| {
        log::error!("[oc_run_raw:{}] command timed out ({}s): openclaw {}", tag, secs, args);
        format!("Command timed out ({}s): openclaw {}", secs, args)
    })?
    .map_err(|e| {
        log::error!("[oc_run_raw:{}] failed to spawn process: {}", tag, e);
        format!("Failed to execute openclaw: {}", e)
    })?;
    let elapsed = t0.elapsed();

    let raw_stdout = String::from_utf8_lossy(&output.stdout);
    let raw_stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        log::info!(
            "[oc_run_raw:{}] ok ({:.1}s) len={}",
            tag,
            elapsed.as_secs_f64(),
            raw_stdout.len()
        );
        Ok(raw_stdout.to_string())
    } else {
        let msg = if !raw_stderr.trim().is_empty() {
            pick_error(&raw_stderr)
        } else if !raw_stdout.trim().is_empty() {
            pick_error(&raw_stdout)
        } else {
            format!("exit code: {}", output.status)
        };

        log::error!(
            "[oc_run_raw:{}] command failed ({:.1}s) exit={}: {}",
            tag,
            elapsed.as_secs_f64(),
            output.status,
            msg
        );
        log::error!(
            "[oc_run_raw:{}] stdout={}",
            tag,
            truncate(&raw_stdout, 2000)
        );
        log::error!(
            "[oc_run_raw:{}] stderr={}",
            tag,
            truncate(&raw_stderr, 2000)
        );
        Err(msg)
    }
}

/// Parse a JSON string with diagnostic logging on failure.
pub fn parse_json<T: serde::de::DeserializeOwned>(raw: &str, context: &str) -> Result<T, String> {
    serde_json::from_str(raw).map_err(|e| {
        log::error!(
            "[parse_json:{}] parse failed: {}, raw={}",
            context,
            e,
            truncate(raw, 500)
        );
        format!("{}: {}", context, e)
    })
}

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Return the user's default login shell (e.g. `/bin/zsh`).
/// Used by commands that need to run non-openclaw shell operations
/// (gateway daemon, skill dependency installs, etc.).
pub fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

/// Prepend common tool directories to PATH so that shell commands launched
/// from a GUI context can find package managers, npm-global, and similar tools.
pub fn with_rc(cmd: &str) -> String {
    #[cfg(target_os = "macos")]
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$HOME/.cargo/bin:$HOME/go/bin";
    #[cfg(target_os = "linux")]
    let extra = "/usr/local/bin:/usr/local/sbin:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:/snap/bin";
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let extra = "/usr/local/bin:$HOME/.cargo/bin";
    format!("export PATH=\"{extra}:$PATH\"; {cmd}")
}
