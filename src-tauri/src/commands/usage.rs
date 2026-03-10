use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub total_tokens: u64,
    pub estimated_cost: f64,
    pub message_count: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub provider: String,
    pub model: String,
    pub total_tokens: u64,
    pub estimated_cost: f64,
    pub message_count: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub total_input: u64,
    pub total_output: u64,
    pub total_cache_read: u64,
    pub total_cache_write: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_messages: u64,
    pub active_days: u64,
    pub daily: Vec<DailyUsage>,
    pub by_model: Vec<ModelUsage>,
}

/// Cost config per model from openclaw.json
struct CostConfig {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

fn load_cost_configs() -> HashMap<String, CostConfig> {
    let mut map = HashMap::new();
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(e) => {
            log::warn!("load_cost_configs: failed to get HOME: {}", e);
            return map;
        }
    };

    // Read main config
    let config_path = PathBuf::from(&home).join(".openclaw/openclaw.json");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("load_cost_configs: failed to read config file: {}", e);
            return map;
        }
    };
    let config: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("load_cost_configs: config file JSON parse failed: {}", e);
            return map;
        }
    };

    // Also read agent-level models.json
    let agent_models_path =
        PathBuf::from(&home).join(".openclaw/agents/main/agent/models.json");
    let agent_config: Option<serde_json::Value> = match std::fs::read_to_string(&agent_models_path)
    {
        Ok(c) => match serde_json::from_str(&c) {
            Ok(v) => Some(v),
            Err(e) => {
                log::debug!(
                    "load_cost_configs: agent models.json parse failed: {}",
                    e
                );
                None
            }
        },
        Err(_) => None, // file not existing is normal
    };

    // Merge providers from both sources
    for cfg in [Some(&config), agent_config.as_ref()] {
        let Some(cfg) = cfg else { continue };
        let providers = match cfg
            .pointer("/models/providers")
            .or_else(|| cfg.get("providers"))
        {
            Some(p) => p,
            None => continue,
        };
        if let Some(obj) = providers.as_object() {
            for (provider_id, provider_val) in obj {
                if let Some(models) = provider_val.get("models").and_then(|m| m.as_array()) {
                    for model in models {
                        let id = model.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if id.is_empty() {
                            continue;
                        }
                        if let Some(cost) = model.get("cost") {
                            let key = format!("{}/{}", provider_id, id);
                            map.insert(
                                key,
                                CostConfig {
                                    input: cost.get("input").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                    output: cost.get("output").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                    cache_read: cost
                                        .get("cacheRead")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0),
                                    cache_write: cost
                                        .get("cacheWrite")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    map
}

fn estimate_cost(cost: &CostConfig, input: u64, output: u64, cr: u64, cw: u64) -> f64 {
    (input as f64 * cost.input
        + output as f64 * cost.output
        + cr as f64 * cost.cache_read
        + cw as f64 * cost.cache_write)
        / 1_000_000.0
}

struct ParsedUsage {
    date: String,
    provider: String,
    model: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

fn parse_usage_from_line(line: &str) -> Option<ParsedUsage> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;
    let message = entry.get("message")?;

    // Only assistant messages have usage
    let role = message.get("role")?.as_str()?;
    if role != "assistant" {
        return None;
    }

    // Extract usage from message.usage or entry.usage
    let usage = message.get("usage").or_else(|| entry.get("usage"))?;

    let input = usage
        .get("input")
        .or_else(|| usage.get("inputTokens"))
        .or_else(|| usage.get("input_tokens"))
        .or_else(|| usage.get("promptTokens"))
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let output = usage
        .get("output")
        .or_else(|| usage.get("outputTokens"))
        .or_else(|| usage.get("output_tokens"))
        .or_else(|| usage.get("completionTokens"))
        .or_else(|| usage.get("completion_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let cache_read = usage
        .get("cacheRead")
        .or_else(|| usage.get("cache_read"))
        .or_else(|| usage.get("cache_read_input_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let cache_write = usage
        .get("cacheWrite")
        .or_else(|| usage.get("cache_write"))
        .or_else(|| usage.get("cache_creation_input_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if input == 0 && output == 0 && cache_read == 0 && cache_write == 0 {
        return None;
    }

    // Extract timestamp → local date
    // Timestamps are ISO 8601 UTC (e.g. "2026-03-10T02:30:00.000Z").
    // We must convert to local timezone so the date matches the frontend's
    // `new Date().getFullYear()-...` local date comparison.
    let timestamp = entry
        .get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let date = if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(timestamp) {
        dt.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string()
    } else if timestamp.len() >= 10 {
        // Fallback: already a local date or non-standard format
        timestamp[..10].to_string()
    } else {
        "unknown".to_string()
    };

    // Extract provider/model
    let provider = message
        .get("provider")
        .or_else(|| entry.get("provider"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let model = message
        .get("model")
        .or_else(|| entry.get("modelId"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    Some(ParsedUsage {
        date,
        provider,
        model,
        input,
        output,
        cache_read,
        cache_write,
    })
}

#[tauri::command]
pub async fn compute_usage_stats(agent_id: Option<String>) -> Result<UsageStats, String> {
    log::info!(
        "[compute_usage_stats] agent_id={:?}",
        agent_id
    );
    let home = std::env::var("HOME").map_err(|_| "Failed to get HOME directory")?;
    let agents_dir = PathBuf::from(&home).join(".openclaw/agents");

    let cost_configs = load_cost_configs();
    log::debug!(
        "[compute_usage_stats] loaded {} model cost configs",
        cost_configs.len()
    );

    let mut daily_map: HashMap<String, DailyUsage> = HashMap::new();
    let mut model_map: HashMap<String, ModelUsage> = HashMap::new();
    let mut totals = UsageStats {
        total_input: 0,
        total_output: 0,
        total_cache_read: 0,
        total_cache_write: 0,
        total_tokens: 0,
        total_cost: 0.0,
        total_messages: 0,
        active_days: 0,
        daily: vec![],
        by_model: vec![],
    };

    // Collect session directories to scan
    let session_dirs: Vec<PathBuf> = if let Some(ref id) = agent_id {
        // Single agent
        let dir = agents_dir.join(id).join("sessions");
        if dir.exists() { vec![dir] } else { vec![] }
    } else {
        // All agents
        match std::fs::read_dir(&agents_dir) {
            Ok(entries) => entries
                .flatten()
                .map(|e| e.path().join("sessions"))
                .filter(|p| p.exists())
                .collect(),
            Err(e) => {
                log::warn!(
                    "[compute_usage_stats] failed to read agents directory {}: {}",
                    agents_dir.display(),
                    e
                );
                return Ok(totals);
            }
        }
    };

    for sessions_dir in &session_dirs {
        let session_files = match std::fs::read_dir(sessions_dir) {
            Ok(e) => e,
            Err(e) => {
                log::warn!(
                    "[compute_usage_stats] failed to read sessions directory {}: {}",
                    sessions_dir.display(),
                    e
                );
                continue;
            }
        };

        for file_entry in session_files.flatten() {
            let path = file_entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            // Skip the sessions index file
            if path.file_name().and_then(|n| n.to_str()) == Some("sessions.json") {
                continue;
            }

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "[compute_usage_stats] failed to read session file {}: {}",
                        path.display(),
                        e
                    );
                    continue;
                }
            };

            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                let Some(usage) = parse_usage_from_line(line) else {
                    continue;
                };

                let model_key = format!("{}/{}", usage.provider, usage.model);
                let cost = cost_configs.get(&model_key);
                let msg_cost = cost
                    .map(|c| {
                        estimate_cost(c, usage.input, usage.output, usage.cache_read, usage.cache_write)
                    })
                    .unwrap_or(0.0);

                let token_sum = usage.input + usage.output + usage.cache_read + usage.cache_write;

                // Update totals
                totals.total_input += usage.input;
                totals.total_output += usage.output;
                totals.total_cache_read += usage.cache_read;
                totals.total_cache_write += usage.cache_write;
                totals.total_tokens += token_sum;
                totals.total_cost += msg_cost;
                totals.total_messages += 1;

                // Update daily
                let daily = daily_map.entry(usage.date.clone()).or_insert(DailyUsage {
                    date: usage.date,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read: 0,
                    cache_write: 0,
                    total_tokens: 0,
                    estimated_cost: 0.0,
                    message_count: 0,
                });
                daily.input_tokens += usage.input;
                daily.output_tokens += usage.output;
                daily.cache_read += usage.cache_read;
                daily.cache_write += usage.cache_write;
                daily.total_tokens += token_sum;
                daily.estimated_cost += msg_cost;
                daily.message_count += 1;

                // Update by model
                let model_entry = model_map.entry(model_key.clone()).or_insert(ModelUsage {
                    provider: usage.provider,
                    model: usage.model,
                    total_tokens: 0,
                    estimated_cost: 0.0,
                    message_count: 0,
                });
                model_entry.total_tokens += token_sum;
                model_entry.estimated_cost += msg_cost;
                model_entry.message_count += 1;
            }
        }
    }

    // Sort daily by date
    let mut daily: Vec<DailyUsage> = daily_map.into_values().collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    totals.active_days = daily.len() as u64;
    totals.daily = daily;

    // Sort by_model by cost desc
    let mut by_model: Vec<ModelUsage> = model_map.into_values().collect();
    by_model.sort_by(|a, b| b.estimated_cost.partial_cmp(&a.estimated_cost).unwrap_or(std::cmp::Ordering::Equal));
    totals.by_model = by_model;

    log::info!(
        "[compute_usage_stats] done: {} days, {} messages, {} models",
        totals.active_days,
        totals.total_messages,
        totals.by_model.len()
    );
    Ok(totals)
}
