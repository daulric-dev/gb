use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, State};
use crate::commands::instance::{find_bun, get_registry_path, sanitize_workspaces};
use crate::commands::service::{append_log_arc_pub, ProcessState};

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct UpgradeProgressPayload {
    pub instance_id: String,
    pub step: u8,
    pub total_steps: u8,
    pub stage: String,
    pub title: String,
    pub detail: String,
    pub percent: u8,
}

fn emit_progress(
    app: &AppHandle,
    instance_id: &str,
    step: u8,
    total_steps: u8,
    stage: &str,
    title: &str,
    detail: &str,
    percent: u8,
) {
    let payload = UpgradeProgressPayload {
        instance_id: instance_id.to_string(),
        step,
        total_steps,
        stage: stage.to_string(),
        title: title.to_string(),
        detail: detail.to_string(),
        percent,
    };
    let _ = app.emit("upgrade-progress", &payload);
}

fn is_protected_file(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    if path_str.ends_with(".env")
        || path_str.contains(".env.")
        || path_str.ends_with("instance.json")
        || path_str.contains("/.git/")
        || path_str.starts_with(".git/")
        || path_str.contains("/node_modules/")
        || path_str.starts_with("node_modules/")
        || path_str.contains("/.manager_backup")
        || path_str.starts_with(".manager_backup")
        || path_str.ends_with(".db")
        || path_str.ends_with(".db-journal")
        || path_str.ends_with(".sqlite")
        || path_str.ends_with(".sqlite3")
        || path_str.contains("/uploads/")
        || path_str.starts_with("uploads/")
        || path_str.contains("/storage/")
        || path_str.starts_with("storage/")
        || path_str.ends_with(".zip")
    {
        return true;
    }
    false
}

