use serde_json::{Map, Value};
use super::model::oc_config_set;

/// Resolve the openclaw config file path (~/.openclaw/openclaw.json).
pub(crate) fn resolve_config_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| {
        log::error!("[config] failed to get HOME: {}", e);
        "Failed to get HOME directory".to_string()
    })?;
    Ok(std::path::PathBuf::from(home)
        .join(".openclaw")
        .join("openclaw.json"))
}

fn parse_config_value(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}

fn parse_path_index(segment: &str) -> Option<usize> {
    segment.parse::<usize>().ok()
}

fn expected_container(next_segment: Option<&str>) -> Value {
    if next_segment.and_then(parse_path_index).is_some() {
        Value::Array(Vec::new())
    } else {
        Value::Object(Map::new())
    }
}

fn matches_expected_container(value: &Value, next_segment: Option<&str>) -> bool {
    if next_segment.and_then(parse_path_index).is_some() {
        value.is_array()
    } else {
        value.is_object()
    }
}

fn set_json_path(target: &mut Value, segments: &[&str], value: Value) -> Result<(), String> {
    if segments.is_empty() {
        *target = value;
        return Ok(());
    }

    let current = segments[0];
    let next = segments.get(1).copied();

    if let Some(index) = parse_path_index(current) {
        if !target.is_array() {
            *target = Value::Array(Vec::new());
        }
        let arr = target
            .as_array_mut()
            .ok_or_else(|| format!("Path segment {} is not an array index target", current))?;
        while arr.len() <= index {
            arr.push(Value::Null);
        }
        if segments.len() == 1 {
            arr[index] = value;
            return Ok(());
        }
        if arr[index].is_null() || !matches_expected_container(&arr[index], next) {
            arr[index] = expected_container(next);
        }
        return set_json_path(&mut arr[index], &segments[1..], value);
    }

    if !target.is_object() {
        *target = Value::Object(Map::new());
    }
    let obj = target
        .as_object_mut()
        .ok_or_else(|| format!("Path segment {} is not an object field target", current))?;
    if segments.len() == 1 {
        obj.insert(current.to_string(), value);
        return Ok(());
    }
    let child = obj
        .entry(current.to_string())
        .or_insert_with(|| expected_container(next));
    if child.is_null() || !matches_expected_container(child, next) {
        *child = expected_container(next);
    }
    set_json_path(child, &segments[1..], value)
}

pub(crate) async fn write_config_value_direct(path: &str, raw_value: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Config path must not be empty".to_string());
    }

    let config_path = resolve_config_path()?;
    let mut root = match tokio::fs::read_to_string(&config_path).await {
        Ok(content) => serde_json::from_str::<Value>(&content).map_err(|e| {
            log::error!(
                "[write_config_value_direct] failed to parse config file {}: {}",
                config_path.display(),
                e
            );
            format!("Failed to parse config file: {}", e)
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Value::Object(Map::new()),
        Err(e) => {
            log::error!(
                "[write_config_value_direct] failed to read config file {}: {}",
                config_path.display(),
                e
            );
            return Err(format!("Failed to read config file: {}", e));
        }
    };

    let parsed = parse_config_value(raw_value);
    let segments = path.split('.').collect::<Vec<_>>();
    set_json_path(&mut root, &segments, parsed)?;

    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize config file: {}", e))?;
    tokio::fs::write(&config_path, content)
        .await
        .map_err(|e| {
            log::error!(
                "[write_config_value_direct] failed to write config file {}: {}",
                config_path.display(),
                e
            );
            format!("Failed to write config file: {}", e)
        })?;

    Ok(())
}

/// Read the full openclaw.json config and return it as JSON.
#[tauri::command]
pub async fn read_openclaw_config() -> Result<Value, String> {
    let config_path = resolve_config_path()?;
    let content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| {
            log::error!(
                "[read_openclaw_config] failed to read config file {}: {}",
                config_path.display(),
                e
            );
            format!("Failed to read config file: {}", e)
        })?;
    let root: Value = super::cli::parse_json(&content, "read_openclaw_config")?;
    Ok(root)
}

/// Set a config value via `openclaw config set`.
#[tauri::command]
pub async fn set_config_value(path: String, value: String) -> Result<String, String> {
    log::info!("[set_config_value] path={}, value={}", path, value);
    oc_config_set(&path, &value).await?;
    log::info!("[set_config_value] config {} updated", path);
    Ok(format!("Config {} updated", path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_config_value_preserves_json_types() {
        assert_eq!(parse_config_value("true"), json!(true));
        assert_eq!(parse_config_value("42"), json!(42));
        assert_eq!(parse_config_value("\"full\""), json!("full"));
        assert_eq!(parse_config_value("merge"), json!("merge"));
    }

    #[test]
    fn set_json_path_builds_nested_arrays_and_objects() {
        let mut root = json!({});
        set_json_path(
            &mut root,
            &["agents", "list", "1", "model"],
            json!({ "primary": "openai/gpt-5" }),
        )
        .unwrap();

        assert_eq!(root["agents"]["list"][1]["model"]["primary"], "openai/gpt-5");
    }
}
