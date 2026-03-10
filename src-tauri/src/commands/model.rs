use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

/// Global flag to signal OAuth cancellation.
static OAUTH_CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
pub struct ValidateKeyResult {
    pub success: bool,
    pub error: Option<String>,
    pub models: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
pub struct OAuthProgress {
    pub status: String, // "device_code" | "waiting" | "success" | "error"
    pub verification_url: Option<String>,
    pub user_code: Option<String>,
    pub error: Option<String>,
}

/// Run `openclaw config set <path> <value>` via the bundled Node.js + openclaw.mjs.
/// Uses the same bundled path resolution as `oc_run()` to avoid relying on system PATH.
pub(crate) async fn oc_config_set(path: &str, value: &str) -> Result<(), String> {
    log::debug!("[oc_config_set] {} {}", path, value);
    let node = super::cli::bundled_node();
    let openclaw = super::cli::bundled_openclaw()?;

    let output = super::cli::bg_command(&node)
        .arg(&openclaw)
        .args(["config", "set", path, value])
        .output()
        .await
        .map_err(|e| format!("Failed to execute openclaw config set: {}", e))?;

    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let msg = if !stderr.trim().is_empty() {
        stderr.trim().to_string()
    } else if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        format!("exit code: {}", output.status)
    };
    log::error!("openclaw config set failed: {}", msg);
    Err(format!("Failed to write config: {}", msg))
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Mask a secret for safe logging: show first 4 chars + "***" + last 2 chars.
/// Secrets shorter than 8 chars are fully masked as "***".
pub(crate) fn mask_secret(s: &str) -> String {
    if s.len() < 8 {
        "***".to_string()
    } else {
        format!("{}***{}", &s[..4], &s[s.len() - 2..])
    }
}

/// Mask a URL that may contain secrets in the path (e.g. Telegram bot token in URL).
pub(crate) fn mask_url_secret(url: &str) -> String {
    // Mask tokens in Telegram-style URLs: /bot<token>/method
    if let Some(idx) = url.find("/bot") {
        let after = &url[idx + 4..];
        if let Some(slash) = after.find('/') {
            let token = &after[..slash];
            return url.replace(token, &mask_secret(token));
        }
    }
    url.to_string()
}

/// Validate an API key by hitting the provider's /models endpoint.
#[tauri::command]
pub async fn validate_api_key(
    provider_id: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<ValidateKeyResult, String> {
    log::info!("[validate_api_key] provider={}, key={}, base_url={:?}",
        provider_id, mask_secret(&api_key), base_url.as_deref().unwrap_or("(default)"));
    let (default_url, auth_header, auth_value) = match provider_id.as_str() {
        "deepseek" => (
            "https://api.deepseek.com/models?limit=1",
            "Authorization",
            format!("Bearer {}", api_key),
        ),
        "openai" => (
            "https://api.openai.com/v1/models?limit=1",
            "Authorization",
            format!("Bearer {}", api_key),
        ),
        "claude" => (
            "https://api.anthropic.com/v1/models?limit=1",
            "x-api-key",
            api_key.clone(),
        ),
        "zhipu" => (
            "https://open.bigmodel.cn/api/paas/v4/models?limit=1",
            "Authorization",
            format!("Bearer {}", api_key),
        ),
        "moonshot" => (
            "https://api.moonshot.cn/v1/models?limit=1",
            "Authorization",
            format!("Bearer {}", api_key),
        ),
        "minimax" => (
            "https://api.minimaxi.com/v1/chat/completions",
            "Authorization",
            format!("Bearer {}", api_key),
        ),
        "volcengine" => (
            "https://ark.cn-beijing.volces.com/api/v3/models?limit=1",
            "Authorization",
            format!("Bearer {}", api_key),
        ),
        "qwen" => (
            "https://dashscope.aliyuncs.com/compatible-mode/v1/models?limit=1",
            "Authorization",
            format!("Bearer {}", api_key),
        ),
        _ => {
            return Ok(ValidateKeyResult {
                success: false,
                error: Some(format!("Unsupported provider: {}", provider_id)),
                models: None,
            })
        }
    };

    // Providers without /models endpoint or custom base URLs:
    // validate by POSTing a minimal request, only 401/403 = auth failure.
    let post_validate_url = if let Some(ref custom) = base_url {
        let base = custom.trim_end_matches('/');
        Some(format!("{}/chat/completions", base))
    } else if provider_id == "minimax" {
        // MiniMax: validate via OpenAI-compatible chat completions (CN domain)
        Some("https://api.minimaxi.com/v1/chat/completions".to_string())
    } else {
        None
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    if let Some(ref post_url) = post_validate_url {
        log::info!("[validate_api_key] POST validation url={}", post_url);
        let model_name = if provider_id == "minimax" {
            "MiniMax-M2"
        } else {
            "gpt-4o-mini"
        };
        let body = serde_json::json!({
            "model": model_name,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1
        });
        let req = client
            .post(post_url.as_str())
            .header("Content-Type", "application/json")
            .header(auth_header, &auth_value);

        let resp = req.json(&body).send().await;

        return match resp {
            Ok(resp) => {
                let status_code = resp.status().as_u16();
                log::info!("[validate_api_key] POST response: status={}", status_code);
                // 401/403 = auth failed; anything else (200, 429, 400, 404) = key is valid
                if status_code == 401 || status_code == 403 {
                    let body = resp.text().await.unwrap_or_else(|e| {
                        log::warn!("Failed to read HTTP response body: {}", e);
                        String::new()
                    });
                    log::warn!("[validate_api_key] auth failed: status={}, body={}", status_code, body);
                    let msg = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| {
                            v.get("error")
                                .and_then(|e| e.get("message").or(Some(e)))
                                .and_then(|m| m.as_str().map(String::from))
                        })
                        .unwrap_or_else(|| format!("HTTP {}: Authentication failed", status_code));
                    Ok(ValidateKeyResult {
                        success: false,
                        error: Some(msg),
                        models: None,
                    })
                } else {
                    log::info!("[validate_api_key] key valid (status={})", status_code);
                    Ok(ValidateKeyResult {
                        success: true,
                        error: None,
                        models: None,
                    })
                }
            }
            Err(e) => {
                log::error!("[validate_api_key] POST request failed: {}", e);
                Ok(ValidateKeyResult {
                    success: false,
                    error: Some(format!("Network request failed: {}", e)),
                    models: None,
                })
            }
        };
    }

    let url = default_url.to_string();
    log::info!("[validate_api_key] GET validation url={}", url);
    let mut req = client.get(&url).header(auth_header, &auth_value);

    if provider_id == "claude" {
        req = req.header("anthropic-version", "2023-06-01");
    }

    match req.send().await {
        Ok(resp) => {
            let status_code = resp.status().as_u16();
            log::info!("[validate_api_key] GET response: status={}", status_code);
            // 429 = rate limited but key is valid (authenticated successfully)
            if resp.status().is_success() || status_code == 429 {
                log::info!("[validate_api_key] key valid (status={})", status_code);
                // /models?limit=1 is only used for key validation.
                // Model list comes from the frontend's curated defaultModels.
                Ok(ValidateKeyResult {
                    success: true,
                    error: None,
                    models: None,
                })
            } else {
                let body = resp
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unable to read response".to_string());
                log::warn!("[validate_api_key] auth failed: status={}, body={}", status_code, body);
                let msg = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|v| {
                        v.get("error")
                            .and_then(|e| e.get("message").or(Some(e)))
                            .and_then(|m| m.as_str().map(String::from))
                    })
                    .unwrap_or_else(|| format!("HTTP {}: {}", status_code, body));
                Ok(ValidateKeyResult {
                    success: false,
                    error: Some(msg),
                    models: None,
                })
            }
        }
        Err(e) => {
            log::error!("[validate_api_key] GET request failed: {}", e);
            Ok(ValidateKeyResult {
                success: false,
                error: Some(format!("Network request failed: {}", e)),
                models: None,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Provider metadata for direct config writing
// ---------------------------------------------------------------------------

struct ProviderMeta {
    oc_provider: &'static str,
    profile_id: &'static str,
    base_url: Option<&'static str>,
    api: Option<&'static str>,
}

fn provider_meta(provider_id: &str) -> Option<ProviderMeta> {
    match provider_id {
        "deepseek" => Some(ProviderMeta {
            oc_provider: "deepseek",
            profile_id: "deepseek:default",
            base_url: Some("https://api.deepseek.com/v1"),
            api: Some("openai-completions"),
        }),
        "openai" => Some(ProviderMeta {
            oc_provider: "openai",
            profile_id: "openai:default",
            base_url: None,
            api: None,
        }),
        "claude" => Some(ProviderMeta {
            oc_provider: "anthropic",
            profile_id: "anthropic:default",
            base_url: None,
            api: None,
        }),
        "zhipu" => Some(ProviderMeta {
            oc_provider: "zai",
            profile_id: "zai:default",
            base_url: Some("https://open.bigmodel.cn/api/paas/v4"),
            api: Some("openai-completions"),
        }),
        "moonshot" => Some(ProviderMeta {
            oc_provider: "moonshot",
            profile_id: "moonshot:default",
            base_url: Some("https://api.moonshot.ai/v1"),
            api: Some("openai-completions"),
        }),
        "minimax" => Some(ProviderMeta {
            oc_provider: "minimax",
            profile_id: "minimax:default",
            base_url: Some("https://api.minimaxi.com/anthropic"),
            api: Some("anthropic-messages"),
        }),
        "volcengine" => Some(ProviderMeta {
            oc_provider: "volcengine",
            profile_id: "volcengine:default",
            base_url: None,
            api: None,
        }),
        "qwen" => Some(ProviderMeta {
            oc_provider: "qwen-portal",
            profile_id: "qwen-portal:default",
            base_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1"),
            api: Some("openai-completions"),
        }),
        "github-copilot" => Some(ProviderMeta {
            oc_provider: "github-copilot",
            profile_id: "github-copilot:github",
            base_url: None,
            api: None,
        }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Model catalog — cost is per-million-tokens in USD
// ---------------------------------------------------------------------------

struct ModelCatalogEntry {
    id: &'static str,
    name: &'static str,
    context_window: u64,
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

fn model_catalog_entry(provider_id: &str, model_id: &str) -> Option<&'static ModelCatalogEntry> {
    static CATALOG: &[(&str, &[ModelCatalogEntry])] = &[
        ("openai", &[
            ModelCatalogEntry { id: "gpt-5.3-codex",       name: "GPT-5.3 Codex",       context_window: 256000, input: 2.0,  output: 8.0,  cache_read: 0.5,  cache_write: 2.0 },
            ModelCatalogEntry { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", context_window: 256000, input: 0.5,  output: 2.0,  cache_read: 0.25, cache_write: 0.5 },
            ModelCatalogEntry { id: "gpt-5.2",             name: "GPT-5.2",             context_window: 256000, input: 2.0,  output: 8.0,  cache_read: 0.5,  cache_write: 2.0 },
            ModelCatalogEntry { id: "gpt-5.2-codex",       name: "GPT-5.2 Codex",       context_window: 256000, input: 2.0,  output: 8.0,  cache_read: 0.5,  cache_write: 2.0 },
            ModelCatalogEntry { id: "gpt-5.1-codex",       name: "GPT-5.1 Codex",       context_window: 256000, input: 1.0,  output: 4.0,  cache_read: 0.25, cache_write: 1.0 },
            ModelCatalogEntry { id: "gpt-5-mini",          name: "GPT-5 Mini",          context_window: 128000, input: 0.3,  output: 1.2,  cache_read: 0.15, cache_write: 0.3 },
            ModelCatalogEntry { id: "gpt-4.1",             name: "GPT-4.1",             context_window: 128000, input: 2.0,  output: 8.0,  cache_read: 0.5,  cache_write: 2.0 },
            ModelCatalogEntry { id: "o4-mini",             name: "o4-mini",             context_window: 200000, input: 1.1,  output: 4.4,  cache_read: 0.275, cache_write: 1.1 },
            ModelCatalogEntry { id: "o3-mini",             name: "o3-mini",             context_window: 200000, input: 1.1,  output: 4.4,  cache_read: 0.275, cache_write: 1.1 },
        ]),
        ("claude", &[
            ModelCatalogEntry { id: "claude-opus-4-6",            name: "Claude Opus 4.6",   context_window: 200000, input: 15.0, output: 75.0, cache_read: 1.5,  cache_write: 18.75 },
            ModelCatalogEntry { id: "claude-sonnet-4-6",          name: "Claude Sonnet 4.6", context_window: 200000, input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75 },
            ModelCatalogEntry { id: "claude-opus-4-5",            name: "Claude Opus 4.5",   context_window: 200000, input: 15.0, output: 75.0, cache_read: 1.5,  cache_write: 18.75 },
            ModelCatalogEntry { id: "claude-sonnet-4-5",          name: "Claude Sonnet 4.5", context_window: 200000, input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75 },
            ModelCatalogEntry { id: "claude-haiku-4-5-20251001",  name: "Claude Haiku 4.5",  context_window: 200000, input: 0.8,  output: 4.0,  cache_read: 0.08, cache_write: 1.0 },
        ]),
        ("minimax", &[
            ModelCatalogEntry { id: "MiniMax-M2.5",           name: "MiniMax M2.5",           context_window: 1000000, input: 1.0,  output: 8.0,  cache_read: 0.1,  cache_write: 1.0 },
            ModelCatalogEntry { id: "MiniMax-M2.5-highspeed", name: "MiniMax M2.5 Highspeed", context_window: 1000000, input: 1.0,  output: 8.0,  cache_read: 0.1,  cache_write: 1.0 },
            ModelCatalogEntry { id: "MiniMax-M2.1",           name: "MiniMax M2.1",           context_window: 256000,  input: 0.7,  output: 2.8,  cache_read: 0.07, cache_write: 0.7 },
            ModelCatalogEntry { id: "MiniMax-M2",             name: "MiniMax M2",             context_window: 256000,  input: 0.5,  output: 2.0,  cache_read: 0.05, cache_write: 0.5 },
        ]),
        ("zhipu", &[
            ModelCatalogEntry { id: "glm-5",        name: "GLM-5",       context_window: 131072, input: 5.0,  output: 20.0, cache_read: 2.5,  cache_write: 5.0 },
            ModelCatalogEntry { id: "glm-4.7",      name: "GLM-4.7",     context_window: 131072, input: 2.0,  output: 8.0,  cache_read: 1.0,  cache_write: 2.0 },
            ModelCatalogEntry { id: "glm-4.7-flash", name: "GLM-4.7 Flash", context_window: 131072, input: 0.0, output: 0.0, cache_read: 0.0, cache_write: 0.0 },
            ModelCatalogEntry { id: "glm-4.6",      name: "GLM-4.6",     context_window: 131072, input: 1.0,  output: 4.0,  cache_read: 0.5,  cache_write: 1.0 },
            ModelCatalogEntry { id: "glm-4.6v",     name: "GLM-4.6V",    context_window: 131072, input: 1.0,  output: 4.0,  cache_read: 0.5,  cache_write: 1.0 },
            ModelCatalogEntry { id: "glm-4.5",      name: "GLM-4.5",     context_window: 131072, input: 0.5,  output: 2.0,  cache_read: 0.25, cache_write: 0.5 },
        ]),
        ("qwen", &[
            ModelCatalogEntry { id: "qwen-max",   name: "Qwen Max",   context_window: 131072, input: 2.0,  output: 8.0,  cache_read: 0.5,  cache_write: 2.0 },
            ModelCatalogEntry { id: "qwen-plus",  name: "Qwen Plus",  context_window: 131072, input: 0.5,  output: 2.0,  cache_read: 0.25, cache_write: 0.5 },
            ModelCatalogEntry { id: "qwen-turbo", name: "Qwen Turbo", context_window: 131072, input: 0.3,  output: 0.9,  cache_read: 0.15, cache_write: 0.3 },
            ModelCatalogEntry { id: "qwen-coder", name: "Qwen Coder", context_window: 131072, input: 0.5,  output: 2.0,  cache_read: 0.25, cache_write: 0.5 },
        ]),
        ("deepseek", &[
            ModelCatalogEntry { id: "deepseek-v3.2",     name: "DeepSeek V3.2",  context_window: 131072, input: 0.27, output: 1.1,  cache_read: 0.07, cache_write: 0.27 },
            ModelCatalogEntry { id: "deepseek-chat",     name: "DeepSeek Chat",  context_window: 131072, input: 0.27, output: 1.1,  cache_read: 0.07, cache_write: 0.27 },
            ModelCatalogEntry { id: "deepseek-reasoner", name: "DeepSeek R1",    context_window: 131072, input: 0.55, output: 2.19, cache_read: 0.14, cache_write: 0.55 },
        ]),
        ("moonshot", &[
            ModelCatalogEntry { id: "kimi-k2.5",         name: "Kimi K2.5",        context_window: 131072, input: 2.0,  output: 8.0,  cache_read: 0.5, cache_write: 2.0 },
            ModelCatalogEntry { id: "moonshot-v1-128k",  name: "Moonshot V1 128K", context_window: 131072, input: 0.84, output: 0.84, cache_read: 0.42, cache_write: 0.84 },
            ModelCatalogEntry { id: "moonshot-v1-32k",   name: "Moonshot V1 32K",  context_window: 32768,  input: 0.34, output: 0.34, cache_read: 0.17, cache_write: 0.34 },
        ]),
    ];

    CATALOG
        .iter()
        .find(|(pid, _)| *pid == provider_id)
        .and_then(|(_, models)| models.iter().find(|m| m.id == model_id))
}

fn resolve_openclaw_home() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| {
        log::error!("[model] Failed to get HOME: {}", e);
        "Failed to get HOME directory".to_string()
    })?;
    Ok(std::path::PathBuf::from(home).join(".openclaw"))
}

/// Configure a provider by writing directly to openclaw config files.
#[tauri::command]
pub async fn configure_provider(
    provider_id: String,
    api_key: Option<String>,
    selected_model: Option<String>,
    auth_mode: Option<String>,
    base_url: Option<String>,
    set_default: Option<bool>,
) -> Result<String, String> {
    log::info!("[configure_provider] provider={}, model={:?}, auth_mode={:?}, base_url={:?}, has_api_key={}, set_default={:?}",
        provider_id, selected_model, auth_mode, base_url, api_key.is_some(), set_default);
    let mut meta = provider_meta(&provider_id)
        .ok_or_else(|| format!("Unsupported provider: {}", provider_id))?;

    let mode = auth_mode.unwrap_or_else(|| {
        if api_key.is_some() { "api_key".to_string() } else { "oauth".to_string() }
    });

    // OpenAI OAuth uses chatgpt.com backend (openai-codex provider), not api.openai.com
    if provider_id == "openai" && mode == "oauth" {
        meta.oc_provider = "openai-codex";
        meta.profile_id = "openai-codex:default";
    }

    // Custom base URL override — user-provided relay/proxy address
    let custom_base_url = base_url.as_deref().filter(|u| !u.is_empty());

    let oc_home = resolve_openclaw_home()?;

    if let Some(ref key) = api_key {
        write_auth_profile(&oc_home, meta.profile_id, meta.oc_provider, key).await?;
    }

    let should_set_default = set_default.unwrap_or(true);
    update_openclaw_config(&oc_home, &meta, &provider_id, &selected_model, &mode, custom_base_url, should_set_default).await?;

    Ok("Model configured successfully".to_string())
}

async fn write_auth_profile(
    oc_home: &std::path::Path,
    profile_id: &str,
    provider: &str,
    api_key: &str,
) -> Result<(), String> {
    let agent_dir = oc_home.join("agents").join("main").join("agent");

    tokio::fs::create_dir_all(&agent_dir)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let auth_path = agent_dir.join("auth-profiles.json");

    let mut store: serde_json::Value = if auth_path.exists() {
        let content = tokio::fs::read_to_string(&auth_path)
            .await
            .map_err(|e| format!("Failed to read auth-profiles.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse auth-profiles.json: {}", e))?
    } else {
        serde_json::json!({ "version": 1, "profiles": {} })
    };

    if store.get("profiles").is_none() {
        store["profiles"] = serde_json::json!({});
    }

    store["profiles"][profile_id] = serde_json::json!({
        "type": "api_key",
        "provider": provider,
        "key": api_key
    });

    let json_str = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Serialization failed: {}", e))?;
    tokio::fs::write(&auth_path, json_str)
        .await
        .map_err(|e| format!("Failed to write auth-profiles.json: {}", e))?;

    Ok(())
}

async fn update_openclaw_config(
    _oc_home: &std::path::Path,
    meta: &ProviderMeta,
    provider_id: &str,
    selected_model: &Option<String>,
    auth_mode: &str,
    custom_base_url: Option<&str>,
    should_set_default: bool,
) -> Result<(), String> {
    // Normalize selected_model: strip provider prefix if present (e.g.
    // "anthropic/claude-opus-4-6" → "claude-opus-4-6") so downstream code
    // doesn't double-prefix when building "provider/model" references.
    let normalized_model: Option<String> = selected_model.as_ref().map(|m| {
        let prefix = format!("{}/", meta.oc_provider);
        if m.starts_with(&prefix) {
            m[prefix.len()..].to_string()
        } else {
            m.clone()
        }
    });
    let selected_model = &normalized_model;

    // Auth profile
    let profile_json = serde_json::json!({
        "provider": meta.oc_provider,
        "mode": auth_mode
    });
    oc_config_set(
        &format!("auth.profiles.{}", meta.profile_id),
        &profile_json.to_string(),
    )
    .await?;

    // Default model — only set when explicitly requested (e.g. onboarding)
    if should_set_default {
        if let Some(model_id) = selected_model {
            let model_ref = format!("{}/{}", meta.oc_provider, model_id);
            let model_json = serde_json::json!({ "primary": model_ref });
            oc_config_set("agents.defaults.model", &model_json.to_string()).await?;
        }
    }

    // Determine effective base URL: custom > meta default
    let effective_base_url = custom_base_url.or(meta.base_url);
    // For providers with custom base URL, default to openai-completions API if not specified
    let effective_api = meta.api.or_else(|| {
        if custom_base_url.is_some() {
            // Third-party relay: most are OpenAI-compatible
            if provider_id == "claude" {
                Some("anthropic-messages")
            } else {
                Some("openai-completions")
            }
        } else {
            None
        }
    });

    // Provider config (base URL + API type) for non-built-in providers or custom relay
    // Write the entire provider object at once to avoid intermediate validation failures
    if let (Some(base_url), Some(api)) = (effective_base_url, effective_api) {
        let pk = meta.oc_provider;
        oc_config_set("models.mode", "merge").await?;

        // Build models array with cost data from catalog
        let models_array = if let Some(model_id) = selected_model {
            if let Some(entry) = model_catalog_entry(provider_id, model_id) {
                serde_json::json!([{
                    "id": entry.id,
                    "name": entry.name,
                    "contextWindow": entry.context_window,
                    "cost": {
                        "input": entry.input,
                        "output": entry.output,
                        "cacheRead": entry.cache_read,
                        "cacheWrite": entry.cache_write
                    }
                }])
            } else {
                // Model not in catalog — write a minimal entry without cost
                serde_json::json!([{ "id": model_id }])
            }
        } else {
            serde_json::json!([])
        };

        let provider_json = serde_json::json!({
            "baseUrl": base_url,
            "api": api,
            "models": models_array
        });
        oc_config_set(
            &format!("models.providers.{}", pk),
            &provider_json.to_string(),
        )
        .await?;
    }

    Ok(())
}

// --- GitHub Copilot Device Code Flow ---

const GITHUB_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

async fn save_github_token(oc_home: &std::path::Path, access_token: &str) -> Result<(), String> {
    log::info!("Saving GitHub Copilot token: {}***", &access_token[..access_token.len().min(8)]);
    // Write token credential to auth-profiles.json
    let agent_dir = oc_home.join("agents").join("main").join("agent");
    tokio::fs::create_dir_all(&agent_dir)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let auth_path = agent_dir.join("auth-profiles.json");
    let mut store: serde_json::Value = if auth_path.exists() {
        let content = tokio::fs::read_to_string(&auth_path)
            .await
            .map_err(|e| format!("Failed to read auth-profiles.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse auth-profiles.json: {}", e))?
    } else {
        serde_json::json!({ "version": 1, "profiles": {} })
    };

    if store.get("profiles").is_none() {
        store["profiles"] = serde_json::json!({});
    }
    store["profiles"]["github-copilot:github"] = serde_json::json!({
        "type": "token",
        "provider": "github-copilot",
        "token": access_token
    });
    let json_str = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Serialization failed: {}", e))?;
    tokio::fs::write(&auth_path, json_str)
        .await
        .map_err(|e| format!("Failed to write auth-profiles.json: {}", e))?;

    // Update openclaw.json auth profile via CLI
    let profile_json = serde_json::json!({
        "provider": "github-copilot",
        "mode": "token"
    });
    oc_config_set(
        "auth.profiles.github-copilot:github",
        &profile_json.to_string(),
    )
    .await?;

    Ok(())
}

async fn github_copilot_device_flow(app: &AppHandle) -> Result<String, String> {
    log::info!("[github_oauth] device code flow started, url={}", GITHUB_DEVICE_CODE_URL);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .post(GITHUB_DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "read:user")])
        .send()
        .await
        .map_err(|e| {
            log::error!("[github_oauth] device code request failed: {}", e);
            format!("Failed to request device code: {}", e)
        })?;

    let status = resp.status().as_u16();
    log::info!("[github_oauth] device code response: status={}", status);
    if !resp.status().is_success() {
        log::error!("[github_oauth] device code request failed: HTTP {}", status);
        return Err(format!(
            "GitHub device code request failed: HTTP {}",
            status
        ));
    }

    let device: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse device code response: {}", e))?;
    log::info!("[github_oauth] device code received: user_code={:?}, interval={:?}, expires_in={:?}",
        device.get("user_code"), device.get("interval"), device.get("expires_in"));

    let device_code = device["device_code"]
        .as_str()
        .ok_or("GitHub response missing device_code")?
        .to_string();
    let user_code = device["user_code"]
        .as_str()
        .ok_or("GitHub response missing user_code")?
        .to_string();
    let verification_uri = device["verification_uri"]
        .as_str()
        .ok_or("GitHub response missing verification_uri")?
        .to_string();
    let interval = device["interval"].as_u64().unwrap_or(5);
    let expires_in = device["expires_in"].as_u64().unwrap_or(900);

    let _ = app.emit(
        "oauth-progress",
        OAuthProgress {
            status: "device_code".to_string(),
            verification_url: Some(verification_uri),
            user_code: Some(user_code),
            error: None,
        },
    );

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(expires_in);
    let mut poll_interval = std::time::Duration::from_secs(interval);

    loop {
        tokio::time::sleep(poll_interval).await;

        if OAUTH_CANCELLED.load(Ordering::SeqCst) {
            log::warn!("[github_oauth] User cancelled authentication");
            return Err("User cancelled authentication".to_string());
        }
        if std::time::Instant::now() > deadline {
            log::warn!("[github_oauth] Authorization timed out");
            return Err("GitHub authorization timed out, please try again".to_string());
        }

        let resp = client
            .post(GITHUB_ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", device_code.as_str()),
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:device_code",
                ),
            ])
            .send()
            .await
            .map_err(|e| format!("Failed to poll token: {}", e))?;

        let token_resp: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        if let Some(access_token) = token_resp["access_token"].as_str() {
            log::info!("[github_oauth] token received, token={}", mask_secret(access_token));
            let oc_home = resolve_openclaw_home()?;
            save_github_token(&oc_home, access_token).await?;
            log::info!("[github_oauth] credentials saved");

            let _ = app.emit(
                "oauth-progress",
                OAuthProgress {
                    status: "success".to_string(),
                    verification_url: None,
                    user_code: None,
                    error: None,
                },
            );

            log::info!("[github_oauth] flow completed successfully");
            return Ok("GitHub Copilot authentication successful".to_string());
        }

        if let Some(error) = token_resp["error"].as_str() {
            match error {
                "authorization_pending" => {
                    log::debug!("[github_oauth] poll: authorization_pending");
                    continue;
                }
                "slow_down" => {
                    log::info!("[github_oauth] poll: slow_down, increasing interval");
                    poll_interval += std::time::Duration::from_secs(2);
                    continue;
                }
                "expired_token" => {
                    log::error!("[github_oauth] token expired");
                    return Err("GitHub authorization code expired, please try again".to_string());
                }
                "access_denied" => {
                    log::error!("[github_oauth] access denied");
                    return Err("GitHub authorization denied".to_string());
                }
                _ => {
                    log::error!("[github_oauth] unknown error: {}", error);
                    return Err(format!("GitHub authorization error: {}", error));
                }
            }
        }
    }
}

// --- Shared PKCE helpers ---

fn generate_pkce() -> (String, String) {
    let mut verifier_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

    let challenge_hash = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(challenge_hash);

    (verifier, challenge)
}

fn generate_state() -> String {
    let mut state_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut state_bytes);
    hex::encode(state_bytes)
}

/// PKCE OAuth provider constants.
struct PkceProvider {
    client_id: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    redirect_uri: &'static str,
    scope: &'static str,
    extra_auth_params: &'static [(&'static str, &'static str)],
    oc_provider: &'static str,
    profile_id: &'static str,
    display_name: &'static str,
    /// If true, token exchange sends JSON body; otherwise form-urlencoded.
    token_json: bool,
}

const OPENAI_PKCE: PkceProvider = PkceProvider {
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorize_url: "https://auth.openai.com/oauth/authorize",
    token_url: "https://auth.openai.com/oauth/token",
    redirect_uri: "http://localhost:1455/auth/callback",
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    extra_auth_params: &[
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("originator", "pi"),
        ("prompt", "login"),
    ],
    oc_provider: "openai-codex",
    profile_id: "openai-codex:default",
    display_name: "OpenAI",
    token_json: false,
};

const CLAUDE_PKCE: PkceProvider = PkceProvider {
    client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    authorize_url: "https://claude.ai/oauth/authorize",
    token_url: "https://console.anthropic.com/v1/oauth/token",
    redirect_uri: "http://localhost:1455/callback",
    scope: "org:create_api_key user:profile user:inference",
    extra_auth_params: &[],
    oc_provider: "anthropic",
    profile_id: "anthropic:default",
    display_name: "Claude",
    token_json: true,
};

fn build_pkce_auth_url(p: &PkceProvider, challenge: &str, state: &str) -> String {
    let mut params: Vec<(&str, &str)> = vec![
        ("response_type", "code"),
        ("client_id", p.client_id),
        ("redirect_uri", p.redirect_uri),
        ("scope", p.scope),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
    ];
    for (k, v) in p.extra_auth_params {
        params.push((k, v));
    }
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{}?{}", p.authorize_url, query)
}

async fn exchange_pkce_code(
    p: &PkceProvider,
    code: &str,
    verifier: &str,
    state: &str,
) -> Result<serde_json::Value, String> {
    log::info!("[pkce_oauth] {} token exchange: url={}, code={}, json_mode={}",
        p.display_name, p.token_url, mask_secret(code), p.token_json);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let resp = if p.token_json {
        client
            .post(p.token_url)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "grant_type": "authorization_code",
                "client_id": p.client_id,
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": p.redirect_uri,
                "state": state,
            }))
            .send()
            .await
    } else {
        client
            .post(p.token_url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(
                [
                    ("grant_type", "authorization_code"),
                    ("client_id", p.client_id),
                    ("code", code),
                    ("code_verifier", verifier),
                    ("redirect_uri", p.redirect_uri),
                ]
                .iter()
                .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
                .collect::<Vec<_>>()
                .join("&"),
            )
            .send()
            .await
    }
    .map_err(|e| {
        log::error!("[pkce_oauth] {} token exchange request failed: {}", p.display_name, e);
        format!("Token exchange request failed: {}", e)
    })?;

    let status = resp.status().as_u16();
    log::info!("[pkce_oauth] {} token exchange response: status={}", p.display_name, status);
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_else(|e| {
                        log::warn!("Failed to read HTTP response body: {}", e);
                        String::new()
                    });
        log::error!("[pkce_oauth] {} token exchange failed: status={}, body={}", p.display_name, status, text);
        return Err(format!("Token exchange failed: {}", text));
    }

