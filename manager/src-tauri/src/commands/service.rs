use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;
use crate::commands::instance::sanitize_workspaces;
use crate::models::ServiceRuntimeStatus;

const MAX_LOG_LINES: usize = 500;

// ─── Process state (kept for install/upgrade log streaming) ─────────────────
#[derive(Default)]
pub struct ProcessState {
    pub logs: Arc<Mutex<HashMap<String, VecDeque<String>>>>,
}

pub fn make_key(instance_id: &str, service: &str) -> String {
    format!("{}:{}", instance_id, service)
}

pub fn append_log_arc_pub(
    logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    key: &str,
    line: String,
) {
    if let Ok(mut map) = logs.lock() {
        let queue = map.entry(key.to_string()).or_insert_with(VecDeque::new);
        if queue.len() >= MAX_LOG_LINES {
            queue.pop_front();
        }
        queue.push_back(line);
    }
}

// ─── PM2 helpers ─────────────────────────────────────────────────────────────

/// Execute the globally-installed PM2 command.
/// The operating system resolves `pm2` through the current process PATH.
pub fn run_pm2(args: &[&str]) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", "pm2"])
        .args(args)
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("pm2")
        .args(args)
        .output();

    let output = output.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "PM2 is not installed or is not available in PATH. Install it using: bun add -g pm2"
                .to_string()
        } else {
            format!("Failed to execute PM2: {}", error)
        }
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        return Ok(stdout);
    }

    #[cfg(target_os = "windows")]
    {
        let message = format!("{}{}", stdout, stderr);
        let lower = message.to_lowercase();

        if lower.contains("is not recognized as an internal or external command")
            || lower.contains("cannot find the file")
        {
            return Err(
                "PM2 is not installed or is not available in PATH. Install it using: bun add -g pm2"
                    .to_string(),
            );
        }
    }

    let message = format!("{}{}", stdout, stderr);
    if message.trim().is_empty() {
        Err(format!("PM2 exited with status {}", output.status))
    } else {
        Err(message)
    }
}

/// Build the unique PM2 process name for a service.
/// Format: `gb-{short_instance_id}-{service}` (e.g. `gb-7026999a-backend`)
fn pm2_name(instance_id: &str, service: &str) -> String {
    let short = &instance_id[..instance_id.len().min(8)];
    format!("gb-{}-{}", short, service)
}

// ─── Logged command helper (for install/upgrade) ─────────────────────────────

fn run_logged_command(
    logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    key: &str,
    cmd_label: &str,
    mut cmd: Command,
) -> Result<(), String> {
    append_log_arc_pub(logs, key, format!("> {}", cmd_label));
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start {}: {}", cmd_label, e))?;

    let stdout_opt = child.stdout.take();
    let stderr_opt = child.stderr.take();

    let logs_out = Arc::clone(logs);
    let key_out = key.to_string();
    let t_out = std::thread::spawn(move || {
        if let Some(stdout) = stdout_opt {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                append_log_arc_pub(&logs_out, &key_out, line);
            }
        }
    });

    let logs_err = Arc::clone(logs);
    let key_err = key.to_string();
    let t_err = std::thread::spawn(move || {
        if let Some(stderr) = stderr_opt {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                append_log_arc_pub(&logs_err, &key_err, line);
            }
        }
    });

    let _ = t_out.join();
    let _ = t_err.join();

    let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;
    if status.success() {
        append_log_arc_pub(logs, key, format!("✓ {} completed successfully.", cmd_label));
        Ok(())
    } else {
        let err_msg = format!("✗ {} failed with exit status: {}", cmd_label, status);
        append_log_arc_pub(logs, key, err_msg.clone());
        Err(err_msg)
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn install_service_packages(
    state: State<ProcessState>,
    instance_id: String,
    root_path: String,
    service: String,
) -> Result<String, String> {
    use crate::commands::instance::find_bun;

    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("Target instance root does not exist".into());
    }

    let log_key = make_key(&instance_id, "install");
    if let Ok(mut logs) = state.logs.lock() {
        logs.insert(log_key.clone(), VecDeque::new());
    }

    append_log_arc_pub(
        &state.logs,
        &log_key,
        format!("[Gradebook Manager] Starting package installation ({}) in {:?}...", service, root),
    );

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
            let mut cmd = Command::new(&bun_cmd);
            cmd.arg("install").current_dir(&backend_dir);
            run_logged_command(&state.logs, &log_key, "bun install in backend/", cmd)?;
            Ok("Backend packages installed successfully.".into())
        }
        "frontend" => {
            let frontend_dir = root.join("frontend");
            if !frontend_dir.exists() {
                return Err("Frontend directory does not exist".into());
            }
            let mut cmd = Command::new(&bun_cmd);
            cmd.arg("install").current_dir(&frontend_dir);
            run_logged_command(&state.logs, &log_key, "bun install in frontend/", cmd)?;
            Ok("Frontend packages installed successfully.".into())
        }
        "all" | _ => {
            let mut summary = Vec::new();

            let backend_dir = root.join("backend");
            if backend_dir.exists() {
                let mut cmd = Command::new(&bun_cmd);
                cmd.arg("install").current_dir(&backend_dir);
                match run_logged_command(&state.logs, &log_key, "bun install in backend/", cmd) {
                    Ok(_) => summary.push("Backend: ✓"),
                    Err(_) => summary.push("Backend: ✗"),
                }
            }

            let frontend_dir = root.join("frontend");
            if frontend_dir.exists() {
                let mut cmd = Command::new(&bun_cmd);
                cmd.arg("install").current_dir(&frontend_dir);
                match run_logged_command(&state.logs, &log_key, "bun install in frontend/", cmd) {
                    Ok(_) => summary.push("Frontend: ✓"),
                    Err(_) => summary.push("Frontend: ✗"),
                }
            }

            let mut cmd = Command::new(&bun_cmd);
            cmd.arg("install").current_dir(root);
            if run_logged_command(&state.logs, &log_key, "bun install in root workspace", cmd).is_ok() {
                summary.push("Root: ✓");
            }

            append_log_arc_pub(
                &state.logs,
                &log_key,
                "[Gradebook Manager] All packages installation complete.".into(),
            );
            Ok(summary.join(" | "))
        }
    }
}