#[tauri::command]
pub fn extract_and_upgrade_instance(
    app: AppHandle,
    state: State<ProcessState>,
    instance_id: String,
    instance_root: String,
    zip_path: String,
) -> Result<String, String> {
    let root = Path::new(&instance_root);
    let zip_file_path = Path::new(&zip_path);
    let log_key = format!("{}:upgrade", instance_id);

    append_log_arc_pub(
        &state.logs,
        &log_key,
        format!("[Gradebook Manager] Starting in-place upgrade in {:?}...", root),
    );
    emit_progress(&app, &instance_id, 1, 5, "backup", "Creating Snapshot Backup", "Backing up configuration and .env secrets...", 15);

    if !root.exists() {
        let err = "Target instance root does not exist".to_string();
        append_log_arc_pub(&state.logs, &log_key, format!("[Error] {}", err));
        emit_progress(&app, &instance_id, 1, 5, "error", "Upgrade Failed", &err, 0);
        return Err(err);
    }
    if !zip_file_path.exists() {
        let err = "Downloaded archive file does not exist".to_string();
        append_log_arc_pub(&state.logs, &log_key, format!("[Error] {}", err));
        emit_progress(&app, &instance_id, 1, 5, "error", "Upgrade Failed", &err, 0);
        return Err(err);
    }

    // 1. Create a snapshot backup of instance.json and .env files
    append_log_arc_pub(&state.logs, &log_key, "[1/5] Creating snapshot backup of config and secrets...".into());
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    let backup_dir = root.join(format!(".manager_backup_{}", timestamp));
    let _ = fs::create_dir_all(&backup_dir);

    let preserve_files = [
        ("instance.json", root.join("instance.json")),
        ("backend.env", root.join("backend").join(".env")),
        ("frontend.env.local", root.join("frontend").join(".env.local")),
        ("root.env", root.join(".env")),
    ];

    for (name, path) in &preserve_files {
        if path.exists() {
            let _ = fs::copy(path, backup_dir.join(name));
            append_log_arc_pub(&state.logs, &log_key, format!("  Backed up {}", name));
        }
    }

    // 2. Open zip archive and detect common wrapper directory
    emit_progress(&app, &instance_id, 2, 5, "extracting", "Extracting & Replacing Files", "Inspecting release archive and diffing files...", 35);
    append_log_arc_pub(&state.logs, &log_key, "[2/5] Inspecting release archive & diffing files...".into());
    let file = fs::File::open(zip_file_path).map_err(|e| {
        let err = format!("Failed to open zip archive: {}", e);
        emit_progress(&app, &instance_id, 2, 5, "error", "Upgrade Failed", &err, 0);
        err
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        let err = format!("Failed to read zip header: {}", e);
        emit_progress(&app, &instance_id, 2, 5, "error", "Upgrade Failed", &err, 0);
        err
    })?;

    let total_files = archive.len();

    // Detect if archive has a common top-level directory wrapper (e.g. "gradebook-1.5.2/")
    let mut common_prefix: Option<PathBuf> = None;
    let mut all_match = true;

    for i in 0..total_files {
        if let Ok(file) = archive.by_index(i) {
            if let Some(enclosed) = file.enclosed_name() {
                let mut components = enclosed.components();
                if let Some(first) = components.next() {
                    let first_path = PathBuf::from(first.as_os_str());
                    match &common_prefix {
                        None => common_prefix = Some(first_path),
                        Some(prefix) => {
                            if prefix != &first_path {
                                all_match = false;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let wrapper_prefix = if all_match { common_prefix.clone() } else { None };
    if let Some(ref prefix) = wrapper_prefix {
        append_log_arc_pub(
            &state.logs,
            &log_key,
            format!("  Detected archive wrapper directory {:?}. Stripping wrapper to update instance in-place.", prefix),
        );
    }

    let mut added_files: Vec<String> = Vec::new();
    let mut modified_files: Vec<String> = Vec::new();
    let mut unchanged_count: usize = 0;
    let mut archive_files_set: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    for i in 0..total_files {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let enclosed = match file.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };

        let rel_path = match &wrapper_prefix {
            Some(prefix) => match enclosed.strip_prefix(prefix) {
                Ok(p) => p.to_path_buf(),
                Err(_) => enclosed,
            },
            None => enclosed,
        };

        if rel_path.as_os_str().is_empty() {
            continue;
        }

        let outpath = root.join(&rel_path);

        if is_protected_file(&rel_path) {
            continue;
        }

        if file.is_dir() {
            let _ = fs::create_dir_all(&outpath);
        } else {
            archive_files_set.insert(rel_path.clone());
            let mut new_bytes = Vec::new();
            file.read_to_end(&mut new_bytes)
                .map_err(|e| format!("Failed to read content of {:?}: {}", rel_path, e))?;

            if outpath.exists() {
                let existing_bytes = fs::read(&outpath).unwrap_or_default();
                if existing_bytes == new_bytes {
                    unchanged_count += 1;
                    continue;
                }
                // File content changed -> Update in place
                fs::write(&outpath, &new_bytes)
                    .map_err(|e| format!("Failed to update {:?}: {}", rel_path, e))?;
                modified_files.push(rel_path.to_string_lossy().to_string());
            } else {
                // New file -> Create
                if let Some(p) = outpath.parent() {
                    let _ = fs::create_dir_all(p);
                }
                fs::write(&outpath, &new_bytes)
                    .map_err(|e| format!("Failed to create {:?}: {}", rel_path, e))?;
                added_files.push(rel_path.to_string_lossy().to_string());
            }
        }
    }

    // Completely replace old version: identify and remove any obsolete files from the previous version
    let mut deleted_files: Vec<String> = Vec::new();

    fn scan_obsolete_files(dir: &Path, base: &Path, files: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(rel) = path.strip_prefix(base) {
                    if is_protected_file(rel) {
                        continue;
                    }
                }
                if path.is_dir() {
                    scan_obsolete_files(&path, base, files);
                } else if path.is_file() {
                    if let Ok(rel) = path.strip_prefix(base) {
                        files.push(rel.to_path_buf());
                    }
                }
            }
        }
    }

    let mut existing_files = Vec::new();
    scan_obsolete_files(root, root, &mut existing_files);

    for existing_rel in existing_files {
        if !is_protected_file(&existing_rel) && !archive_files_set.contains(&existing_rel) {
            let full_path = root.join(&existing_rel);
            if full_path.exists() {
                if let Ok(()) = fs::remove_file(&full_path) {
                    deleted_files.push(existing_rel.to_string_lossy().to_string());
                }
            }
        }
    }

    // Log Git-style diff feedback
    for m in modified_files.iter().take(20) {
        append_log_arc_pub(&state.logs, &log_key, format!("  M {}", m));
    }
    if modified_files.len() > 20 {
        append_log_arc_pub(
            &state.logs,
            &log_key,
            format!("  ... and {} more modified files", modified_files.len() - 20),
        );
    }

    for a in added_files.iter().take(15) {
        append_log_arc_pub(&state.logs, &log_key, format!("  A {}", a));
    }
    if added_files.len() > 15 {
        append_log_arc_pub(
            &state.logs,
            &log_key,
            format!("  ... and {} more added files", added_files.len() - 15),
        );
    }

    for d in deleted_files.iter().take(15) {
        append_log_arc_pub(&state.logs, &log_key, format!("  D {}", d));
    }
    if deleted_files.len() > 15 {
        append_log_arc_pub(
            &state.logs,
            &log_key,
            format!("  ... and {} more removed obsolete files", deleted_files.len() - 15),
        );
    }

    let diff_summary_str = format!(
        "{} files updated ({} modified, {} added, {} deleted, {} unchanged)",
        modified_files.len() + added_files.len() + deleted_files.len(),
        modified_files.len(),
        added_files.len(),
        deleted_files.len(),
        unchanged_count
    );

    append_log_arc_pub(
        &state.logs,
        &log_key,
        format!("  Diff summary: {}.", diff_summary_str),
    );
    emit_progress(&app, &instance_id, 2, 5, "extracting", "Files Replaced", &diff_summary_str, 55);

    // 3. Clean up accidental nested directory & temporary zip archive
    if let Some(ref prefix) = wrapper_prefix {
        let nested_dir = root.join(prefix);
        if nested_dir.exists() && nested_dir.is_dir() && nested_dir != root {
            let _ = fs::remove_dir_all(&nested_dir);
            append_log_arc_pub(&state.logs, &log_key, format!("  Cleaned up nested folder {:?}.", prefix));
        }
    }

    if zip_file_path.exists() {
        let _ = fs::remove_file(zip_file_path);
        append_log_arc_pub(&state.logs, &log_key, "  Removed temporary release archive.".into());
    }

    // 4. Update instance.json and global registry in-place
    emit_progress(&app, &instance_id, 3, 5, "updating_config", "Updating Version Registry", "Updating instance metadata and registry...", 68);
    append_log_arc_pub(&state.logs, &log_key, "[3/5] Updating instance version & registry...".into());
    let pkg_path = root.join("package.json");
    let mut new_ver_str: Option<String> = None;
    if let Ok(pkg_str) = fs::read_to_string(&pkg_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&pkg_str) {
            if let Some(ver) = v.get("version").and_then(|v| v.as_str()) {
                new_ver_str = Some(ver.to_string());
            }
        }
    }

    // Fallback 1: extract from wrapper directory (e.g. "gradebook-1.5.2" -> "1.5.2")
    if new_ver_str.is_none() {
        if let Some(ref prefix) = wrapper_prefix {
            let p_str = prefix.to_string_lossy();
            if let Some(idx) = p_str.find('-') {
                let candidate = &p_str[idx + 1..];
                if candidate.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                    new_ver_str = Some(candidate.to_string());
                }
            }
        }
    }

    // Fallback 2: extract from zip filename (e.g. "gradebook-1.5.2.zip" -> "1.5.2")
    if new_ver_str.is_none() {
        if let Some(file_name) = zip_file_path.file_stem().and_then(|s| s.to_str()) {
            if let Some(idx) = file_name.find('-') {
                let candidate = &file_name[idx + 1..];
                if candidate.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                    new_ver_str = Some(candidate.to_string());
                }
            }
        }
    }

    // Ensure package.json has the updated version string stamped
    if let Some(ref ver) = new_ver_str {
        if let Ok(pkg_str) = fs::read_to_string(&pkg_path) {
            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&pkg_str) {
                if v.get("version").and_then(|v| v.as_str()) != Some(ver) {
                    v["version"] = serde_json::Value::String(ver.clone());
                    if let Ok(updated_pkg) = serde_json::to_string_pretty(&v) {
                        let _ = fs::write(&pkg_path, updated_pkg);
                    }
                }
            }
        }
    }

    let instance_file = root.join("instance.json");
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(ref ver) = new_ver_str {
        // Update local instance.json
        if let Ok(config_str) = fs::read_to_string(&instance_file) {
            if let Ok(mut cfg) = serde_json::from_str::<crate::models::InstanceConfig>(&config_str) {
                cfg.version = ver.clone();
                cfg.updated_at = now.clone();
                let _ = fs::write(&instance_file, serde_json::to_string_pretty(&cfg).unwrap_or_default());
                append_log_arc_pub(&state.logs, &log_key, format!("  Instance configuration updated to v{}", ver));
            }
        }

        // Update global registry in-place
        let reg_path = get_registry_path();
        if reg_path.exists() {
            if let Ok(content) = fs::read_to_string(&reg_path) {
                if let Ok(mut instances) = serde_json::from_str::<Vec<crate::models::InstanceConfig>>(&content) {
                    let mut found = false;
                    for inst in &mut instances {
                        if inst.id == instance_id || Path::new(&inst.root_path) == root {
                            inst.version = ver.clone();
                            inst.updated_at = now.clone();
                            found = true;
                        }
                    }
                    if found {
                        if let Ok(reg_content) = serde_json::to_string_pretty(&instances) {
                            let _ = fs::write(&reg_path, reg_content);
                            append_log_arc_pub(&state.logs, &log_key, format!("  Manager registry synced to v{}", ver));
                        }
                    }
                }
            }
        }
    }

    // 5. Sanitize package.json workspaces if mobile/ is not in the extracted release
    sanitize_workspaces(root);

    // 6. Run bun db:deploy and db:harden if bun is available
    let bun_info = find_bun();
    let migration_note = if let Some((bun_cmd, _)) = bun_info.as_ref() {
        emit_progress(&app, &instance_id, 4, 5, "migrating", "Applying Database Migrations", "Running bun run db:deploy and db:harden...", 80);
        append_log_arc_pub(&state.logs, &log_key, "[4/5] Applying database migrations (bun run db:deploy)...".into());
        let bun_status = Command::new(bun_cmd)
            .args(["run", "db:deploy"])
            .current_dir(root)
            .status();

        match bun_status {
            Ok(s) if s.success() => {
                append_log_arc_pub(&state.logs, &log_key, "  Migrations applied successfully.".into());
                append_log_arc_pub(&state.logs, &log_key, "[5/5] Hardening schema (bun run db:harden)...".into());
                let _ = Command::new(bun_cmd)
                    .args(["run", "db:harden"])
                    .current_dir(root)
                    .status();
                append_log_arc_pub(&state.logs, &log_key, "  Schema hardened.".into());
                "Database migrations applied successfully."
            }
            _ => {
                append_log_arc_pub(&state.logs, &log_key, "  Notice: Run 'bun run db:deploy' manually if needed.".into());
                "Code updated. Run 'bun run db:deploy && bun run db:harden' if database updates are needed."
            }
        }
    } else {
        append_log_arc_pub(&state.logs, &log_key, "  Notice: Bun not detected. Skipping db:deploy.".into());
        "Code updated in-place. Install Bun to run database migrations."
    };

    // 7. Zero-Downtime process reload: if services were online before upgrade, compile in background and replace in PM2
    let backend_name = crate::commands::service::pm2_name(&instance_id, "backend");
    let frontend_name = crate::commands::service::pm2_name(&instance_id, "frontend");
    let backend_dir = root.join("backend");
    let frontend_dir = root.join("frontend");

    let backend_was_running = crate::commands::service::is_pm2_online(&backend_name, Some(&backend_dir));
    let frontend_was_running = crate::commands::service::is_pm2_online(&frontend_name, Some(&frontend_dir));

    if (backend_was_running || frontend_was_running) && bun_info.is_some() {
        emit_progress(&app, &instance_id, 5, 5, "reloading", "Zero-Downtime Reload", "Building updated assets and rolling reload in PM2...", 92);
        let (bun_cmd, _) = bun_info.as_ref().unwrap();
        let bun_str = bun_cmd.to_string_lossy().to_string();

        if backend_was_running && backend_dir.exists() {
            append_log_arc_pub(&state.logs, &log_key, "[Zero-Downtime] Backend was online. Installing updated dependencies in backend/...".into());
            let prisma_gen = backend_dir.join("src").join("generated").join("prisma");
            if prisma_gen.exists() && (!prisma_gen.join("index.d.ts").exists() && !prisma_gen.join("index.js").exists()) {
                let _ = fs::remove_dir_all(&prisma_gen);
            }
            let _ = Command::new(bun_cmd).args(["install"]).current_dir(&backend_dir).status();

            append_log_arc_pub(&state.logs, &log_key, "[Zero-Downtime] Compiling updated backend assets in background...".into());
            let mut build_cmd = Command::new(bun_cmd);
            build_cmd.args(["run", "build"]).current_dir(&backend_dir).env("NODE_ENV", "production").env("LOCAL_PREVIEW", "true");
            if let Ok(status) = build_cmd.status() {
                if status.success() {
                    let script = crate::commands::service::get_service_script(&backend_dir, "backend");
                    let _ = crate::commands::service::spawn_or_replace_pm2_service(&backend_name, &backend_dir, script, &bun_str, &state.logs, &log_key);
                    append_log_arc_pub(&state.logs, &log_key, "[Zero-Downtime] ✓ Backend seamlessly reloaded in PM2 with new version.".into());
                } else {
                    append_log_arc_pub(&state.logs, &log_key, "[Safety] ⚠️ Backend build failed during upgrade. Old process preserved online.".into());
                }
            }
        }

        if frontend_was_running && frontend_dir.exists() {
            append_log_arc_pub(&state.logs, &log_key, "[Zero-Downtime] Frontend was online. Installing updated dependencies in frontend/...".into());
            let _ = Command::new(bun_cmd).args(["install"]).current_dir(&frontend_dir).status();

            append_log_arc_pub(&state.logs, &log_key, "[Zero-Downtime] Compiling updated frontend assets in background...".into());
            let mut build_cmd = Command::new(bun_cmd);
            build_cmd.args(["run", "build"]).current_dir(&frontend_dir).env("NODE_ENV", "production").env("LOCAL_PREVIEW", "true");
            if let Ok(status) = build_cmd.status() {
                if status.success() {
                    let script = crate::commands::service::get_service_script(&frontend_dir, "frontend");
                    let _ = crate::commands::service::spawn_or_replace_pm2_service(&frontend_name, &frontend_dir, script, &bun_str, &state.logs, &log_key);
                    append_log_arc_pub(&state.logs, &log_key, "[Zero-Downtime] ✓ Frontend seamlessly reloaded in PM2 with new version.".into());
                } else {
                    append_log_arc_pub(&state.logs, &log_key, "[Safety] ⚠️ Frontend build failed during upgrade. Old process preserved online.".into());
                }
            }
        }
    }

    append_log_arc_pub(&state.logs, &log_key, "[Upgrade] ✓ Upgrade successfully completed!".into());
    emit_progress(&app, &instance_id, 5, 5, "complete", "Upgrade Completed", "Version successfully installed and running!", 100);

    Ok(format!(
        "Upgrade completed. {} files updated. Backup in {}. {}",
        modified_files.len() + added_files.len(),
        backup_dir.display(),
        migration_note
    ))
}