    let json = resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
    log::info!("[pkce_oauth] {} token exchange success, has_access_token={}, has_refresh_token={}, expires_in={:?}",
        p.display_name,
        json.get("access_token").is_some(),
        json.get("refresh_token").is_some(),
        json.get("expires_in"));
    Ok(json)
}

async fn save_oauth_creds(
    oc_home: &std::path::Path,
    p: &PkceProvider,
    access_token: &str,
    refresh_token: &str,
    expires_in: u64,
) -> Result<(), String> {
    log::info!("Saving {} OAuth credentials: token={}***, expires_in={}", p.display_name, &access_token[..access_token.len().min(8)], expires_in);
    let agent_dir = oc_home.join("agents").join("main").join("agent");
    tokio::fs::create_dir_all(&agent_dir)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let auth_path = agent_dir.join("auth-profiles.json");
    let mut store: serde_json::Value = if auth_path.exists() {
        let content = tokio::fs::read_to_string(&auth_path)
            .await
            .map_err(|e| format!("Failed to read auth-profiles.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse auth-profiles.json: {}", e))?
    } else {
        serde_json::json!({ "version": 1, "profiles": {} })
    };

    if store.get("profiles").is_none() {
        store["profiles"] = serde_json::json!({});
    }

    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
        + expires_in * 1000;

    store["profiles"][p.profile_id] = serde_json::json!({
        "type": "oauth",
        "provider": p.oc_provider,
        "access": access_token,
        "refresh": refresh_token,
        "expires": expires_at
    });

    let json_str = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Serialization failed: {}", e))?;
    tokio::fs::write(&auth_path, json_str)
        .await
        .map_err(|e| format!("Failed to write auth-profiles.json: {}", e))?;

    // Update openclaw.json auth profile via CLI
    let profile_json = serde_json::json!({
        "provider": p.oc_provider,
        "mode": "oauth"
    });
    oc_config_set(
        &format!("auth.profiles.{}", p.profile_id),
        &profile_json.to_string(),
    )
    .await?;

    Ok(())
}