/// Start a service via PM2.
///
/// PM2 ecosystem config written to `{root}/.pm2/{service}.config.cjs` so PM2
/// can restart with the same settings on `pm2 resurrect`.
#[tauri::command]
pub fn start_service(
    state: State<ProcessState>,
    instance_id: String,
    root_path: String,
    service: String,
) -> Result<String, String> {
    use crate::commands::instance::find_bun;

    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("Instance directory does not exist".into());
    }

    sanitize_workspaces(root);

    let (bun_cmd, _) = find_bun().ok_or_else(|| {
        "Bun is not installed or could not be found. Please install Bun first (https://bun.sh)".to_string()
    })?;
    let bun_str = bun_cmd.to_string_lossy().to_string();

    let name = pm2_name(&instance_id, &service);
    let log_key = make_key(&instance_id, &service);

    // Clear old in-memory logs
    if let Ok(mut logs) = state.logs.lock() {
        logs.insert(log_key.clone(), VecDeque::new());
    }

    // Determine service directory and start script
    let (service_dir, start_script) = match service.as_str() {
        "backend"  => (root.join("backend"),  "start:dev"),
        "frontend" => (root.join("frontend"), "dev"),
        _ => return Err(format!("Unknown service: {}", service)),
    };

    if !service_dir.exists() {
        return Err(format!("Service directory {:?} does not exist", service_dir));
    }

    // Write a PM2 ecosystem config file so the process is re-startable
    let pm2_dir = root.join(".pm2");
    let _ = std::fs::create_dir_all(&pm2_dir);
    let config_path = pm2_dir.join(format!("{}.config.cjs", service));
    let ecosystem = format!(
        r#"module.exports = {{
  apps: [{{
    name: "{}",
    interpreter: "{}",
    interpreter_args: "run {}",
    cwd: "{}",
    watch: false,
    autorestart: true,
    max_restarts: 5,
    env: {{
      NODE_ENV: "{}",
    }},
  }}],
}};
"#,
        name,
        bun_str,
        start_script,
        service_dir.to_string_lossy(),
        if service == "frontend" { "development" } else { "development" },
    );
    std::fs::write(&config_path, &ecosystem)
        .map_err(|e| format!("Failed to write PM2 ecosystem config: {}", e))?;

    // If already registered in PM2, restart it; otherwise start fresh
    let jlist = run_pm2(&["jlist"]).unwrap_or_default();
    let already_exists = jlist.contains(&format!("\"name\":\"{}\"", name))
        || jlist.contains(&format!("\"name\": \"{}\"", name));

    if already_exists {
        append_log_arc_pub(
            &state.logs, &log_key,
            format!("[PM2] Process '{}' already registered — restarting…", name),
        );
        run_pm2(&["restart", &name])
            .map_err(|e| format!("pm2 restart failed: {}", e))?;
    } else {
        append_log_arc_pub(
            &state.logs, &log_key,
            format!("[PM2] Starting '{}' via ecosystem config…", name),
        );
        let config_str = config_path.to_string_lossy().to_string();
        run_pm2(&["start", &config_str])
            .map_err(|e| format!("pm2 start failed: {}", e))?;
    }

    // Save PM2 process list so it survives reboots
    let _ = run_pm2(&["save", "--force"]);

    append_log_arc_pub(
        &state.logs, &log_key,
        format!("[PM2] ✓ '{}' is now managed by PM2.", name),
    );

    Ok(format!("{} started via PM2 (name: {})", service, name))
}

/// Stop a PM2-managed service (leaves it in PM2's list as `stopped`).
#[tauri::command]
pub fn stop_service(
    state: State<ProcessState>,
    instance_id: String,
    service: String,
) -> Result<String, String> {
    let name = pm2_name(&instance_id, &service);
    let log_key = make_key(&instance_id, &service);

    append_log_arc_pub(
        &state.logs, &log_key,
        format!("[PM2] Stopping '{}'…", name),
    );

    run_pm2(&["stop", &name])
        .map_err(|e| format!("pm2 stop failed: {}", e))?;

    let _ = run_pm2(&["save", "--force"]);

    append_log_arc_pub(&state.logs, &log_key, format!("[PM2] ✓ '{}' stopped.", name));
    Ok(format!("{} stopped", service))
}

