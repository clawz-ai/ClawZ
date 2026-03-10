use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

/// Read the last N gateway log entries.
///
/// Prefers the structured JSONL daily logs at `/tmp/openclaw/openclaw-*.log`
/// which carry explicit log levels (`_meta.logLevelName`).
/// Falls back to the plain-text `~/.openclaw/logs/gateway.log` if JSONL is unavailable.
#[tauri::command]
pub async fn read_gateway_logs(limit: usize) -> Result<Vec<LogEntry>, String> {
    // Try structured JSONL daily logs first
    let jsonl_entries = read_jsonl_daily_logs(limit).await;
    if !jsonl_entries.is_empty() {
        return Ok(jsonl_entries);
    }

    // Fallback: plain-text gateway.log
    let home = std::env::var("HOME").map_err(|_| "Failed to get HOME directory")?;
    let log_path = PathBuf::from(home)
        .join(".openclaw")
        .join("logs")
        .join("gateway.log");

    let content = tokio::fs::read_to_string(&log_path)
        .await
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > limit {
        lines.len() - limit
    } else {
        0
    };

    let mut entries = Vec::new();
    for line in &lines[start..] {
        if line.trim().is_empty() {
            continue;
        }
        entries.push(parse_log_line(line));
    }

    Ok(entries)
}

/// Read structured JSONL daily logs from `/tmp/openclaw/openclaw-*.log`.
///
/// These files contain one JSON object per line with `_meta.logLevelName`
/// providing accurate INFO / WARN / ERROR / DEBUG classification.
async fn read_jsonl_daily_logs(limit: usize) -> Vec<LogEntry> {
    let dir = PathBuf::from("/tmp/openclaw");
    let mut log_files: Vec<PathBuf> = match std::fs::read_dir(&dir) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("openclaw-") && n.ends_with(".log"))
                    .unwrap_or(false)
            })
            .collect(),
        Err(e) => {
            log::warn!("Failed to read JSONL log directory {:?}: {}", dir, e);
            return vec![];
        }
    };

    if log_files.is_empty() {
        return vec![];
    }

    // Sort by filename descending (newest date first) so we can stop early
    log_files.sort_by(|a, b| b.cmp(a));

    let mut all_entries: Vec<LogEntry> = Vec::new();

    for path in &log_files {
        let content = match tokio::fs::read_to_string(path).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read log file {:?}: {}", path, e);
                continue;
            }
        };

        let mut file_entries: Vec<LogEntry> = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some(entry) = parse_jsonl_log_entry(line) {
                file_entries.push(entry);
            }
        }

        // Prepend this file's entries (older file goes first)
        file_entries.append(&mut all_entries);
        all_entries = file_entries;

        // If we already have enough, stop reading older files
        if all_entries.len() >= limit * 2 {
            break;
        }
    }

    // Return only the last `limit` entries
    let start = if all_entries.len() > limit {
        all_entries.len() - limit
    } else {
        0
    };
    all_entries.split_off(start)
}

