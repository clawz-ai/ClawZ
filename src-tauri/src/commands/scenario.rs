use serde::Serialize;
use std::path::PathBuf;

use super::cli::{oc_run_raw, user_shell, with_rc, bg_command, bg_std_command};
use super::model::oc_config_set;

fn resolve_workspace_path(agent_id: Option<&str>) -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Failed to get HOME directory")?;
    let base = PathBuf::from(&home).join(".openclaw");

    let id = agent_id.unwrap_or("main");
    if id == "main" {
        let ws = base.join("workspace");
        if !ws.exists() {
            std::fs::create_dir_all(&ws)
                .map_err(|e| format!("Failed to create main workspace: {}", e))?;
        }
        return Ok(ws);
    }

    // Non-main agents: try ~/.openclaw/agents/{id}/workspace/ first,
    // then fall back to reading the agent's configured workspace from the agent dir.
    let agent_ws = base.join("agents").join(id).join("workspace");
    if agent_ws.exists() {
        return Ok(agent_ws);
    }

    // Try to create it
    std::fs::create_dir_all(&agent_ws)
        .map_err(|e| format!("Failed to create agent workspace: {}", e))?;
    Ok(agent_ws)
}

#[tauri::command]
pub async fn apply_scenario(
    soul: String,
    identity: String,
    heartbeat: String,
    name: String,
    emoji: String,
    agent_id: Option<String>,
) -> Result<String, String> {
    let id = agent_id.as_deref().unwrap_or("main");
    log::info!("applying scenario: {} {} (agent: {})", emoji, name, id);

    let workspace = resolve_workspace_path(Some(id))?;

    if !workspace.exists() {
        return Err(format!(
            "Workspace directory does not exist: {}",
            workspace.display()
        ));
    }

    // Write SOUL.md
    tokio::fs::write(workspace.join("SOUL.md"), &soul)
        .await
        .map_err(|e| format!("Failed to write SOUL.md: {}", e))?;
    log::info!("wrote SOUL.md (agent: {})", id);

    // Write IDENTITY.md
    tokio::fs::write(workspace.join("IDENTITY.md"), &identity)
        .await
        .map_err(|e| format!("Failed to write IDENTITY.md: {}", e))?;
    log::info!("wrote IDENTITY.md (agent: {})", id);

    // Write HEARTBEAT.md
    tokio::fs::write(workspace.join("HEARTBEAT.md"), &heartbeat)
        .await
        .map_err(|e| format!("Failed to write HEARTBEAT.md: {}", e))?;
    log::info!("wrote HEARTBEAT.md (agent: {})", id);

    // Update agent identity via bundled openclaw
    let args = format!(
        "agents set-identity --agent {} --name {} --emoji {}",
        shell_escape(id),
        shell_escape(&name),
        shell_escape(&emoji),
    );
    match oc_run_raw("set_identity", &args, None).await {
        Ok(_) => log::info!("updated agent identity (agent: {})", id),
        Err(e) => {
            log::warn!("set-identity returned non-zero status: {}", e);
            // Non-fatal: files are already written, identity update is best-effort
        }
    }

    Ok(format!("Scenario '{}' applied to agent {}", name, id))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPersona {
    pub soul: String,
    pub identity: String,
    pub heartbeat: String,
    pub name: String,
    pub emoji: String,
}

#[tauri::command]
pub async fn read_agent_persona(agent_id: Option<String>) -> Result<AgentPersona, String> {
    let id = agent_id.as_deref().unwrap_or("main");
    log::info!("reading agent persona: {}", id);

    let workspace = resolve_workspace_path(Some(id))?;

    let read_file = |filename: &str| -> String {
        let path = workspace.join(filename);
        std::fs::read_to_string(&path).unwrap_or_default()
    };

    let soul = read_file("SOUL.md");
    let identity = read_file("IDENTITY.md");
    let heartbeat = read_file("HEARTBEAT.md");

    // Try to get agent identity name/emoji from the config
    let home = std::env::var("HOME").unwrap_or_default();
    let config_path = PathBuf::from(&home).join(".openclaw/openclaw.json");
    let (name, emoji) = if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            let agents = config.pointer("/agents/list").and_then(|v| v.as_array());
            let agent = agents
                .and_then(|list| list.iter().find(|a| a.get("id").and_then(|v| v.as_str()) == Some(id)));
            let name = agent
                .and_then(|a| a.pointer("/identity/name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let emoji = agent
                .and_then(|a| a.pointer("/identity/emoji"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            (name, emoji)
        } else {
            (String::new(), String::new())
        }
    } else {
        (String::new(), String::new())
    };

    Ok(AgentPersona {
        soul,
        identity,
        heartbeat,
        name,
        emoji,
    })
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

const VALID_TOOLS_PROFILES: &[&str] = &["minimal", "coding", "messaging", "full"];

#[tauri::command]
pub async fn set_tools_profile(profile: String) -> Result<String, String> {
    if !VALID_TOOLS_PROFILES.contains(&profile.as_str()) {
        return Err(format!(
            "Invalid tools.profile value: {} (allowed: {})",
            profile,
            VALID_TOOLS_PROFILES.join(", ")
        ));
    }
    log::info!("setting tools.profile = {}", profile);
    oc_config_set("tools.profile", &format!("\"{}\"", profile)).await?;
    Ok(format!("tools.profile set to {}", profile))
}

/// Enable a list of OpenClaw skills by setting skills.entries.<name>.enabled = true.
#[tauri::command]
pub async fn enable_scenario_skills(skills: Vec<String>) -> Result<String, String> {
    if skills.is_empty() {
        return Ok("No skills to enable".into());
    }
    log::info!("enabling scenario skills: {:?}", skills);
    for skill in &skills {
        oc_config_set(
            &format!("skills.entries.{}.enabled", skill),
            "true",
        )
        .await
        .map_err(|e| format!("Failed to enable skill {}: {}", skill, e))?;
    }
    Ok(format!("Enabled {} skills", skills.len()))
}

// --- Skill listing ---

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallHint {
    pub kind: String,    // "brew" | "go" | "npm" | "uv" | "node" | "download" | "apt"
    pub label: String,   // human-readable label
    pub command: String,  // e.g. "brew install himalaya" or "go install github.com/..."
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub source: String, // "bundled" | "workspace" | "managed"
    pub ready: bool,
    pub enabled: bool,
    pub missing_deps: Vec<String>,
    pub trusted: bool,
    pub homepage: Option<String>,
    pub install_hints: Vec<SkillInstallHint>,
}

/// Read enabled state for all skills from openclaw.json.
fn read_skills_enabled_map() -> std::collections::HashMap<String, bool> {
    let mut map = std::collections::HashMap::new();
    let home = std::env::var("HOME").unwrap_or_default();
    let config_path = PathBuf::from(&home).join(".openclaw/openclaw.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(entries) = config.pointer("/skills/entries").and_then(|v| v.as_object()) {
                for (name, val) in entries {
                    let enabled = val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
                    map.insert(name.clone(), enabled);
                }
            }
        }
    }
    map
}

/// Parse SKILL.md frontmatter to extract name and description.
fn parse_skill_frontmatter(content: &str) -> Option<(String, String)> {
    let frontmatter = extract_frontmatter(content)?;

    let mut name = String::new();
    let mut desc = String::new();
    for line in frontmatter.lines() {
        if let Some(v) = line.strip_prefix("name:") {
            name = v.trim().trim_matches('"').to_string();
        } else if let Some(v) = line.strip_prefix("description:") {
            desc = v.trim().trim_matches('"').to_string();
        }
    }
    if name.is_empty() {
        return None;
    }
    Some((name, desc))
}

/// Scan a skills directory and return SkillInfo entries.
fn scan_skills_dir(dir: &std::path::Path, source: &str) -> Vec<SkillInfo> {
    let mut skills = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return skills,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&skill_md) {
            if let Some((name, description)) = parse_skill_frontmatter(&content) {
                // Check binary requirements from metadata
                let missing = check_skill_deps(&content);
                let ready = missing.is_empty();
                let homepage = parse_homepage(&content);
                let install_hints = parse_install_hints(&content);
                skills.push(SkillInfo {
                    name,
                    description,
                    source: source.to_string(),
                    ready,
                    enabled: false, // populated later by list_skills
                    missing_deps: missing,
                    trusted: false, // populated later by list_skills
                    homepage,
                    install_hints,
                });
            }
        }
    }
    skills
}

