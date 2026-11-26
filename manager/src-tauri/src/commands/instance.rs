use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::models::{InstanceConfig, InstanceHealth, InstanceScanResult, SystemEnvironment};

pub fn get_registry_path() -> PathBuf {
    let mut dir = dirs_next::data_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("gradebook-manager");
    let _ = fs::create_dir_all(&dir);
    dir.push("instances.json");
    dir
}

pub fn find_bun() -> Option<(PathBuf, String)> {
    // 1. Try running "bun --version" directly (works if PATH is inherited)
    if let Ok(output) = Command::new("bun").arg("--version").output() {
        if output.status.success() {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !ver.is_empty() {
                let path = if let Ok(which_out) = Command::new("which").arg("bun").output() {
                    let p = String::from_utf8_lossy(&which_out.stdout).trim().to_string();
                    if !p.is_empty() { PathBuf::from(p) } else { PathBuf::from("bun") }
                } else {
                    PathBuf::from("bun")
                };
                return Some((path, ver));
            }
        }
    }

    // 2. Common fallback paths (macOS/Linux GUI apps often miss shell profile PATH)
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(h) = dirs_next::home_dir() {
        candidates.push(h.join(".bun").join("bin").join("bun"));
        #[cfg(target_os = "windows")]
        candidates.push(h.join(".bun").join("bin").join("bun.exe"));
    }

    candidates.push(PathBuf::from("/opt/homebrew/bin/bun"));
    candidates.push(PathBuf::from("/usr/local/bin/bun"));
    candidates.push(PathBuf::from("/usr/bin/bun"));

    for candidate in candidates {
        if candidate.exists() {
            if let Ok(output) = Command::new(&candidate).arg("--version").output() {
                if output.status.success() {
                    let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !ver.is_empty() {
                        return Some((candidate, ver));
                    }
                }
            }
        }
    }

    None
}

#[tauri::command]
pub fn check_system_environment() -> SystemEnvironment {
    use crate::commands::service::run_pm2;

    let bun_info = find_bun();

    // Check PM2 by executing it directly
    let pm2_info = run_pm2(&["--version"])
        .ok()
        .filter(|version| !version.trim().is_empty());

    let has_pm2 = pm2_info.is_some();
    println!("System environment check: has_bun={}, bun_version={:?}, has_pm2={}, pm2_version={:?}", bun_info.is_some(), bun_info.as_ref().map(|(_, v)| v.clone()), has_pm2, pm2_info);

    SystemEnvironment {
        has_bun: bun_info.is_some(),
        bun_version: bun_info.as_ref().map(|(_, v)| v.clone()),
        bun_path: bun_info.map(|(p, _)| p.to_string_lossy().to_string()),
        has_pm2,
        pm2_version: pm2_info,
        pm2_path: if has_pm2 {
            Some("pm2".to_string())
        } else {
            None
        },
    }
}

#[tauri::command]
pub fn scan_instance_directory(path: String) -> InstanceScanResult {
    let root = Path::new(&path);
    let bun_info = find_bun();
    let has_bun = bun_info.is_some();
    let bun_version = bun_info.map(|(_, v)| v);
    
    let backend_path = root.join("backend");
    let frontend_path = root.join("frontend");

    let has_env = backend_path.join(".env").exists() || frontend_path.join(".env").exists();

    if !root.exists() || !root.is_dir() {
        return InstanceScanResult {
            valid: false,
            version: None,
            has_backend: false,
            has_frontend: false,
            has_instance_file: false,
            has_node_modules: false,
            has_bun,
            has_env,
            bun_version,
            existing_config: None,
            error: Some("Directory does not exist".into()),
        };
    }

    let package_json_path = root.join("package.json");
    let backend_path = root.join("backend");
    let frontend_path = root.join("frontend");
    let instance_json_path = root.join("instance.json");
    let node_modules_path = root.join("node_modules");

    let has_backend = backend_path.exists() && backend_path.is_dir();
    let has_frontend = frontend_path.exists() && frontend_path.is_dir();
    let has_instance_file = instance_json_path.exists();
    let has_node_modules = node_modules_path.exists() && node_modules_path.is_dir();
    let has_env = backend_path.join(".env").exists() || frontend_path.join(".env").exists();

    if !has_env {
        let _ = fs::write(backend_path.join(".env"), "PORT=3001\nFRONTEND_URL=http://localhost:3000\nAPI_URL=http://localhost:3001\nDATABASE_URL=file:./prisma/dev.db\nNODE_ENV=development");
        let _ = fs::write(frontend_path.join(".env"), "NEXT_PUBLIC_API_URL=http://localhost:3001\nNEXT_PUBLIC_STORAGE_URL=http://127.0.0.1:8333\nNEXT_PUBLIC_IMAGES_URL=https://images.example.com");
    }

    let mut existing_config: Option<InstanceConfig> = None;
    if has_instance_file {
        if let Ok(content) = fs::read_to_string(&instance_json_path) {
            if let Ok(cfg) = serde_json::from_str::<InstanceConfig>(&content) {
                existing_config = Some(cfg);
            }
        }
    }

    let mut detected_version: Option<String> = None;
    if let Ok(content) = fs::read_to_string(&package_json_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(v) = val.get("version").and_then(|v| v.as_str()) {
                detected_version = Some(v.to_string());
            }
        }
    }

    // Fallback 1: check existing instance.json config
    if detected_version.is_none() {
        if let Some(ref cfg) = existing_config {
            if cfg.version != "unknown" && !cfg.version.is_empty() {
                detected_version = Some(cfg.version.clone());
            }
        }
    }

    // Fallback 2: deduce from directory name (e.g. "gradebook-1.0.0" -> "1.0.0")
    if detected_version.is_none() {
        if let Some(dir_name) = root.file_name().and_then(|n| n.to_str()) {
            if let Some(idx) = dir_name.find('-') {
                let candidate = &dir_name[idx + 1..];
                if candidate.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                    detected_version = Some(candidate.to_string());
                }
            }
        }
    }

    let valid = has_backend && has_frontend;

    InstanceScanResult {
        valid,
        version: detected_version.or_else(|| existing_config.as_ref().map(|c| c.version.clone())),
        has_backend,
        has_frontend,
        has_instance_file,
        has_node_modules,
        has_env,
        has_bun,
        bun_version,
        existing_config,
        error: if valid { None } else { Some("Missing backend or frontend folder in path".into()) },
    }
}