/// Parse a single JSONL log entry.
///
/// Format: `{"0": source_or_msg, "1": data_or_msg, "2": msg, "_meta": {"logLevelName": "WARN", "date": "..."}, "time": "..."}`
fn parse_jsonl_log_entry(line: &str) -> Option<LogEntry> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;

    let meta = entry.get("_meta")?;
    let level_name = meta.get("logLevelName")?.as_str()?;

    // Skip DEBUG entries — too noisy for UI
    if level_name == "DEBUG" {
        return None;
    }

    let level = match level_name {
        "ERROR" | "FATAL" => "ERROR",
        "WARN" => "WARN",
        _ => "INFO",
    }
    .to_string();

    let timestamp = entry
        .get("time")
        .or_else(|| meta.get("date"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Field "0" is either a subsystem JSON string like '{"subsystem":"gateway/ws"}'
    // or a plain message string.
    let field0 = entry.get("0").and_then(|v| v.as_str()).unwrap_or("");

    let (source, msg_from_field0) = if field0.starts_with('{') {
        let parsed: Option<String> = serde_json::from_str::<serde_json::Value>(field0)
            .ok()
            .and_then(|v| {
                v.get("subsystem")
                    .or_else(|| v.get("module"))
                    .and_then(|s| s.as_str())
                    .map(|s| {
                        // Simplify: "gateway/ws" → "ws", "gateway/canvas" → "canvas"
                        s.rsplit('/').next().unwrap_or(s).to_string()
                    })
            });
        (parsed.unwrap_or_else(|| "openclaw".to_string()), None)
    } else {
        // Field 0 is a plain message (e.g. "Config was last written by...")
        ("openclaw".to_string(), Some(field0.to_string()))
    };

    // Prefer field "2" (human-readable) > field "1" (may be string or object) > field "0"
    // IMPORTANT: fields may exist as empty strings — skip them to fall through.
    let message = entry
        .get("2")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            entry.get("1").and_then(|v| {
                if let Some(s) = v.as_str() {
                    if s.is_empty() { None } else { Some(s.to_string()) }
                } else {
                    let s = v.to_string();
                    if s.is_empty() || s == "\"\"" { None } else { Some(s) }
                }
            })
        })
        .or(msg_from_field0)
        .unwrap_or_default();

    if message.is_empty() {
        return None;
    }

    // Strip ANSI escape sequences (e.g. \x1b[38;2;...m)
    let message = strip_ansi(&message);

    Some(LogEntry {
        timestamp,
        level,
        source,
        message,
    })
}