/// Extract requires.bins from metadata and check availability.
fn check_skill_deps(content: &str) -> Vec<String> {
    // Quick extraction of requires.bins from metadata JSON in frontmatter
    let mut missing = Vec::new();

    // Look for "requires" in metadata
    if let Some(meta_start) = content.find("\"requires\"") {
        if let Some(bins_start) = content[meta_start..].find("\"bins\"") {
            let offset = meta_start + bins_start;
            if let Some(arr_start) = content[offset..].find('[') {
                let arr_offset = offset + arr_start + 1;
                if let Some(arr_end) = content[arr_offset..].find(']') {
                    let arr_content = &content[arr_offset..arr_offset + arr_end];
                    for bin in arr_content.split(',') {
                        let bin = bin.trim().trim_matches('"').trim_matches('\'');
                        if bin.is_empty() {
                            continue;
                        }
                        // Check if binary exists on PATH (with user shell env + tool bin dirs)
                        let home = std::env::var("HOME").unwrap_or_default();
                        #[cfg(target_os = "macos")]
                        let extra_paths = format!(
                            "export PATH=\"{home}/go/bin:{home}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; command -v {}",
                            bin
                        );
                        #[cfg(not(target_os = "macos"))]
                        let extra_paths = format!(
                            "export PATH=\"{home}/go/bin:{home}/.cargo/bin:{home}/.local/bin:/usr/local/bin:$PATH\"; command -v {}",
                            bin
                        );
                        let check_cmd = with_rc(&extra_paths);
                        let found = bg_std_command(user_shell())
                            .args(["-l", "-c", &check_cmd])
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .status()
                            .map(|s| s.success())
                            .unwrap_or(false);
                        if !found {
                            missing.push(bin.to_string());
                        }
                    }
                }
            }
        }
    }
    missing
}

