use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub os_version: String,
    pub arch: String,
    pub memory_gb: f64,
}

#[tauri::command]
pub async fn frontend_log(level: String, message: String) -> Result<(), String> {
    match level.as_str() {
        "error" => log::error!("[frontend] {}", message),
        "warn" => log::warn!("[frontend] {}", message),
        "debug" => log::debug!("[frontend] {}", message),
        _ => log::info!("[frontend] {}", message),
    }
    Ok(())
}

/// Detect total physical memory in GB using platform-native commands.
fn detect_memory_gb() -> f64 {
    #[cfg(target_os = "macos")]
    {
        // sysctl -n hw.memsize returns bytes
        std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|bytes| bytes as f64 / 1_073_741_824.0)
            .unwrap_or(0.0)
    }
    #[cfg(target_os = "linux")]
    {
        // /proc/meminfo first line: "MemTotal:  XXXXX kB"
        std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|s| {
                s.lines()
                    .next()
                    .and_then(|line| {
                        line.split_whitespace()
                            .nth(1)
                            .and_then(|kb| kb.parse::<u64>().ok())
                    })
            })
            .map(|kb| kb as f64 / 1_048_576.0)
            .unwrap_or(0.0)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        0.0
    }
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    Ok(SystemInfo {
        os_version: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        memory_gb: detect_memory_gb(),
    })
}
