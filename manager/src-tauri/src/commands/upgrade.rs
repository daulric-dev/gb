use std::fs;
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn extract_and_upgrade_instance(instance_root: String, zip_path: String) -> Result<String, String> {
    let root = Path::new(&instance_root);
    let zip_file_path = Path::new(&zip_path);

    if !root.exists() {
        return Err("Target instance root does not exist".into());
    }
    if !zip_file_path.exists() {
        return Err("Downloaded archive file does not exist".into());
    }

    // 1. Create a snapshot backup of instance.json and .env files
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
        }
    }

    // 2. Unpack zip archive into instance_root
    let file = fs::File::open(zip_file_path).map_err(|e| format!("Failed to open zip archive: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip header: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let outpath = match file.enclosed_name() {
            Some(path) => root.join(path),
            None => continue,
        };

        // Don't overwrite existing uploads or user secrets
        if outpath.ends_with(".env") || outpath.ends_with(".env.local") || outpath.ends_with("instance.json") {
            continue;
        }

        if file.name().ends_with('/') {
            let _ = fs::create_dir_all(&outpath);
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    let _ = fs::create_dir_all(p);
                }
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to extract file {:?}: {}", outpath, e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to write extracted file: {}", e))?;
        }
    }

    // 3. Restore preserved instance.json and update its version
    let instance_file = root.join("instance.json");
    if let Ok(config_str) = fs::read_to_string(&instance_file) {
        // Read new package.json version
        let pkg_path = root.join("package.json");
        if let Ok(pkg_str) = fs::read_to_string(&pkg_path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&pkg_str) {
                if let Some(ver) = v.get("version").and_then(|v| v.as_str()) {
                    if let Ok(mut cfg) = serde_json::from_str::<crate::models::InstanceConfig>(&config_str) {
                        cfg.version = ver.to_string();
                        cfg.updated_at = chrono::Utc::now().to_rfc3339();
                        let _ = fs::write(&instance_file, serde_json::to_string_pretty(&cfg).unwrap_or_default());
                    }
                }
            }
        }
    }

    // 4. Sanitize package.json workspaces if mobile/ is not in the extracted release
    crate::commands::instance::sanitize_workspaces(root);

    // 5. Run bun db:deploy and db:harden if bun is available
    let bun_status = Command::new("bun")
        .args(["run", "db:deploy"])
        .current_dir(root)
        .status();

    let migration_note = match bun_status {
        Ok(s) if s.success() => {
            let _ = Command::new("bun")
                .args(["run", "db:harden"])
                .current_dir(root)
                .status();
            "Database migrations applied successfully."
        }
        _ => "Code extracted. Run 'bun run db:deploy && bun run db:harden' to complete schema update.",
    };

    Ok(format!(
        "Upgrade completed. Backup saved in {}. {}",
        backup_dir.display(),
        migration_note
    ))
}