/// Parse homepage from SKILL.md frontmatter.
fn parse_homepage(content: &str) -> Option<String> {
    let frontmatter = extract_frontmatter(content)?;
    for line in frontmatter.lines() {
        if let Some(v) = line.strip_prefix("homepage:") {
            let url = v.trim().trim_matches('"').trim();
            if !url.is_empty() {
                return Some(url.to_string());
            }
        }
    }
    None
}

/// Parse install hints from SKILL.md metadata JSON.
fn parse_install_hints(content: &str) -> Vec<SkillInstallHint> {
    let frontmatter = match extract_frontmatter(content) {
        Some(f) => f,
        None => return vec![],
    };
    // Find metadata JSON block within frontmatter
    let meta_start = match frontmatter.find("metadata:") {
        Some(i) => i + "metadata:".len(),
        None => return vec![],
    };
    let meta_str = frontmatter[meta_start..].trim();
    // Try to parse the JSON5-ish metadata — use serde_json on cleaned input
    let cleaned = clean_json5(meta_str);
    let meta: serde_json::Value = match serde_json::from_str(&cleaned) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let installs = match meta.pointer("/openclaw/install").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return vec![],
    };
    installs
        .iter()
        .filter_map(|entry| {
            let kind = entry.get("kind")?.as_str()?.to_string();
            // Filter out platform-incompatible install methods
            if cfg!(target_os = "macos") && kind == "apt" {
                return None;
            }
            if cfg!(target_os = "linux") && kind == "brew" {
                return None;
            }
            let label = entry.get("label").and_then(|v| v.as_str())
                .unwrap_or("Install")
                .to_string();
            let command = build_install_command(&kind, entry);
            command.map(|cmd| SkillInstallHint { kind, label, command: cmd })
        })
        .collect()
}

