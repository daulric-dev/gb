use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;
use crate::commands::instance::{find_bun, sanitize_workspaces};
use crate::models::ServiceRuntimeStatus;

const MAX_LOG_LINES: usize = 200;

#[derive(Default)]
pub struct ProcessState {
    pub children: Mutex<HashMap<String, Child>>,
    pub logs: Arc<Mutex<HashMap<String, VecDeque<String>>>>,
}

fn make_key(instance_id: &str, service: &str) -> String {
    format!("{}:{}", instance_id, service)
}

fn append_log_arc(logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>, key: &str, line: String) {
    if let Ok(mut map) = logs.lock() {
        let queue = map.entry(key.to_string()).or_insert_with(VecDeque::new);
        if queue.len() >= MAX_LOG_LINES {
            queue.pop_front();
        }
        queue.push_back(line);
    }
}

#[tauri::command]
pub fn install_service_packages(root_path: String, service: String) -> Result<String, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("Target instance root does not exist".into());
    }

    sanitize_workspaces(root);

    let (bun_cmd, _) = find_bun().ok_or_else(|| {
        "Bun is not installed or could not be found. Please install Bun first (https://bun.sh)".to_string()
    })?;

    match service.as_str() {
        "backend" => {
            let backend_dir = root.join("backend");
            if !backend_dir.exists() {
                return Err("Backend directory does not exist".into());
            }
            let output = Command::new(&bun_cmd)
                .arg("install")
                .current_dir(&backend_dir)
                .output()
                .map_err(|e| format!("Failed to run bun install in backend: {}", e))?;

            if !output.status.success() {
                return Err(format!(
                    "Backend install failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            Ok("Backend packages installed successfully.".into())
        }
        "frontend" => {
            let frontend_dir = root.join("frontend");
            if !frontend_dir.exists() {
                return Err("Frontend directory does not exist".into());
            }
            let output = Command::new(&bun_cmd)
                .arg("install")
                .current_dir(&frontend_dir)
                .output()
                .map_err(|e| format!("Failed to run bun install in frontend: {}", e))?;

            if !output.status.success() {
                return Err(format!(
                    "Frontend install failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            Ok("Frontend packages installed successfully.".into())
        }
        "all" | _ => {
            // Run sequentially: backend then frontend
            let mut summary = Vec::new();

            let backend_dir = root.join("backend");
            if backend_dir.exists() {
                let out = Command::new(&bun_cmd)
                    .arg("install")
                    .current_dir(&backend_dir)
                    .output()
                    .map_err(|e| format!("Backend install error: {}", e))?;
                if out.status.success() {
                    summary.push("Backend: ✓ Installed");
                } else {
                    summary.push("Backend: ✗ Failed");
                }
            }

            let frontend_dir = root.join("frontend");
            if frontend_dir.exists() {
                let out = Command::new(&bun_cmd)
                    .arg("install")
                    .current_dir(&frontend_dir)
                    .output()
                    .map_err(|e| format!("Frontend install error: {}", e))?;
                if out.status.success() {
                    summary.push("Frontend: ✓ Installed");
                } else {
                    summary.push("Frontend: ✗ Failed");
                }
            }

            // Also sync root workspaces
            let out = Command::new(&bun_cmd)
                .arg("install")
                .current_dir(root)
                .output();
            if let Ok(o) = out {
                if o.status.success() {
                    summary.push("Root workspace: ✓ Synced");
                }
            }

            Ok(summary.join(" | "))
        }
    }
}

#[tauri::command]
pub fn start_service(
    state: State<ProcessState>,
    instance_id: String,
    root_path: String,
    service: String,
) -> Result<String, String> {
    let key = make_key(&instance_id, &service);

    // Check if already running
    if let Ok(mut children) = state.children.lock() {
        if let Some(child) = children.get_mut(&key) {
            if let Ok(None) = child.try_wait() {
                return Err(format!("{} is already running", service));
            }
        }
    }

    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("Instance directory does not exist".into());
    }

    sanitize_workspaces(root);

    let (bun_cmd, _) = find_bun().ok_or_else(|| {
        "Bun is not installed or could not be found. Please install Bun first (https://bun.sh)".to_string()
    })?;

    let (dir, script) = match service.as_str() {
        "backend" => (root.join("backend"), "start:dev"),
        "frontend" => (root.join("frontend"), "dev"),
        _ => return Err(format!("Unknown service: {}", service)),
    };

    if !dir.exists() {
        return Err(format!("Directory {:?} does not exist", dir));
    }

    // Clear previous logs
    if let Ok(mut logs) = state.logs.lock() {
        logs.insert(key.clone(), VecDeque::new());
    }

    append_log_arc(
        &state.logs,
        &key,
        format!("[Gradebook Manager] Starting {} in {:?}...", service, dir),
    );

    let mut cmd = Command::new(bun_cmd);
    cmd.args(["run", script])
        .current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {}: {}", service, e))?;

    // Spawn stdout reader thread to capture live logs
    if let Some(stdout) = child.stdout.take() {
        let key_clone = key.clone();
        let logs_arc = Arc::clone(&state.logs);
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                append_log_arc(&logs_arc, &key_clone, line);
            }
        });
    }

    // Spawn stderr reader thread
    if let Some(stderr) = child.stderr.take() {
        let key_clone = key.clone();
        let logs_arc = Arc::clone(&state.logs);
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                append_log_arc(&logs_arc, &key_clone, format!("[err] {}", line));
            }
        });
    }

    let pid = child.id();
    if let Ok(mut children) = state.children.lock() {
        children.insert(key, child);
    }

    Ok(format!("{} started (PID {})", service, pid))
}

#[tauri::command]
pub fn stop_service(
    state: State<ProcessState>,
    instance_id: String,
    service: String,
) -> Result<String, String> {
    let key = make_key(&instance_id, &service);

    let child = {
        let mut children = state
            .children
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        children.remove(&key)
    };

    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
        append_log_arc(&state.logs, &key, format!("[Gradebook Manager] Stopped {}.", service));
        Ok(format!("{} stopped", service))
    } else {
        Ok(format!("{} was not running", service))
    }
}

#[tauri::command]
pub fn get_service_status(
    state: State<ProcessState>,
    instance_id: String,
    service: String,
) -> ServiceRuntimeStatus {
    let key = make_key(&instance_id, &service);

    if let Ok(mut children) = state.children.lock() {
        if let Some(child) = children.get_mut(&key) {
            match child.try_wait() {
                Ok(None) => {
                    return ServiceRuntimeStatus {
                        service,
                        running: true,
                        pid: Some(child.id()),
                    };
                }
                _ => {
                    children.remove(&key);
                }
            }
        }
    }

    ServiceRuntimeStatus {
        service,
        running: false,
        pid: None,
    }
}

#[tauri::command]
pub fn get_service_logs(
    state: State<ProcessState>,
    instance_id: String,
    service: String,
    max_lines: Option<usize>,
) -> Vec<String> {
    let key = make_key(&instance_id, &service);
    let limit = max_lines.unwrap_or(MAX_LOG_LINES);

    if let Ok(logs) = state.logs.lock() {
        if let Some(queue) = logs.get(&key) {
            let start = if queue.len() > limit {
                queue.len() - limit
            } else {
                0
            };
            return queue.iter().skip(start).cloned().collect();
        }
    }
    Vec::new()
}