/// Generic PKCE OAuth flow: PKCE gen → emit waiting → local server on 1455
/// → open browser → wait callback → exchange code → save creds → emit success.
async fn pkce_oauth_flow(app: &AppHandle, p: &PkceProvider) -> Result<String, String> {
    log::info!("[pkce_oauth] {} flow started, authorize_url={}, token_url={}, redirect_uri={}",
        p.display_name, p.authorize_url, p.token_url, p.redirect_uri);
    let (verifier, challenge) = generate_pkce();
    let state = generate_state();
    let auth_url = build_pkce_auth_url(p, &challenge, &state);
    log::info!("[pkce_oauth] {} auth url built, state={}", p.display_name, &state[..8]);

    // Emit progress: browser opening
    let _ = app.emit(
        "oauth-progress",
        OAuthProgress {
            status: "waiting".to_string(),
            verification_url: Some(auth_url.clone()),
            user_code: None,
            error: None,
        },
    );

    // Start local callback server
    let state_clone = state.clone();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(1);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:1455")
        .await
        .map_err(|e| {
            log::error!("[pkce_oauth] {} failed to bind port 1455: {}", p.display_name, e);
            format!("Failed to bind port 1455: {}", e)
        })?;
    log::info!("[pkce_oauth] {} local callback server listening on 127.0.0.1:1455", p.display_name);

    let server_handle = tokio::spawn(async move {
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(120);
        loop {
            let accept = tokio::time::timeout_at(deadline, listener.accept()).await;
            match accept {
                Ok(Ok((mut stream, _))) => {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = vec![0u8; 4096];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]).to_string();

                    if let Some(path_line) = request.lines().next() {
                        if let Some(path) = path_line.split_whitespace().nth(1) {
                            if path.starts_with("/auth/callback") || path.starts_with("/callback") {
                                if let Some(query) = path.split('?').nth(1) {
                                    let params: std::collections::HashMap<&str, &str> = query
                                        .split('&')
                                        .filter_map(|p| {
                                            let mut it = p.splitn(2, '=');
                                            Some((it.next()?, it.next()?))
                                        })
                                        .collect();

                                    // Check for OAuth error response first
                                    if let Some(err) = params.get("error").copied() {
                                        let desc = params.get("error_description").copied().unwrap_or(err);
                                        let desc_decoded = urlencoding::decode(desc).unwrap_or_else(|_| desc.into());
                                        let html = format!("HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!doctype html><html><body><p>Authentication failed: {}</p></body></html>", desc_decoded);
                                        let _ = stream.write_all(html.as_bytes()).await;
                                        let _ = tx.send(format!("OAUTH_ERROR:{}", desc_decoded)).await;
                                        return;
                                    }

                                    let resp_state = params.get("state").copied().unwrap_or("");
                                    let code = params.get("code").copied().unwrap_or("");

                                    if resp_state == state_clone && !code.is_empty() {
                                        let html = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!doctype html><html><body><p>Authentication successful. You can close this tab.</p></body></html>";
                                        let _ = stream.write_all(html.as_bytes()).await;
                                        let _ = tx.send(code.to_string()).await;
                                        return;
                                    } else {
                                        let html = "HTTP/1.1 400 Bad Request\r\n\r\nState mismatch or missing code";
                                        let _ = stream.write_all(html.as_bytes()).await;
                                    }
                                }
                            } else {
                                let html = "HTTP/1.1 404 Not Found\r\n\r\nNot found";
                                let _ = stream.write_all(html.as_bytes()).await;
                            }
                        }
                    }
                }
                Ok(Err(_)) => continue,
                Err(_) => return,
            }
        }
    });

    // Browser is opened by the frontend via the "waiting" event's verification_url

    // Wait for auth code (max 120s), checking cancellation every second
    let code = {
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(120);
        loop {
            tokio::select! {
                result = rx.recv() => {
                    break result.ok_or("No authorization code received".to_string())?;
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {
                    if OAUTH_CANCELLED.load(Ordering::SeqCst) {
                        server_handle.abort();
                        log::warn!("[pkce_oauth] User cancelled authentication");
                        return Err("User cancelled authentication".to_string());
                    }
                    if tokio::time::Instant::now() > deadline {
                        server_handle.abort();
                        log::warn!("[pkce_oauth] Authorization timed out (120s)");
                        return Err("OAuth authorization timed out (120s), please try again".to_string());
                    }
                }
            }
        }
    };

    server_handle.abort();

    // Check if callback returned an OAuth error
    if let Some(err_msg) = code.strip_prefix("OAUTH_ERROR:") {
        log::error!("[pkce_oauth] {} callback returned error: {}", p.display_name, err_msg);
        return Err(format!("OAuth authentication failed: {}", err_msg));
    }

    log::info!("[pkce_oauth] {} received auth code={}", p.display_name, mask_secret(&code));

    // Exchange code for tokens
    let token_resp = exchange_pkce_code(p, &code, &verifier, &state).await?;

    let access_token = token_resp["access_token"]
        .as_str()
        .ok_or("Token response missing access_token")?;
    let refresh_token = token_resp["refresh_token"]
        .as_str()
        .unwrap_or("");
    let expires_in = token_resp["expires_in"].as_u64().unwrap_or(3600);

    let oc_home = resolve_openclaw_home()?;
    save_oauth_creds(&oc_home, p, access_token, refresh_token, expires_in).await?;
    log::info!("[pkce_oauth] {} credentials saved, profile_id={}", p.display_name, p.profile_id);

    let _ = app.emit(
        "oauth-progress",
        OAuthProgress {
            status: "success".to_string(),
            verification_url: None,
            user_code: None,
            error: None,
        },
    );

    log::info!("[pkce_oauth] {} flow completed successfully", p.display_name);
    Ok(format!("{} OAuth authentication successful", p.display_name))
}