#[tauri::command]
pub async fn check_instance_health(root_path: String, url: String) -> InstanceHealth {
    let root = Path::new(&root_path);
    let root_exists = root.exists() && root.is_dir();
    let has_backend = root_exists && root.join("backend").is_dir();
    let has_frontend = root_exists && root.join("frontend").is_dir();
    let node_modules_path = root.join("node_modules");
    let has_node_modules = root_exists && node_modules_path.is_dir();
    let has_env = root_exists && (root.join("backend").join(".env").exists() || root.join("frontend").join(".env").exists());

    let bun_info = find_bun();
    let has_bun = bun_info.is_some();
    let bun_version = bun_info.map(|(_, v)| v);

    let is_online = check_instance_online(url).await;

    InstanceHealth {
        root_exists,
        has_backend,
        has_frontend,
        has_node_modules,
        has_env,
        has_bun,
        bun_version,
        is_online,
    }
}

pub fn sanitize_workspaces(root: &Path) {
    let pkg_path = root.join("package.json");
    let mobile_path = root.join("mobile");

    // If mobile directory doesn't exist, remove "mobile" from package.json workspaces
    if !mobile_path.exists() && pkg_path.exists() {
        if let Ok(content) = fs::read_to_string(&pkg_path) {
            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(workspaces) = json.get_mut("workspaces").and_then(|w| w.as_array_mut()) {
                    let prev_len = workspaces.len();
                    workspaces.retain(|w| w.as_str() != Some("mobile"));
                    if workspaces.len() != prev_len {
                        if let Ok(updated) = serde_json::to_string_pretty(&json) {
                            let _ = fs::write(&pkg_path, updated);
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn install_instance_packages(root_path: String) -> Result<String, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("Target instance root does not exist".into());
    }

    // Automatically fix workspaces if mobile/ is not shipped in this instance
    sanitize_workspaces(root);

    let (bun_cmd, _) = find_bun().ok_or_else(|| {
        "Bun is not installed or could not be found. Please install Bun first (https://bun.sh)".to_string()
    })?;

    let output = Command::new(bun_cmd)
        .arg("install")
        .current_dir(root)
        .output()
        .map_err(|e| format!("Failed to run bun install: {}", e))?;

    if output.status.success() {
        let msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if msg.is_empty() { "Packages installed successfully.".into() } else { msg })
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("bun install failed: {}", err))
    }
}

#[tauri::command]
pub fn save_instance_config(config: InstanceConfig) -> Result<(), String> {
    // 1. Save instance.json into the instance root directory
    let root = Path::new(&config.root_path);
    if root.exists() {
        let instance_file = root.join("instance.json");
        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&instance_file, content)
            .map_err(|e| format!("Failed to write instance.json: {}", e))?;
    }

    // 2. Update global manager instance registry
    let reg_path = get_registry_path();
    let mut instances: Vec<InstanceConfig> = if reg_path.exists() {
        fs::read_to_string(&reg_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    instances.retain(|i| i.id != config.id && i.root_path != config.root_path);
    instances.push(config);

    let reg_content = serde_json::to_string_pretty(&instances)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    fs::write(&reg_path, reg_content)
        .map_err(|e| format!("Failed to write registry: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn remove_registered_instance(instance_id: String) -> Result<(), String> {
    let reg_path = get_registry_path();
    if reg_path.exists() {
        let content = fs::read_to_string(&reg_path)
            .map_err(|e| format!("Failed to read registry: {}", e))?;
        let mut instances: Vec<InstanceConfig> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse registry: {}", e))?;

        instances.retain(|i| i.id != instance_id);

        let reg_content = serde_json::to_string_pretty(&instances)
            .map_err(|e| format!("Failed to serialize registry: {}", e))?;
        fs::write(&reg_path, reg_content)
            .map_err(|e| format!("Failed to write registry: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn load_registered_instances() -> Result<Vec<InstanceConfig>, String> {
    let reg_path = get_registry_path();
    if !reg_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&reg_path)
        .map_err(|e| format!("Failed to read registry: {}", e))?;
    let instances: Vec<InstanceConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse registry: {}", e))?;

    Ok(instances)
}

#[tauri::command]
pub async fn check_instance_online(url: String) -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build();

    if let Ok(client) = client {
        client.get(&url).send().await.map(|r| r.status().is_success() || r.status().as_u16() == 404).unwrap_or(false)
    } else {
        false
    }
}