/// Build the actual shell command for an install hint.
fn build_install_command(kind: &str, entry: &serde_json::Value) -> Option<String> {
    match kind {
        "brew" => {
            let formula = entry.get("formula").and_then(|v| v.as_str())?;
            Some(format!("brew install {}", formula))
        }
        "go" => {
            let module = entry.get("module").and_then(|v| v.as_str())?;
            Some(format!("go install {}", module))
        }
        "npm" => {
            let package = entry.get("package").and_then(|v| v.as_str())?;
            Some(format!("npm install -g {}", package))
        }
        "node" => {
            let package = entry.get("package").and_then(|v| v.as_str())?;
            Some(format!("npm install -g {}", package))
        }
        "uv" => {
            let package = entry.get("package").and_then(|v| v.as_str())?;
            Some(format!("uv tool install {}", package))
        }
        "apt" => {
            let package = entry.get("package").and_then(|v| v.as_str())?;
            Some(format!("apt install {}", package))
        }
        "download" => {
            let url = entry.get("url").and_then(|v| v.as_str())?;
            Some(format!("curl -fsSL {} -o /tmp/download", url))
        }
        _ => None,
    }
}

/// Extract frontmatter between --- markers.
fn extract_frontmatter(content: &str) -> Option<&str> {
    if !content.starts_with("---") {
        return None;
    }
    let rest = &content[3..];
    let end = rest.find("---")?;
    Some(&rest[..end])
}

/// Clean JSON5-style input to valid JSON (trailing commas, unquoted keys, comments).
fn clean_json5(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;

    while let Some(c) = chars.next() {
        if in_string {
            result.push(c);
            if c == '\\' {
                if let Some(&next) = chars.peek() {
                    result.push(next);
                    chars.next();
                }
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                result.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                // Line comment — skip to end of line
                for nc in chars.by_ref() {
                    if nc == '\n' { break; }
                }
            }
            ',' => {
                // Keep comma but remove if followed by } or ]
                let rest = result.len();
                result.push(',');
                // We'll fix trailing commas in a second pass
                let _ = rest;
            }
            _ => result.push(c),
        }
    }
    // Remove trailing commas before } or ]
    let bytes = result.as_bytes();
    let mut cleaned = String::with_capacity(result.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b',' {
            // Look ahead past whitespace for } or ]
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\n' || bytes[j] == b'\r' || bytes[j] == b'\t') {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b'}' || bytes[j] == b']') {
                // Skip the trailing comma
                i += 1;
                continue;
            }
        }
        cleaned.push(bytes[i] as char);
        i += 1;
    }
    cleaned
}