/// Strip ANSI escape sequences from a string.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip until we hit a letter (the terminator of an ANSI sequence)
            for c2 in chars.by_ref() {
                if c2.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Parse a single log line into structured data.
///
/// Expected format: `TIMESTAMP [source] message` or `TIMESTAMP [source:level] message`
/// Falls back gracefully if format doesn't match.
fn parse_log_line(line: &str) -> LogEntry {
    // Try to extract timestamp (ISO 8601 format at start)
    let (timestamp, rest) = if line.len() >= 24 && line.as_bytes()[4] == b'-' {
        // Looks like ISO timestamp
        if let Some(space_idx) = line[..30.min(line.len())].find(' ') {
            (line[..space_idx].to_string(), line[space_idx + 1..].trim())
        } else {
            (String::new(), line)
        }
    } else {
        (String::new(), line)
    };

    // Try to extract [source] or [source:level]
    if let Some(bracket_start) = rest.find('[') {
        if let Some(bracket_end) = rest[bracket_start..].find(']') {
            let bracket_content = &rest[bracket_start + 1..bracket_start + bracket_end];
            let message = rest[bracket_start + bracket_end + 1..].trim().to_string();

            // Check for source:level pattern
            if let Some(colon_idx) = bracket_content.find(':') {
                let source = bracket_content[..colon_idx].to_string();
                let level_str = &bracket_content[colon_idx + 1..];
                let level = match level_str.to_lowercase().as_str() {
                    "error" | "err" => "ERROR",
                    "warn" | "warning" => "WARN",
                    "debug" | "dbg" => "DEBUG",
                    _ => "INFO",
                }
                .to_string();
                return LogEntry {
                    timestamp,
                    level,
                    source,
                    message,
                };
            }

            // Just [source], infer level from message content
            let source = bracket_content.to_string();
            let level = infer_level(&message);
            return LogEntry {
                timestamp,
                level,
                source,
                message,
            };
        }
    }

    // Couldn't parse bracket format, return as-is
    LogEntry {
        timestamp,
        level: infer_level(rest),
        source: "unknown".to_string(),
        message: rest.to_string(),
    }
}

/// Read the last N lines of the ClawZ app log file.
///
/// Log format: `[2026-03-04][14:09:02][module::path][LEVEL] message`
#[tauri::command]
pub async fn read_app_logs(limit: usize) -> Result<Vec<LogEntry>, String> {
    let home = std::env::var("HOME").map_err(|_| "Failed to get HOME directory")?;
    let log_path = std::path::PathBuf::from(home)
        .join("Library")
        .join("Logs")
        .join("com.clawz.app")
        .join("ClawZ.log");

    let content = tokio::fs::read_to_string(&log_path)
        .await
        .map_err(|e| format!("Failed to read app log: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > limit {
        lines.len() - limit
    } else {
        0
    };

    let mut entries = Vec::new();
    for line in &lines[start..] {
        if line.trim().is_empty() {
            continue;
        }
        if let Some(entry) = parse_app_log_line(line) {
            entries.push(entry);
        }
    }

    Ok(entries)
}

/// Parse a ClawZ app log line.
///
/// Supports two formats:
/// 1. JSON-line (current): `{"ts":"2026-03-09T12:47:38.765","level":"INFO","target":"mod::path","msg":"..."}`
/// 2. Legacy bracket: `[2026-03-04][14:09:02][INFO][module::path] message`
///
/// Returns `None` if the line should be skipped (e.g. empty message).
fn parse_app_log_line(line: &str) -> Option<LogEntry> {
    let trimmed = line.trim();

    // JSON-line format (current): always delegate to JSON parser.
    // If it returns None (e.g. empty message), skip entirely — don't fall through.
    if trimmed.starts_with('{') {
        return parse_app_json_log(trimmed);
    }

    // Legacy bracket format: [date][time][LEVEL][module::path] message
    let mut parts = trimmed;
    let mut brackets: Vec<&str> = Vec::new();

    while brackets.len() < 4 {
        if let Some(start) = parts.find('[') {
            if let Some(end) = parts[start..].find(']') {
                brackets.push(&parts[start + 1..start + end]);
                parts = &parts[start + end + 1..];
                continue;
            }
        }
        break;
    }

    if brackets.len() == 4 {
        let timestamp = format!("{}T{}", brackets[0], brackets[1]);
        let level = match brackets[2].to_uppercase().as_str() {
            "ERROR" | "ERR" => "ERROR",
            "WARN" | "WARNING" => "WARN",
            "DEBUG" | "DBG" => "DEBUG",
            _ => "INFO",
        }
        .to_string();
        let source = brackets[3]
            .rsplit("::")
            .next()
            .unwrap_or(brackets[3])
            .to_string();
        let message = parts.trim().to_string();
        return Some(LogEntry {
            timestamp,
            level,
            source,
            message,
        });
    }

    // Fallback
    Some(LogEntry {
        timestamp: String::new(),
        level: infer_level(line),
        source: "app".to_string(),
        message: line.to_string(),
    })
}

/// Parse a JSON-line app log entry.
///
/// Format: `{"ts":"2026-03-09T12:47:38.765","level":"DEBUG","target":"module::path","msg":"..."}`
fn parse_app_json_log(line: &str) -> Option<LogEntry> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;

    let level_str = entry.get("level")?.as_str()?;

    let level = match level_str {
        "ERROR" | "FATAL" => "ERROR",
        "WARN" => "WARN",
        "DEBUG" => "DEBUG",
        _ => "INFO",
    }
    .to_string();

    let timestamp = entry.get("ts").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let target = entry.get("target").and_then(|v| v.as_str()).unwrap_or("app");
    let source = target.rsplit("::").next().unwrap_or(target).to_string();

    let message = entry.get("msg").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if message.is_empty() {
        return None;
    }

    Some(LogEntry {
        timestamp,
        level,
        source,
        message,
    })
}

/// Infer log level from message content keywords.
fn infer_level(msg: &str) -> String {
    let lower = msg.to_lowercase();
    if lower.contains("error") || lower.contains("fail") || lower.contains("panic") {
        "ERROR".to_string()
    } else if lower.contains("warn") || lower.contains("timeout") || lower.contains("retry") {
        "WARN".to_string()
    } else {
        "INFO".to_string()
    }
}