// --- Device Code + PKCE hybrid flow (Qwen, MiniMax) ---

struct DeviceCodePkceProvider {
    client_id: &'static str,
    code_url: &'static str,
    token_url: &'static str,
    scope: &'static str,
    grant_type: &'static str,
    /// Field name for the device/user code in the poll request body
    code_field: &'static str,
    oc_provider: &'static str,
    profile_id: &'static str,
    display_name: &'static str,
    base_url: Option<&'static str>,
    api: Option<&'static str>,
    /// If true, include response_type and state in the device code request (MiniMax).
    send_response_type_and_state: bool,
}

const QWEN_DC_PKCE: DeviceCodePkceProvider = DeviceCodePkceProvider {
    client_id: "f0304373b74a44d2b584a3fb70ca9e56",
    code_url: "https://chat.qwen.ai/api/v1/oauth2/device/code",
    token_url: "https://chat.qwen.ai/api/v1/oauth2/token",
    scope: "openid profile email model.completion",
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    code_field: "device_code",
    oc_provider: "qwen-portal",
    profile_id: "qwen-portal:default",
    display_name: "Qwen",
    base_url: Some("https://portal.qwen.ai/v1"),
    api: Some("openai-completions"),
    send_response_type_and_state: false,
};

const MINIMAX_DC_PKCE: DeviceCodePkceProvider = DeviceCodePkceProvider {
    client_id: "78257093-7e40-4613-99e0-527b14b39113",
    code_url: "https://api.minimaxi.com/oauth/code",
    token_url: "https://api.minimaxi.com/oauth/token",
    scope: "group_id profile model.completion",
    grant_type: "urn:ietf:params:oauth:grant-type:user_code",
    code_field: "user_code",
    oc_provider: "minimax",
    profile_id: "minimax:default",
    display_name: "MiniMax",
    base_url: Some("https://api.minimaxi.com/anthropic"),
    api: Some("anthropic-messages"),
    send_response_type_and_state: true,
};

