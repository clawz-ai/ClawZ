use super::cli::{oc_run as oc_run_shared, shell_escape};

async fn oc_run(args: &str) -> Result<String, String> {
    oc_run_shared("cron", args).await
}

/// List all cron jobs — returns raw JSON string; frontend parses it.
#[tauri::command]
pub async fn list_cron_jobs() -> Result<String, String> {
    log::info!("[list_cron_jobs] fetching cron job list");
    let raw = oc_run("cron list --json").await?;
    // Validate JSON structure, but return raw string directly to avoid
    // unnecessary deserialize→serialize round-trip
    if serde_json::from_str::<serde_json::Value>(&raw).is_ok() {
        log::info!("[list_cron_jobs] success, len={}", raw.len());
        Ok(raw)
    } else {
        log::warn!("[list_cron_jobs] JSON parse failed, returning []");
        Ok("[]".to_string())
    }
}

/// Create a new cron job.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_cron_job(
    name: String,
    agent_id: String,
    message: String,
    schedule_type: String,
    schedule_value: String,
    model: Option<String>,
    thinking: Option<String>,
    channel: Option<String>,
) -> Result<String, String> {
    log::info!("[create_cron_job] name={}, agent_id={}, schedule_type={}, schedule_value={}", name, agent_id, schedule_type, schedule_value);
    let schedule_flag = match schedule_type.as_str() {
        "every" => format!("--every {}", shell_escape(&schedule_value)),
        _ => format!("--cron {}", shell_escape(&schedule_value)),
    };

    let mut args = format!(
        "cron add --name {} --agent {} --message {} {} --json",
        shell_escape(&name),
        shell_escape(&agent_id),
        shell_escape(&message),
        schedule_flag,
    );
    if let Some(ref m) = model {
        args.push_str(&format!(" --model {}", shell_escape(m)));
    }
    if let Some(ref t) = thinking {
        args.push_str(&format!(" --thinking {}", shell_escape(t)));
    }
    if let Some(ref c) = channel {
        args.push_str(&format!(" --channel {}", shell_escape(c)));
    }

    oc_run(&args).await
}

/// Edit an existing cron job.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn edit_cron_job(
    job_id: String,
    name: Option<String>,
    message: Option<String>,
    schedule_type: Option<String>,
    schedule_value: Option<String>,
    model: Option<String>,
    thinking: Option<String>,
    channel: Option<String>,
) -> Result<String, String> {
    log::info!("[edit_cron_job] job_id={}", job_id);
    let mut args = format!("cron edit {}", shell_escape(&job_id));
    if let Some(ref n) = name {
        args.push_str(&format!(" --name {}", shell_escape(n)));
    }
    if let Some(ref m) = message {
        args.push_str(&format!(" --message {}", shell_escape(m)));
    }
    if let (Some(ref st), Some(ref sv)) = (&schedule_type, &schedule_value) {
        let flag = if st == "every" { "--every" } else { "--cron" };
        args.push_str(&format!(" {} {}", flag, shell_escape(sv)));
    }
    if let Some(ref m) = model {
        args.push_str(&format!(" --model {}", shell_escape(m)));
    }
    if let Some(ref t) = thinking {
        args.push_str(&format!(" --thinking {}", shell_escape(t)));
    }
    if let Some(ref c) = channel {
        args.push_str(&format!(" --channel {}", shell_escape(c)));
    }
    oc_run(&args).await
}

/// Delete a cron job.
#[tauri::command]
pub async fn delete_cron_job(job_id: String) -> Result<String, String> {
    log::info!("[delete_cron_job] job_id={}", job_id);
    oc_run(&format!("cron rm {} --json", shell_escape(&job_id))).await
}

/// Enable a cron job.
#[tauri::command]
pub async fn enable_cron_job(job_id: String) -> Result<String, String> {
    log::info!("[enable_cron_job] job_id={}", job_id);
    oc_run(&format!("cron enable {}", shell_escape(&job_id))).await
}

/// Disable a cron job.
#[tauri::command]
pub async fn disable_cron_job(job_id: String) -> Result<String, String> {
    log::info!("[disable_cron_job] job_id={}", job_id);
    oc_run(&format!("cron disable {}", shell_escape(&job_id))).await
}

/// Get run history for a cron job.
#[tauri::command]
pub async fn get_cron_runs(job_id: String) -> Result<String, String> {
    log::info!("[get_cron_runs] job_id={}", job_id);
    let raw = oc_run(&format!("cron runs {} --json", shell_escape(&job_id))).await?;
    if serde_json::from_str::<serde_json::Value>(&raw).is_ok() {
        Ok(raw)
    } else {
        Ok("[]".to_string())
    }
}