/// Find the OpenClaw bundled skills directory.
fn find_bundled_skills_dir() -> Option<PathBuf> {
    // 1. Check the app-bundled openclaw package (Full build)
    if let Ok(openclaw_mjs) = super::cli::bundled_openclaw() {
        // openclaw.mjs lives at .../openclaw/openclaw.mjs, skills at .../openclaw/skills
        if let Some(pkg_dir) = openclaw_mjs.parent() {
            let p = pkg_dir.join("skills");
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 2. Try common system locations
    #[cfg(target_os = "macos")]
    let candidates: &[&str] = &[
        "/opt/homebrew/lib/node_modules/openclaw/skills",
        "/usr/local/lib/node_modules/openclaw/skills",
    ];
    #[cfg(target_os = "linux")]
    let candidates: &[&str] = &[
        "/usr/lib/node_modules/openclaw/skills",
        "/usr/local/lib/node_modules/openclaw/skills",
    ];
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let candidates: &[&str] = &[
        "/usr/local/lib/node_modules/openclaw/skills",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }

    // 3. Try `npm root -g` + openclaw/skills
    let npm_root_cmd = with_rc("npm root -g 2>/dev/null");
    let output = bg_std_command(user_shell())
        .args(["-l", "-c", &npm_root_cmd])
        .output()
        .ok()?;
    if output.status.success() {
        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let p = PathBuf::from(&root).join("openclaw/skills");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Our own config file for ClawZ-specific settings that openclaw doesn't recognize.
fn clawz_config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(&home).join(".openclaw/clawz.json")
}

fn read_clawz_config() -> serde_json::Value {
    clawz_config_path()
        .to_str()
        .and_then(|_| std::fs::read_to_string(clawz_config_path()).ok())
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_clawz_config(config: &serde_json::Value) -> Result<(), String> {
    let path = clawz_config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Serialization failed: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {}", e))
}

/// Read trusted skill sources. Default: ["bundled"].
fn read_trusted_sources() -> Vec<String> {
    let config = read_clawz_config();
    if let Some(arr) = config.pointer("/skills/trustedSources").and_then(|v| v.as_array()) {
        let sources: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
        if !sources.is_empty() {
            return sources;
        }
    }
    vec!["bundled".to_string()]
}

#[tauri::command]
pub async fn set_trusted_sources(sources: Vec<String>) -> Result<String, String> {
    let valid = ["bundled", "managed", "workspace"];
    for s in &sources {
        if !valid.contains(&s.as_str()) {
            return Err(format!("Invalid source: {} (allowed: {})", s, valid.join(", ")));
        }
    }
    if sources.is_empty() {
        return Err("At least one trusted source is required".into());
    }
    log::info!("setting skills.trustedSources = {:?}", sources);
    let mut config = read_clawz_config();
    let skills = config.as_object_mut().unwrap()
        .entry("skills").or_insert_with(|| serde_json::json!({}));
    skills["trustedSources"] = serde_json::json!(sources);
    write_clawz_config(&config)?;
    Ok(format!("Trusted sources set: {}", sources.join(", ")))
}

#[tauri::command]
pub async fn get_trusted_sources() -> Result<Vec<String>, String> {
    Ok(read_trusted_sources())
}

#[tauri::command]
pub async fn list_skills(agent_id: Option<String>) -> Result<Vec<SkillInfo>, String> {
    let id = agent_id.as_deref().unwrap_or("main");
    log::info!("listing skills (agent: {})", id);

    let trusted_sources = read_trusted_sources();

    let mut all: Vec<SkillInfo> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 1. Workspace skills (highest priority)
    if let Ok(workspace) = resolve_workspace_path(Some(id)) {
        let ws_skills_dir = workspace.join("skills");
        for skill in scan_skills_dir(&ws_skills_dir, "workspace") {
            seen.insert(skill.name.clone());
            all.push(skill);
        }
    }

    // 2. Managed skills (~/.openclaw/skills/)
    let home = std::env::var("HOME").unwrap_or_default();
    let managed_dir = PathBuf::from(&home).join(".openclaw/skills");
    for skill in scan_skills_dir(&managed_dir, "managed") {
        if seen.insert(skill.name.clone()) {
            all.push(skill);
        }
    }

    // 3. Bundled skills
    if let Some(bundled_dir) = find_bundled_skills_dir() {
        for skill in scan_skills_dir(&bundled_dir, "bundled") {
            if seen.insert(skill.name.clone()) {
                all.push(skill);
            }
        }
    }

    // Populate enabled state and trusted flag
    let enabled_map = read_skills_enabled_map();
    for skill in &mut all {
        skill.enabled = enabled_map.get(&skill.name).copied().unwrap_or(false);
        skill.trusted = trusted_sources.contains(&skill.source);
    }

    // Filter: only show skills from trusted sources
    all.retain(|s| s.trusted);

    all.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(all)
}

/// Enable or disable a single skill by name.
#[tauri::command]
pub async fn set_skill_enabled(name: String, enabled: bool) -> Result<String, String> {
    log::info!("setting skill {} enabled={}", name, enabled);
    oc_config_set(
        &format!("skills.entries.{}.enabled", name),
        if enabled { "true" } else { "false" },
    )
    .await
    .map_err(|e| format!("Failed to set skill {}: {}", name, e))?;
    Ok(format!("skill {} {}", name, if enabled { "enabled" } else { "disabled" }))
}

/// Check if a binary is available in the user's PATH (including common tool dirs).
async fn has_binary(name: &str) -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    #[cfg(target_os = "macos")]
    let check = format!(
        "export PATH=\"{home}/go/bin:{home}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; command -v {}",
        name
    );
    #[cfg(not(target_os = "macos"))]
    let check = format!(
        "export PATH=\"{home}/go/bin:{home}/.cargo/bin:{home}/.local/bin:/usr/local/bin:$PATH\"; command -v {}",
        name
    );
    let shell_cmd = with_rc(&check);
    bg_command(user_shell())
        .args(["-l", "-c", &shell_cmd])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Run a single shell command with timeout, returning Ok/Err.
async fn run_install_cmd(cmd: &str) -> Result<String, String> {
    log::info!("[install_skill_deps] running: {}", cmd);
    let shell_cmd = with_rc(cmd);
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        bg_command(user_shell())
            .args(["-l", "-c", &shell_cmd])
            .output(),
    )
    .await
    .map_err(|_| format!("Installation timed out (5min): {}", cmd))?
    .map_err(|e| format!("Failed to run install command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("Installation failed: {}\n{}\n{}", cmd, stdout.trim(), stderr.trim()));
    }
    Ok(format!("Installation succeeded: {}", cmd))
}

/// Prerequisite tool → brew formula mapping.
/// When a command needs e.g. `go` but it's not installed, we auto-install it via brew.
const PREREQ_MAP: &[(&str, &str)] = &[
    ("go install", "go"),
    ("npm install", "node"),
    ("pip install", "python3"),
];

/// Install a skill dependency by running the given shell command.
/// Automatically installs prerequisite tools (e.g. `go` via brew) if needed.
#[tauri::command]
pub async fn install_skill_deps(deps: Vec<String>) -> Result<String, String> {
    if deps.is_empty() {
        return Ok("No dependencies to install".into());
    }

    // Determine if this is a single install command or legacy bare dep names
    let cmd = if deps.len() == 1 && deps[0].contains(' ') {
        deps[0].clone()
    } else {
        for dep in &deps {
            if dep.is_empty() || !dep.chars().all(|c| c.is_alphanumeric() || "-_@/.".contains(c)) {
                return Err(format!("Invalid dependency name: {}", dep));
            }
        }
        #[cfg(target_os = "macos")]
        { format!("brew install {}", deps.join(" ")) }
        #[cfg(target_os = "linux")]
        { format!("sudo apt-get install -y {}", deps.join(" ")) }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        { format!("brew install {}", deps.join(" ")) }
    };

    // Validate command starts with an allowed prefix
    let allowed_prefixes = ["brew install", "go install", "npm install", "uv tool install", "apt install", "sudo apt-get install", "pip install"];
    if !allowed_prefixes.iter().any(|p| cmd.starts_with(p)) {
        return Err(format!("Unsupported install command: {}", cmd));
    }

    // Auto-install prerequisite tools if needed (e.g. `go` for `go install`)
    for &(prefix, tool) in PREREQ_MAP {
        if cmd.starts_with(prefix) && !has_binary(tool).await {
            #[cfg(target_os = "macos")]
            let install_cmd = format!("brew install {}", tool);
            #[cfg(target_os = "linux")]
            let install_cmd = format!("sudo apt-get install -y {}", tool);
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            let install_cmd = format!("brew install {}", tool);
            log::info!("[install_skill_deps] prerequisite '{}' not found, installing via: {}", tool, install_cmd);
            run_install_cmd(&install_cmd).await?;
        }
    }

    let result = run_install_cmd(&cmd).await?;

    // After go install, ensure ~/go/bin is in PATH via shell rc file
    if cmd.starts_with("go install") {
        ensure_path_in_rc("$HOME/go/bin").await;
    }

    Ok(result)
}

/// Ensure a directory is in the user's shell rc PATH.
/// Appends `export PATH="<dir>:$PATH"` if not already present.
async fn ensure_path_in_rc(dir: &str) {
    let home = std::env::var("HOME").unwrap_or_default();
    let shell = user_shell();
    let rc_path = if shell.contains("zsh") {
        format!("{}/.zshrc", home)
    } else {
        format!("{}/.bashrc", home)
    };

    // Check if already present
    let rc_content = std::fs::read_to_string(&rc_path).unwrap_or_default();
    let search = dir.replace("$HOME", &home);
    if rc_content.contains(dir) || rc_content.contains(&search) {
        log::info!("[ensure_path_in_rc] {} already in {}", dir, rc_path);
        return;
    }

    // Append
    let line = format!("\n# Added by ClawZ for skill dependencies\nexport PATH=\"{}:$PATH\"\n", dir);
    match std::fs::OpenOptions::new().append(true).open(&rc_path) {
        Ok(mut f) => {
            use std::io::Write;
            if let Err(e) = f.write_all(line.as_bytes()) {
                log::warn!("[ensure_path_in_rc] write failed: {}", e);
            } else {
                log::info!("[ensure_path_in_rc] added {} to {}", dir, rc_path);
            }
        }
        Err(e) => log::warn!("[ensure_path_in_rc] open {} failed: {}", rc_path, e),
    }
}
