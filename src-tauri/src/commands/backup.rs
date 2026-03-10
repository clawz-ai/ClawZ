use super::cli::bg_std_command;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Resolve ~/.openclaw directory.
fn openclaw_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| {
        log::error!("[backup] failed to get HOME: {}", e);
        "Failed to get HOME directory".to_string()
    })?;
    Ok(PathBuf::from(home).join(".openclaw"))
}

/// Simple ISO timestamp without external crate.
fn chrono_now() -> String {
    bg_std_command("date")
        .arg("-u")
        .arg("+%Y-%m-%dT%H:%M:%SZ")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// Try to get the installed openclaw version via CLI.
fn detect_openclaw_version() -> String {
    bg_std_command("openclaw")
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// Directories inside ~/.openclaw that must be backed up.
/// Extensions exclude node_modules (reinstallable); workspace excludes .git.
const BACKUP_DIRS: &[&str] = &[
    "identity",
    "agents",
    "workspace",
    "extensions",
    "devices",
    "cron",
];

/// Patterns to skip when walking directories.
fn should_skip(rel: &str) -> bool {
    rel.contains("/node_modules/")
        || rel.starts_with("node_modules/")
        || rel.contains("/.git/")
        || rel.starts_with(".git/")
        || rel.ends_with("/.git")
}

/// Recursively add all files under `dir` to the zip, using `prefix` as the archive path root.
fn zip_add_dir<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    prefix: &str,
) -> Result<(), String> {
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = std::fs::read_dir(&current)
            .map_err(|e| format!("Failed to read dir {}: {}", current.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
            let path = entry.path();
            let rel = path
                .strip_prefix(dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();

            if should_skip(&rel) {
                continue;
            }

            let archive_path = if prefix.is_empty() {
                rel.clone()
            } else {
                format!("{}/{}", prefix, rel)
            };

            if path.is_dir() {
                stack.push(path);
            } else {
                let mut file = std::fs::File::open(&path)
                    .map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
                let mut buf = Vec::new();
                file.read_to_end(&mut buf)
                    .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
                zip.start_file(&archive_path, options)
                    .map_err(|e| format!("Zip error for {}: {}", archive_path, e))?;
                zip.write_all(&buf)
                    .map_err(|e| format!("Zip write error for {}: {}", archive_path, e))?;
            }
        }
    }
    Ok(())
}

/// Export all essential .openclaw data as a zip file.
#[tauri::command]
pub async fn export_config(dest_path: String) -> Result<String, String> {
    log::info!("[export_config] dest={}", dest_path);
    let oc_dir = openclaw_dir()?;
    let dest = dest_path.clone();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::create(&dest)
            .map_err(|e| {
                log::error!("[export_config] failed to create file {}: {}", dest, e);
                format!("Failed to create {}: {}", dest, e)
            })?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // 1. Write metadata manifest
        let manifest = serde_json::json!({
            "_clawz_backup": true,
            "_version": 2,
            "_openclaw_version": detect_openclaw_version(),
            "_exported_at": chrono_now(),
        });
        let manifest_bytes = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("JSON error: {}", e))?;
        zip.start_file("manifest.json", options)
            .map_err(|e| format!("Zip error: {}", e))?;
        zip.write_all(manifest_bytes.as_bytes())
            .map_err(|e| format!("Zip write error: {}", e))?;

        // 2. Add openclaw.json
        let config_path = oc_dir.join("openclaw.json");
        if config_path.exists() {
            let mut buf = Vec::new();
            std::fs::File::open(&config_path)
                .and_then(|mut f| f.read_to_end(&mut buf))
                .map_err(|e| format!("Failed to read config: {}", e))?;
            zip.start_file("openclaw.json", options)
                .map_err(|e| format!("Zip error: {}", e))?;
            zip.write_all(&buf)
                .map_err(|e| format!("Zip write error: {}", e))?;
        }

        // 3. Add each backup directory
        for dir_name in BACKUP_DIRS {
            let dir = oc_dir.join(dir_name);
            if dir.exists() && dir.is_dir() {
                zip_add_dir(&mut zip, &dir, dir_name)?;
            }
        }

        zip.finish().map_err(|e| format!("Zip finish error: {}", e))?;
        Ok(dest_path)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Read manifest.json from a backup zip and return version info.
fn read_manifest(data: &[u8]) -> Result<Value, String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid zip: {}", e))?;
    let mut manifest_file = archive
        .by_name("manifest.json")
        .map_err(|_| "Not a valid ClawZ backup: missing manifest.json".to_string())?;
    let mut buf = String::new();
    manifest_file
        .read_to_string(&mut buf)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: Value = super::cli::parse_json(&buf, "import_config/manifest")?;
    if manifest.get("_clawz_backup") != Some(&Value::Bool(true)) {
        return Err("Not a valid ClawZ backup file".into());
    }
    Ok(manifest)
}

/// Pre-check a backup zip without applying it. Returns JSON with version info.
#[tauri::command]
pub async fn precheck_backup(src_path: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let data =
            std::fs::read(&src_path).map_err(|e| format!("Failed to read backup: {}", e))?;
        let manifest = read_manifest(&data)?;

        let backup_version = manifest
            .get("_openclaw_version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let exported_at = manifest
            .get("_exported_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let local_version = detect_openclaw_version();

        Ok(serde_json::json!({
            "backupVersion": backup_version,
            "localVersion": local_version,
            "exportedAt": exported_at,
        }))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Recursively copy a directory. Skips errors on individual files.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create {}: {}", dst.display(), e))?;
    let mut stack = vec![src.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match std::fs::read_dir(&current) {
            Ok(e) => e,
            Err(e) => {
                log::warn!(
                    "[copy_dir_recursive] skipping unreadable directory {}: {}",
                    current.display(),
                    e
                );
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let rel = match path.strip_prefix(src) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let target = dst.join(rel);
            if path.is_dir() {
                if let Err(e) = std::fs::create_dir_all(&target) {
                    log::warn!(
                        "[copy_dir_recursive] failed to create directory {}: {}",
                        target.display(),
                        e
                    );
                }
                stack.push(path);
            } else if let Err(e) = std::fs::copy(&path, &target) {
                log::warn!(
                    "[copy_dir_recursive] failed to copy file {} → {}: {}",
                    path.display(),
                    target.display(),
                    e
                );
            }
        }
    }
    Ok(())
}

/// Import config: reads a backup zip and restores files to ~/.openclaw.
#[tauri::command]
pub async fn import_config(src_path: String) -> Result<String, String> {
    log::info!("[import_config] src={}", src_path);
    let oc_dir = openclaw_dir()?;

    tokio::task::spawn_blocking(move || {
        let data =
            std::fs::read(&src_path).map_err(|e| {
                log::error!("[import_config] failed to read backup file: {}", e);
                format!("Failed to read backup: {}", e)
            })?;

        // Validate
        read_manifest(&data)?;

        let cursor = std::io::Cursor::new(&data);
        let mut archive =
            zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid zip: {}", e))?;

        // Safety backup: rename entire .openclaw → .openclaw.pre-restore.{timestamp}
        let ts = chrono_now().replace(':', "-");
        let pre_restore = oc_dir.with_file_name(format!(".openclaw.pre-restore.{}", ts));
        copy_dir_recursive(&oc_dir, &pre_restore)?;

        // Extract all files (except manifest.json) to oc_dir
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Zip entry error: {}", e))?;
            let name = file.name().to_string();

            if name == "manifest.json" || name.ends_with('/') {
                continue;
            }

            let dest = oc_dir.join(&name);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir for {}: {}", name, e))?;
            }

            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .map_err(|e| format!("Failed to read zip entry {}: {}", name, e))?;
            std::fs::write(&dest, &buf)
                .map_err(|e| format!("Failed to write {}: {}", name, e))?;
        }

        Ok("ok".into())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