/// Delete a PM2 process entirely (called when removing an instance).
#[tauri::command]
pub fn delete_service(
    _state: State<ProcessState>,
    instance_id: String,
    service: String,
) -> Result<String, String> {
    let name = pm2_name(&instance_id, &service);
    let _ = run_pm2(&["delete", &name]);
    let _ = run_pm2(&["save", "--force"]);
    Ok(format!("{} deleted from PM2", service))
}

/// Query PM2 for the status of a service.
/// Parses the JSON output of `pm2 jlist` to find the matching process.
#[tauri::command]
pub fn get_service_status(
    _state: State<ProcessState>,
    instance_id: String,
    service: String,
) -> ServiceRuntimeStatus {
    let name = pm2_name(&instance_id, &service);

    {
        if let Ok(json_str) = run_pm2(&["jlist"]) {
            if let Ok(list) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(arr) = list.as_array() {
                    for proc in arr {
                        let proc_name = proc["name"].as_str().unwrap_or("");
                        if proc_name == name {
                            let pm2_status = proc["pm2_env"]["status"]
                                .as_str()
                                .unwrap_or("stopped");
                            let running = pm2_status == "online";
                            let pid = if running {
                                proc["pid"].as_u64().map(|p| p as u32)
                            } else {
                                None
                            };
                            return ServiceRuntimeStatus {
                                service,
                                running,
                                pid,
                                pm2_name: Some(name),
                                pm2_status: Some(pm2_status.to_string()),
                            };
                        }
                    }
                }
            }
        }
    }

    ServiceRuntimeStatus {
        service,
        running: false,
        pid: None,
        pm2_name: Some(name),
        pm2_status: Some("not_registered".to_string()),
    }
}

/// Fetch logs for a service from PM2's log files, or from the in-memory
/// buffer for install/upgrade operations.
#[tauri::command]
pub fn get_service_logs(
    state: State<ProcessState>,
    instance_id: String,
    service: String,
    max_lines: Option<usize>,
) -> Vec<String> {
    let limit = max_lines.unwrap_or(MAX_LOG_LINES);

    // install / upgrade logs come from the in-memory buffer
    if service == "install" || service == "upgrade" {
        let key = make_key(&instance_id, &service);
        if let Ok(logs) = state.logs.lock() {
            if let Some(queue) = logs.get(&key) {
                let start = if queue.len() > limit { queue.len() - limit } else { 0 };
                return queue.iter().skip(start).cloned().collect();
            }
        }
        return Vec::new();
    }

    // For backend/frontend, read from PM2 log files
    let name = pm2_name(&instance_id, &service);

    // PM2 stores logs at ~/.pm2/logs/{name}-out.log and {name}-error.log
    let pm2_home = std::env::var("PM2_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| dirs_next::home_dir().map(|h| h.join(".pm2")))
        .unwrap_or_else(|| PathBuf::from("/tmp/.pm2"));

    let out_log = pm2_home.join("logs").join(format!("{}-out.log", name));
    let err_log = pm2_home.join("logs").join(format!("{}-error.log", name));

    let mut lines: Vec<(u64, String)> = Vec::new();

    // Read stdout log
    if let Ok(content) = std::fs::read_to_string(&out_log) {
        for (i, line) in content.lines().enumerate() {
            lines.push((i as u64, line.to_string()));
        }
    }

    // Read stderr log and interleave (prefix with [err])
    if let Ok(content) = std::fs::read_to_string(&err_log) {
        for line in content.lines() {
            if !line.trim().is_empty() {
                lines.push((u64::MAX, format!("[err] {}", line)));
            }
        }
    }

    // Return last `limit` lines from stdout (err lines appended at end)
    let out_lines: Vec<String> = {
        let stdout_lines: Vec<String> = lines
            .iter()
            .filter(|(idx, _)| *idx != u64::MAX)
            .map(|(_, l)| l.clone())
            .collect();
        let err_lines: Vec<String> = lines
            .iter()
            .filter(|(idx, _)| *idx == u64::MAX)
            .map(|(_, l)| l.clone())
            .collect();

        let start = if stdout_lines.len() > limit { stdout_lines.len() - limit } else { 0 };
        let mut result: Vec<String> = stdout_lines[start..].to_vec();
        result.extend(err_lines);
        result
    };

    // Fall back to in-memory buffer (populated on start_service)
    if out_lines.is_empty() {
        let key = make_key(&instance_id, &service);
        if let Ok(logs) = state.logs.lock() {
            if let Some(queue) = logs.get(&key) {
                let start = if queue.len() > limit { queue.len() - limit } else { 0 };
                return queue.iter().skip(start).cloned().collect();
            }
        }
    }

    out_lines
}