/// Device Code + PKCE hybrid flow: request device/user code with PKCE challenge,
/// show code to user, poll token endpoint with code_verifier.
async fn device_code_pkce_flow(
    app: &AppHandle,
    p: &DeviceCodePkceProvider,
) -> Result<String, String> {
    log::info!("[dc_pkce_oauth] {} flow started, code_url={}, token_url={}, client_id={}",
        p.display_name, p.code_url, p.token_url, mask_secret(p.client_id));
    let (verifier, challenge) = generate_pkce();
    let state = generate_state();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Step 1: Request device/user code
    let mut code_params: Vec<(&str, &str)> = Vec::new();
    if p.send_response_type_and_state {
        code_params.push(("response_type", "code"));
    }
    code_params.push(("client_id", p.client_id));
    code_params.push(("scope", p.scope));
    code_params.push(("code_challenge", challenge.as_str()));
    code_params.push(("code_challenge_method", "S256"));
    if p.send_response_type_and_state {
        code_params.push(("state", state.as_str()));
    }
    let code_body = code_params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let request_id = generate_state(); // random hex as request ID
    log::info!("[dc_pkce_oauth] {} requesting device code from {}", p.display_name, p.code_url);
    let resp = client
        .post(p.code_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("x-request-id", &request_id)
        .body(code_body)
        .send()
        .await
        .map_err(|e| {
            log::error!("[dc_pkce_oauth] {} device code request failed: {}", p.display_name, e);
            format!("Failed to request device code: {}", e)
        })?;

    let status = resp.status().as_u16();
    log::info!("[dc_pkce_oauth] {} device code response: status={}", p.display_name, status);
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_else(|e| {
                        log::warn!("Failed to read HTTP response body: {}", e);
                        String::new()
                    });
        log::error!("[dc_pkce_oauth] {} device code failed: status={}, body={}", p.display_name, status, text);
        return Err(format!("{} device code request failed: {}", p.display_name, text));
    }

    let device: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse device code response: {}", e))?;
    log::info!("[dc_pkce_oauth] {} device code response: user_code={:?}, interval={:?}, expires_in={:?}",
        p.display_name, device.get("user_code"), device.get("interval"), device.get("expires_in"));

    let device_code = device[p.code_field]
        .as_str()
        .or_else(|| device["device_code"].as_str())
        .ok_or(format!("{} response missing {}", p.display_name, p.code_field))?
        .to_string();
    let user_code = device["user_code"]
        .as_str()
        .ok_or(format!("{} response missing user_code", p.display_name))?
        .to_string();
    // MiniMax returns `interval` in milliseconds (e.g. 2000) and `expired_in` (Unix timestamp ms);
    // standard OAuth returns `interval` in seconds and `expires_in` (duration in seconds).
    let raw_interval = device["interval"].as_u64().unwrap_or(2);
    let interval = if raw_interval > 100 { raw_interval / 1000 } else { raw_interval }.max(2);
    let expires_in = device["expires_in"]
        .as_u64()
        .or_else(|| {
            // MiniMax: `expired_in` is a Unix timestamp in ms — convert to remaining seconds
            device["expired_in"].as_u64().map(|ts| {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                ts.saturating_sub(now_ms) / 1000
            })
        })
        .unwrap_or(900);
    log::info!("[dc_pkce_oauth] {} parsed interval={}s, expires_in={}s", p.display_name, interval, expires_in);

    // Prefer verification_uri_complete (includes user_code in URL).
    // If not available, construct URL with user_code + client_id query params.
    let verification_url = device["verification_uri_complete"]
        .as_str()
        .map(String::from)
        .or_else(|| {
            device["verification_uri"]
                .as_str()
                .or_else(|| device["verification_url"].as_str())
                .map(|base| {
                    let sep = if base.contains('?') { "&" } else { "?" };
                    format!(
                        "{}{}user_code={}&client_id={}",
                        base,
                        sep,
                        urlencoding::encode(&user_code),
                        urlencoding::encode(p.client_id)
                    )
                })
        })
        .ok_or(format!("{} response missing verification_uri", p.display_name))?;

    // Emit device_code progress (shows code to user)
    let _ = app.emit(
        "oauth-progress",
        OAuthProgress {
            status: "device_code".to_string(),
            verification_url: Some(verification_url),
            user_code: Some(user_code),
            error: None,
        },
    );

    // Step 2: Poll token endpoint
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(expires_in);
    let mut poll_interval = std::time::Duration::from_secs(interval);

    loop {
        tokio::time::sleep(poll_interval).await;

        if OAUTH_CANCELLED.load(Ordering::SeqCst) {
            log::warn!("[dc_pkce_oauth] {} User cancelled authentication", p.display_name);
            return Err("User cancelled authentication".to_string());
        }
        if std::time::Instant::now() > deadline {
            log::warn!("[dc_pkce_oauth] {} authorization timed out", p.display_name);
            return Err(format!("{} authorization timed out, please try again", p.display_name));
        }

        let poll_body = [
            ("grant_type", p.grant_type),
            ("client_id", p.client_id),
            (p.code_field, device_code.as_str()),
            ("code_verifier", verifier.as_str()),
        ]
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

        log::debug!("[dc_pkce_oauth] {} polling token endpoint {}", p.display_name, p.token_url);
        let resp = client
            .post(p.token_url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .body(poll_body)
            .send()
            .await
            .map_err(|e| {
                log::error!("[dc_pkce_oauth] {} token poll failed: {}", p.display_name, e);
                format!("Failed to poll token: {}", e)
            })?;

        let poll_status = resp.status().as_u16();
        let token_resp: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        if let Some(access_token) = token_resp["access_token"].as_str() {
            log::info!("[dc_pkce_oauth] {} token received, access_token={}, expires_in={:?}",
                p.display_name, mask_secret(access_token), token_resp.get("expires_in"));
            let refresh_token = token_resp["refresh_token"].as_str().unwrap_or("");
            // MiniMax uses `expired_in` (Unix timestamp ms), standard uses `expires_in` (duration s)
            let token_expires = token_resp["expires_in"]
                .as_u64()
                .or_else(|| token_resp["expired_in"].as_u64().map(|ts| {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    ts.saturating_sub(now_ms) / 1000
                }))
                .unwrap_or(3600);

            // Save credentials
            let oc_home = resolve_openclaw_home()?;
            save_dc_pkce_oauth_creds(&oc_home, p, access_token, refresh_token, token_expires)
                .await?;
            log::info!("[dc_pkce_oauth] {} credentials saved, profile_id={}", p.display_name, p.profile_id);

            let _ = app.emit(
                "oauth-progress",
                OAuthProgress {
                    status: "success".to_string(),
                    verification_url: None,
                    user_code: None,
                    error: None,
                },
            );

            log::info!("[dc_pkce_oauth] {} flow completed successfully", p.display_name);
            return Ok(format!("{} OAuth authentication successful", p.display_name));
        }

        // MiniMax uses `status` field: "pending" / "success" / "error"
        if let Some(status) = token_resp["status"].as_str() {
            match status {
                "success" => {
                    // access_token should have been caught above; if not, log and continue
                    log::warn!("[dc_pkce_oauth] {} status=success but no access_token", p.display_name);
                }
                "pending" => {
                    log::debug!("[dc_pkce_oauth] {} poll status={}: pending", p.display_name, poll_status);
                    continue;
                }
                "error" => {
                    let msg = token_resp["base_resp"]["status_msg"]
                        .as_str()
                        .unwrap_or("unknown error");
                    log::error!("[dc_pkce_oauth] {} token error: {}", p.display_name, msg);
                    return Err(format!("{} authorization error: {}", p.display_name, msg));
                }
                _ => {}
            }
        }

        // Standard OAuth: `error` field
        if let Some(error) = token_resp["error"].as_str() {
            match error {
                "authorization_pending" => {
                    log::debug!("[dc_pkce_oauth] {} poll status={}: authorization_pending", p.display_name, poll_status);
                    continue;
                }
                "slow_down" => {
                    log::info!("[dc_pkce_oauth] {} poll: slow_down, increasing interval", p.display_name);
                    poll_interval += std::time::Duration::from_secs(2);
                    continue;
                }
                "expired_token" => {
                    log::error!("[dc_pkce_oauth] {} token expired", p.display_name);
                    return Err(format!("{} authorization code expired, please try again", p.display_name));
                }
                "access_denied" => {
                    log::error!("[dc_pkce_oauth] {} access denied", p.display_name);
                    return Err(format!("{} authorization denied", p.display_name));
                }
                _ => {
                    log::error!("[dc_pkce_oauth] {} unknown error: {}", p.display_name, error);
                    return Err(format!("{} authorization error: {}", p.display_name, error));
                }
            }
        }
        log::warn!("[dc_pkce_oauth] {} unexpected poll response: status={}, body={}",
            p.display_name, poll_status, token_resp);
    }
}

async fn save_dc_pkce_oauth_creds(
    oc_home: &std::path::Path,
    p: &DeviceCodePkceProvider,
    access_token: &str,
    refresh_token: &str,
    expires_in: u64,
) -> Result<(), String> {
    log::info!("Saving {} OAuth credentials: token={}***, expires_in={}", p.display_name, &access_token[..access_token.len().min(8)], expires_in);
    let agent_dir = oc_home.join("agents").join("main").join("agent");
    tokio::fs::create_dir_all(&agent_dir)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let auth_path = agent_dir.join("auth-profiles.json");
    let mut store: serde_json::Value = if auth_path.exists() {
        let content = tokio::fs::read_to_string(&auth_path)
            .await
            .map_err(|e| format!("Failed to read auth-profiles.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse auth-profiles.json: {}", e))?
    } else {
        serde_json::json!({ "version": 1, "profiles": {} })
    };

    if store.get("profiles").is_none() {
        store["profiles"] = serde_json::json!({});
    }

    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
        + expires_in * 1000;

    store["profiles"][p.profile_id] = serde_json::json!({
        "type": "oauth",
        "provider": p.oc_provider,
        "access": access_token,
        "refresh": refresh_token,
        "expires": expires_at
    });

    let json_str = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Serialization failed: {}", e))?;
    tokio::fs::write(&auth_path, json_str)
        .await
        .map_err(|e| format!("Failed to write auth-profiles.json: {}", e))?;

    // Update openclaw.json via CLI
    let profile_json = serde_json::json!({
        "provider": p.oc_provider,
        "mode": "oauth"
    });
    oc_config_set(
        &format!("auth.profiles.{}", p.profile_id),
        &profile_json.to_string(),
    )
    .await?;

    // Provider-specific base URL + api config
    // Write the entire provider object at once to avoid intermediate validation failures
    if let (Some(base_url), Some(api)) = (p.base_url, p.api) {
        let pk = p.oc_provider;
        oc_config_set("models.mode", "merge").await?;
        let provider_json = serde_json::json!({
            "baseUrl": base_url,
            "api": api,
            "models": []
        });
        oc_config_set(
            &format!("models.providers.{}", pk),
            &provider_json.to_string(),
        )
        .await?;
    }

    Ok(())
}

/// Start an OAuth flow.
#[tauri::command]
pub async fn start_oauth_flow(
    app: AppHandle,
    provider_id: String,
) -> Result<String, String> {
    // Reset cancel flag before starting
    OAUTH_CANCELLED.store(false, Ordering::SeqCst);
    log::info!("Starting OAuth authentication: provider={}", provider_id);

    match provider_id.as_str() {
        "github-copilot" => github_copilot_device_flow(&app).await,
        "openai" => pkce_oauth_flow(&app, &OPENAI_PKCE).await,
        "claude" => pkce_oauth_flow(&app, &CLAUDE_PKCE).await,
        "qwen" => device_code_pkce_flow(&app, &QWEN_DC_PKCE).await,
        "minimax" => device_code_pkce_flow(&app, &MINIMAX_DC_PKCE).await,
        _ => Err(format!(
            "TERMINAL_REQUIRED:{}",
            provider_id
        )),
    }
}

/// Cancel a running OAuth flow.
#[tauri::command]
pub async fn cancel_oauth_flow() -> Result<String, String> {
    log::info!("User cancelled OAuth authentication");
    OAUTH_CANCELLED.store(true, Ordering::SeqCst);
    Ok("Cancelled".to_string())
}

/// Fetch models using stored OAuth/API credentials for a provider.
#[tauri::command]
pub async fn fetch_provider_models(provider_id: String) -> Result<Vec<String>, String> {
    log::info!("Fetching model list: provider={}", provider_id);
    let oc_home = resolve_openclaw_home()?;
    let auth_path = oc_home
        .join("agents")
        .join("main")
        .join("agent")
        .join("auth-profiles.json");

    if !auth_path.exists() {
        log::error!("[fetch_provider_models] {} credentials not found: {:?}", provider_id, auth_path);
        return Err("Credentials not found".to_string());
    }

    let content = tokio::fs::read_to_string(&auth_path)
        .await
        .map_err(|e| {
            log::error!("[fetch_provider_models] {} failed to read credentials: {}", provider_id, e);
            format!("Failed to read credentials: {}", e)
        })?;
    let store: serde_json::Value = super::cli::parse_json(&content, "fetch_provider_models/credentials")?;

    let meta = provider_meta(&provider_id).ok_or_else(|| {
        log::error!("[fetch_provider_models] unsupported provider: {}", provider_id);
        "Unsupported provider".to_string()
    })?;

    let profile = store
        .get("profiles")
        .and_then(|p| p.get(meta.profile_id))
        .ok_or_else(|| {
            log::error!("[fetch_provider_models] {} credentials profile not found: profile={}", provider_id, meta.profile_id);
            "Credentials not found for this provider".to_string()
        })?;

    // Extract bearer token from credential
    let token = profile
        .get("key") // api_key credential
        .or_else(|| profile.get("access")) // oauth credential
        .or_else(|| profile.get("token")) // token credential
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            log::error!("[fetch_provider_models] {} no usable token found in credentials", provider_id);
            "No usable token found in credentials".to_string()
        })?;

    // Determine endpoint and auth headers
    let (url, auth_header, auth_value) = match provider_id.as_str() {
        "openai" => (
            "https://api.openai.com/v1/models",
            "Authorization",
            format!("Bearer {}", token),
        ),
        "claude" => (
            "https://api.anthropic.com/v1/models",
            "x-api-key",
            token.to_string(),
        ),
        "deepseek" => (
            "https://api.deepseek.com/models",
            "Authorization",
            format!("Bearer {}", token),
        ),
        "zhipu" => (
            "https://open.bigmodel.cn/api/paas/v4/models",
            "Authorization",
            format!("Bearer {}", token),
        ),
        "moonshot" => (
            "https://api.moonshot.cn/v1/models",
            "Authorization",
            format!("Bearer {}", token),
        ),
        "minimax" => (
            "https://api.minimaxi.com/v1/models",
            "Authorization",
            format!("Bearer {}", token),
        ),
        "volcengine" => (
            "https://ark.cn-beijing.volces.com/api/v3/models",
            "Authorization",
            format!("Bearer {}", token),
        ),
        "qwen" => (
            "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
            "Authorization",
            format!("Bearer {}", token),
        ),
        _ => return Err(format!("Fetching model list not supported: {}", provider_id)),
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let mut req = client.get(url).header(auth_header, &auth_value);
    if provider_id == "claude" {
        req = req.header("anthropic-version", "2023-06-01");
    }

    let resp = req
        .send()
        .await
        .map_err(|e| {
            log::error!("[fetch_provider_models] {} failed to fetch model list: {}", provider_id, e);
            format!("Failed to fetch model list: {}", e)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        log::error!("[fetch_provider_models] {} failed to fetch model list: HTTP {}", provider_id, status);
        return Err(format!("Failed to fetch model list: HTTP {}", status));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| {
            log::error!("[fetch_provider_models] {} failed to parse model list: {}", provider_id, e);
            format!("Failed to parse model list: {}", e)
        })?;

    let models = json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(models)
}

// ---------------------------------------------------------------------------
// Model management commands (wrapping `openclaw models …` CLI)
// ---------------------------------------------------------------------------

/// Helper: run an openclaw CLI command and return stdout as a String.
async fn oc_run(args: &str) -> Result<String, String> {
    super::cli::oc_run("model", args).await
}

/// Get model status: default model, fallbacks, auth info.
#[tauri::command]
pub async fn get_models_status() -> Result<serde_json::Value, String> {
    let raw = oc_run("models status --json").await?;
    super::cli::parse_json(&raw, "get_models_status")
}

/// List configured/available models.
#[tauri::command]
pub async fn list_configured_models() -> Result<serde_json::Value, String> {
    let raw = oc_run("models list --json").await?;
    super::cli::parse_json(&raw, "list_configured_models")
}

/// List all models from the full catalog (includes available flag per provider auth).
#[tauri::command]
pub async fn list_all_available_models() -> Result<serde_json::Value, String> {
    let raw = oc_run("models list --all --json").await?;
    super::cli::parse_json(&raw, "list_all_available_models")
}

/// Set the default primary model.
#[tauri::command]
pub async fn set_default_model(model: String) -> Result<String, String> {
    oc_run(&format!("models set {}", shell_escape(&model))).await
}

/// Add a fallback model.
#[tauri::command]
pub async fn add_model_fallback(model: String) -> Result<String, String> {
    oc_run(&format!("models fallbacks add {}", shell_escape(&model))).await
}

/// Remove a fallback model.
#[tauri::command]
pub async fn remove_model_fallback(model: String) -> Result<String, String> {
    oc_run(&format!("models fallbacks remove {}", shell_escape(&model))).await
}

/// Remove a provider: delete auth profile from global config AND agent-level auth-profiles.json.
///
/// Auth profiles use keys like "anthropic:default", stored in two places:
///   1. Global: ~/.openclaw/openclaw.json  →  auth.profiles["anthropic:default"]
///   2. Agent:  ~/.openclaw/agents/main/agent/auth-profiles.json  →  profiles["anthropic:default"]
#[tauri::command]
pub async fn remove_provider(provider: String) -> Result<String, String> {
    log::info!("[remove_provider] provider={}", provider);
    let profile_id = format!("{}:default", provider);

    // 1. Remove from global config: auth.profiles.<provider>:default
    let path = format!("auth.profiles.{}:default", provider);
    let cmd = format!("openclaw config unset {}", shell_escape(&path));
    let output = super::cli::bg_command(super::cli::user_shell())
        .args(["-l", "-c", &super::cli::with_rc(&cmd)])
        .output()
        .await
        .map_err(|e| format!("Failed to execute openclaw config unset: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("[remove_provider] Global config deletion failed (may not exist): {}", stderr.trim());
        // Non-fatal: the profile may only exist in agent-level auth-profiles.json
    }

    // 2. Remove from agent-level auth-profiles.json
    let oc_home = resolve_openclaw_home()?;
    let auth_path = oc_home
        .join("agents/main/agent")
        .join("auth-profiles.json");

    if auth_path.exists() {
        let content = tokio::fs::read_to_string(&auth_path)
            .await
            .map_err(|e| {
                log::error!("[remove_provider] Failed to read auth-profiles.json: {}", e);
                format!("Failed to read auth-profiles.json: {}", e)
            })?;
        let mut doc: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
            log::error!("[remove_provider] Failed to parse auth-profiles.json: {}", e);
            format!("Failed to parse auth-profiles.json: {}", e)
        })?;

        if let Some(profiles) = doc.get_mut("profiles").and_then(|p| p.as_object_mut()) {
            if profiles.remove(&profile_id).is_some() {
                let json_str = serde_json::to_string_pretty(&doc)
                    .map_err(|e| format!("JSON serialization failed: {}", e))?;
                tokio::fs::write(&auth_path, json_str).await.map_err(|e| {
                    log::error!("[remove_provider] Failed to write auth-profiles.json: {}", e);
                    format!("Failed to write auth-profiles.json: {}", e)
                })?;
                log::info!("[remove_provider] Removed {} from auth-profiles.json", profile_id);
            }
        }
    }

    log::info!("[remove_provider] {} removed", provider);
    Ok("ok".to_string())
}
