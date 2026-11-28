use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::State;

use crate::commands::instance::sanitize_workspaces;
use crate::models::ServiceRuntimeStatus;

const MAX_LOG_LINES: usize = 500;

// ─── Process state ──────────────────────────────────────────────────────────

#[derive(Default)]
pub struct ProcessState {
    pub logs: Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    pub children: Arc<Mutex<HashMap<String, Child>>>,
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

// ─── PM2 helpers ────────────────────────────────────────────────────────────

/// Locate the pm2 binary on the machine.
pub fn find_pm2() -> Option<PathBuf> {
    crate::system::ensure_system_path();
    let enriched_path = crate::system::get_enriched_path();

    // 1. Direct command in PATH (with enriched PATH passed to Command)
    let mut direct_cmd = Command::new("pm2");
    direct_cmd.arg("--version").env("PATH", &enriched_path);
    if let Ok(output) = direct_cmd.output() {
        if output.status.success() {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !ver.is_empty() {
                let mut which_cmd = Command::new("which");
                which_cmd.arg("pm2").env("PATH", &enriched_path);
                if let Ok(w_out) = which_cmd.output() {
                    let p = String::from_utf8_lossy(&w_out.stdout).trim().to_string();
                    if !p.is_empty() {
                        return Some(PathBuf::from(p));
                    }
                }
                return Some(PathBuf::from("pm2"));
            }
        }
    }

    // 2. Common fallback paths (macOS/Linux GUI apps often miss shell profile PATH)
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(h) = dirs_next::home_dir() {
        candidates.push(h.join(".bun").join("bin").join("pm2"));
        candidates.push(h.join(".npm-global").join("bin").join("pm2"));
        candidates.push(h.join(".yarn").join("bin").join("pm2"));
        candidates.push(h.join(".volta").join("bin").join("pm2"));
        candidates.push(h.join(".local").join("bin").join("pm2"));
        candidates.push(h.join(".local").join("share").join("fnm").join("current").join("bin").join("pm2"));

        // Scan NVM node versions: ~/.nvm/versions/node/*/bin/pm2
        let nvm_node_dir = h.join(".nvm").join("versions").join("node");
        if nvm_node_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_node_dir) {
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("bin").join("pm2"));
                }
            }
        }

        #[cfg(target_os = "windows")]
        candidates.push(h.join(".bun").join("bin").join("pm2.cmd"));
        #[cfg(target_os = "windows")]
        candidates.push(h.join("AppData").join("Roaming").join("npm").join("pm2.cmd"));
    }

    candidates.push(PathBuf::from("/opt/homebrew/bin/pm2"));
    candidates.push(PathBuf::from("/usr/local/bin/pm2"));
    candidates.push(PathBuf::from("/usr/bin/pm2"));

    for candidate in candidates {
        if candidate.exists() {
            // Test 1: Direct execution with enriched PATH (so #!/usr/bin/env node can resolve node)
            let mut cmd = Command::new(&candidate);
            cmd.arg("--version").env("PATH", &enriched_path);
            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !ver.is_empty() {
                        return Some(candidate);
                    }
                }
            }

            // Test 2: If node was not in PATH, try executing with bun if bun exists!
            if let Some((bun_path, _)) = crate::commands::instance::find_bun() {
                let mut bun_cmd = Command::new(&bun_path);
                bun_cmd.arg(&candidate).arg("--version").env("PATH", &enriched_path);
                if let Ok(output) = bun_cmd.output() {
                    if output.status.success() {
                        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !ver.is_empty() {
                            return Some(candidate);
                        }
                    }
                }
            }
        }
    }

    None
}

/// Create a Command for PM2 with a fully enriched PATH so PM2's daemon can invoke `bun`, `node`, etc.
fn pm2_command(pm2_path: &Path) -> Command {
    let mut cmd = Command::new(pm2_path);
    let enriched_path = crate::system::get_enriched_path();

    cmd.env("PATH", enriched_path);
    cmd.env("NODE_ENV", "production");
    cmd.env("LOCAL_PREVIEW", "true");

    if let Some(h) = dirs_next::home_dir() {
        cmd.env("HOME", &h);
        cmd.env("PM2_HOME", h.join(".pm2"));
    }

    cmd
}

/// Execute a PM2 command and capture output.
pub fn run_pm2(args: &[&str]) -> Result<String, String> {
    let pm2 = find_pm2().ok_or_else(|| {
        "PM2 is not installed or is not available. Install it using: bun add -g pm2".to_string()
    })?;

    let output = pm2_command(&pm2)
        .args(args)
        .output()
        .map_err(|error| {
            format!("Failed to execute PM2 ({}): {}", pm2.display(), error)
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        return Ok(stdout);
    }

    let message = format!("{}{}", stdout, stderr);
    if message.trim().is_empty() {
        Err(format!("PM2 exited with status {}", output.status))
    } else {
        Err(message)
    }
}

pub fn pm2_name(instance_id: &str, service: &str) -> String {
    let short: String = instance_id.chars().take(8).collect();
    format!("gb-{}-{}", short, service)
}

/// Check if a PM2 process is currently online.
pub fn is_pm2_online(name: &str, cwd: Option<&Path>) -> bool {
    if let Ok(json) = run_pm2(&["jlist"]) {
        if let Ok(processes) = serde_json::from_str::<serde_json::Value>(&json) {
            if let Some(arr) = processes.as_array() {
                for proc in arr {
                    let proc_name = proc["name"].as_str().unwrap_or("");
                    let proc_cwd = proc["pm2_env"]["cwd"].as_str().unwrap_or("");
                    let matches_name = proc_name == name;
                    let matches_cwd = if let Some(target_cwd) = cwd {
                        Path::new(proc_cwd) == target_cwd
                    } else {
                        false
                    };

                    if matches_name || matches_cwd {
                        let status = proc["pm2_env"]["status"].as_str().unwrap_or("");
                        return status == "online";
                    }
                }
            }
        }
    }
    false
}

pub fn get_service_script(service_dir: &Path, service: &str) -> &'static str {
    let pkg_file = service_dir.join("package.json");
    if let Ok(s) = std::fs::read_to_string(&pkg_file) {
        if s.contains("\"start:prod\"") {
            "start:prod"
        } else if s.contains("\"start\"") {
            "start"
        } else {
            if service == "backend" { "start:prod" } else { "start" }
        }
    } else {
        if service == "backend" { "start:prod" } else { "start" }
    }
}

/// Ensure required production secrets (AUTH_SECRET, CHAT_ENCRYPTION_KEY, STUDENT_CLAIM_CODE_PEPPER, DATA_ENCRYPTION_KEY)
/// are populated with valid 32-byte keys in backend/.env, preventing NestJS production boot crashes on any version.
pub fn ensure_backend_secrets(
    backend_dir: &Path,
    logs: Option<(&Arc<Mutex<HashMap<String, VecDeque<String>>>>, &str)>,
) {
    let env_path = backend_dir.join(".env");
    let mut lines = Vec::new();
    if env_path.exists() {
        if let Ok(content) = fs::read_to_string(&env_path) {
            lines = content.lines().map(|s| s.to_string()).collect();
        }
    }

    let required_secrets = [
        ("AUTH_SECRET", "Authentication session & JWT signing secret"),
        ("CHAT_ENCRYPTION_KEY", "AES-256-GCM chat message encryption at rest"),
        ("STUDENT_CLAIM_CODE_PEPPER", "Student join code keyed hash pepper"),
        ("DATA_ENCRYPTION_KEY", "Database sensitive field encryption key"),
    ];

    let mut modified = false;

    for (key, desc) in &required_secrets {
        let mut found_idx: Option<usize> = None;
        let mut is_empty = false;

        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                continue;
            }
            if let Some(pos) = trimmed.find('=') {
                let var_name = trimmed[..pos].trim();
                if var_name == *key {
                    found_idx = Some(i);
                    let mut val = trimmed[pos + 1..].trim();
                    if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\'')) {
                        if val.len() >= 2 {
                            val = &val[1..val.len() - 1];
                        }
                    }
                    if val.trim().is_empty() || (val.starts_with('<') && val.ends_with('>')) {
                        is_empty = true;
                    }
                    break;
                }
            }
        }

        if let Some(idx) = found_idx {
            if is_empty {
                let new_secret = crate::system::generate_secret_32();
                lines[idx] = format!("{}=\"{}\"", key, new_secret);
                modified = true;
                if let Some((l_arc, l_key)) = logs {
                    append_log_arc_pub(
                        l_arc,
                        l_key,
                        format!("[Config] Auto-generated required production secret for {} ({}).", key, desc),
                    );
                }
            }
        } else {
            // Append missing key
            let new_secret = crate::system::generate_secret_32();
            lines.push(format!("# {}", desc));
            lines.push(format!("{}=\"{}\"", key, new_secret));
            modified = true;
            if let Some((l_arc, l_key)) = logs {
                append_log_arc_pub(
                    l_arc,
                    l_key,
                    format!("[Config] Initialized missing required production secret for {} ({}).", key, desc),
                );
            }
        }
    }

    if modified {
        let _ = fs::write(&env_path, lines.join("\n") + "\n");
    }
}

pub fn spawn_or_replace_pm2_service(
    name: &str,
    service_dir: &Path,
    script_name: &str,
    bun_str: &str,
    logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    log_key: &str,
) -> Result<(), String> {
    if service_dir.ends_with("backend") || service_dir.join("src").join("main.ts").exists() {
        ensure_backend_secrets(service_dir, Some((logs, log_key)));
    }

    let jlist_out = run_pm2(&["jlist"]).unwrap_or_default();
    let already_registered = jlist_out.contains(&format!("\"name\":\"{}\"", name))
        || jlist_out.contains(&format!("\"name\": \"{}\"", name));

    if already_registered {
        append_log_arc_pub(
            logs,
            log_key,
            format!("[PM2] Replacing existing process '{}'...", name),
        );
        let _ = run_pm2(&["delete", name]);
    }

    let cwd_str = service_dir.to_string_lossy().to_string();
    append_log_arc_pub(
        logs,
        log_key,
        format!(
            "[PM2] Spawning process: pm2 start {} --name {} --cwd {} --update-env -- run {}",
            bun_str, name, cwd_str, script_name
        ),
    );

    let start_args = [
        "start",
        bun_str,
        "--name",
        name,
        "--cwd",
        &cwd_str,
        "--update-env",
        "--",
        "run",
        script_name,
    ];

    run_pm2(&start_args).map_err(|e| format!("PM2 start failed: {}", e))?;
    let _ = run_pm2(&["save", "--force"]);

    append_log_arc_pub(
        logs,
        log_key,
        format!("[PM2] ✓ '{}' started and online in PM2.", name),
    );

    Ok(())
}

// ─── Process/log helpers ────────────────────────────────────────────────────

fn reset_logs(
    logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    key: &str,
) {
    if let Ok(mut map) = logs.lock() {
        map.insert(key.to_string(), VecDeque::new());
    }
}

fn spawn_log_readers(
    stdout: Option<std::process::ChildStdout>,
    stderr: Option<std::process::ChildStderr>,
    logs: Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    key: String,
) -> (std::thread::JoinHandle<()>, std::thread::JoinHandle<()>) {
    let logs_out = Arc::clone(&logs);
    let key_out = key.clone();

    let stdout_thread = std::thread::spawn(move || {
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => append_log_arc_pub(&logs_out, &key_out, line),
                    Err(error) => {
                        append_log_arc_pub(
                            &logs_out,
                            &key_out,
                            format!("[log reader error] {}", error),
                        );
                        break;
                    }
                }
            }
        }
    });

    let logs_err = Arc::clone(&logs);
    let key_err = key;

    let stderr_thread = std::thread::spawn(move || {
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines() {
                match line {
                    Ok(line) => append_log_arc_pub(
                        &logs_err,
                        &key_err,
                        format!("[err] {}", line),
                    ),
                    Err(error) => {
                        append_log_arc_pub(
                            &logs_err,
                            &key_err,
                            format!("[stderr reader error] {}", error),
                        );
                        break;
                    }
                }
            }
        }
    });

    (stdout_thread, stderr_thread)
}

fn wait_for_command(
    mut command: Command,
    logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    key: &str,
    label: &str,
) -> Result<(), String> {
    append_log_arc_pub(logs, key, format!("> {}", label));

    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start {}: {}", label, error))?;

    let (stdout_thread, stderr_thread) = spawn_log_readers(
        child.stdout.take(),
        child.stderr.take(),
        Arc::clone(logs),
        key.to_string(),
    );

    let status = child
        .wait()
        .map_err(|error| format!("Failed waiting for {}: {}", label, error))?;

    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    if status.success() {
        append_log_arc_pub(logs, key, format!("✓ {} completed successfully.", label));
        Ok(())
    } else {
        let message = format!("✗ {} failed with exit status: {}", label, status);
        append_log_arc_pub(logs, key, message.clone());
        Err(message)
    }
}

/// Helper to safely run `bun install` in a directory.
/// If Prisma's postinstall script fails due to an incomplete or corrupted `src/generated/prisma` directory,
/// automatically clean the directory and re-run bun install.
pub fn run_bun_install(
    bun_cmd: &Path,
    dir: &Path,
    logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    log_key: &str,
    label: &str,
) -> Result<(), String> {
    let prisma_gen = dir.join("src").join("generated").join("prisma");
    if prisma_gen.exists() {
        let has_index = prisma_gen.join("index.d.ts").exists()
            || prisma_gen.join("index.js").exists()
            || prisma_gen.join("client.d.ts").exists()
            || prisma_gen.join("package.json").exists();
        if !has_index {
            append_log_arc_pub(
                logs,
                log_key,
                "[Install] Cleaning incomplete Prisma client directory before install...".into(),
            );
            let _ = fs::remove_dir_all(&prisma_gen);
        }
    }

    let mut command = Command::new(bun_cmd);
    command.arg("install").current_dir(dir);

    match wait_for_command(command, logs, log_key, label) {
        Ok(()) => Ok(()),
        Err(err) => {
            if prisma_gen.exists() {
                append_log_arc_pub(
                    logs,
                    log_key,
                    "[Install] Postinstall failed due to Prisma client collision. Cleaning stale generated directory and retrying...".into(),
                );
                let _ = fs::remove_dir_all(&prisma_gen);
                let mut retry_command = Command::new(bun_cmd);
                retry_command.arg("install").current_dir(dir);
                wait_for_command(retry_command, logs, log_key, &format!("{} (retry)", label))
            } else {
                Err(err)
            }
        }
    }
}

fn read_tail(path: &Path, limit: usize) -> Vec<String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };

    let mut lines = VecDeque::with_capacity(limit);
    for line in BufReader::new(file).lines() {
        match line {
            Ok(line) => {
                if lines.len() == limit {
                    lines.pop_front();
                }
                lines.push_back(line);
            }
            Err(_) => break,
        }
    }

    lines.into_iter().collect()
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn install_service_packages(
    state: State<'_, ProcessState>,
    instance_id: String,
    root_path: String,
    service: String,
) -> Result<String, String> {
    let logs = Arc::clone(&state.logs);

    tauri::async_runtime::spawn_blocking(move || {
        use crate::commands::instance::find_bun;

        let root = Path::new(&root_path);
        if !root.exists() {
            return Err("Target instance root does not exist".into());
        }

        let log_key = make_key(&instance_id, "install");
        reset_logs(&logs, &log_key);

        append_log_arc_pub(
            &logs,
            &log_key,
            format!(
                "[Gradebook Manager] Starting package installation ({}) in {:?}...",
                service, root
            ),
        );

        sanitize_workspaces(root);

        let (bun_cmd, _) = find_bun().ok_or_else(|| {
            "Bun is not installed or could not be found. Please install Bun first (https://bun.sh)"
                .to_string()
        })?;

        match service.as_str() {
            "backend" | "frontend" => {
                let service_dir = root.join(&service);
                if !service_dir.exists() {
                    return Err(format!("{} directory does not exist", service));
                }

                run_bun_install(
                    &bun_cmd,
                    &service_dir,
                    &logs,
                    &log_key,
                    &format!("bun install in {}/", service),
                )?;

                Ok(format!("{} packages installed successfully.", service))
            }
            "all" => {
                let mut summary = Vec::new();
                let mut had_error = false;

                for name in ["backend", "frontend"] {
                    let service_dir = root.join(name);
                    if service_dir.exists() {
                        match run_bun_install(
                            &bun_cmd,
                            &service_dir,
                            &logs,
                            &log_key,
                            &format!("bun install in {}/", name),
                        ) {
                            Ok(()) => summary.push(format!("{}: ✓", name)),
                            Err(error) => {
                                had_error = true;
                                summary.push(format!("{}: ✗ ({})", name, error));
                            }
                        }
                    }
                }

                match run_bun_install(&bun_cmd, root, &logs, &log_key, "bun install in root workspace") {
                    Ok(()) => summary.push("Root: ✓".to_string()),
                    Err(error) => {
                        had_error = true;
                        summary.push(format!("Root: ✗ ({})", error));
                    }
                }

                append_log_arc_pub(
                    &logs,
                    &log_key,
                    "[Gradebook Manager] Package installation complete.".into(),
                );

                let message = summary.join(" | ");
                if had_error {
                    Err(message)
                } else {
                    Ok(message)
                }
            }
            other => Err(format!("Unknown service: {}", other)),
        }
    })
    .await
    .map_err(|error| format!("Package installation task failed: {}", error))?
}

/// Build a service (bun run build) in production mode.
#[tauri::command]
pub async fn build_service(
    state: State<'_, ProcessState>,
    instance_id: String,
    root_path: String,
    service: String,
) -> Result<String, String> {
    let logs = Arc::clone(&state.logs);

    tauri::async_runtime::spawn_blocking(move || {
        use crate::commands::instance::find_bun;

        let root = Path::new(&root_path);
        if !root.exists() {
            return Err("Target instance root does not exist".into());
        }

        sanitize_workspaces(root);

        let (bun_cmd, _) = find_bun().ok_or_else(|| {
            "Bun is not installed or could not be found. Please install Bun first (https://bun.sh)"
                .to_string()
        })?;
        let bun_str = bun_cmd.to_string_lossy().to_string();

        match service.as_str() {
            "backend" | "frontend" => {
                let service_dir = root.join(&service);
                if !service_dir.exists() {
                    return Err(format!("{} directory does not exist", service));
                }

                let name = pm2_name(&instance_id, &service);
                let log_key = make_key(&instance_id, &service);
                reset_logs(&logs, &log_key);

                if service == "backend" {
                    ensure_backend_secrets(&service_dir, Some((&logs, &log_key)));
                }

                let is_running = is_pm2_online(&name, Some(&service_dir));

                if is_running {
                    append_log_arc_pub(
                        &logs,
                        &log_key,
                        format!(
                            "[Zero-Downtime] Service '{}' is currently running online. Keeping old process active while compiling new assets...",
                            name
                        ),
                    );
                } else {
                    append_log_arc_pub(
                        &logs,
                        &log_key,
                        format!(
                            "[Build] Starting production build for {} in {:?}...",
                            service, service_dir
                        ),
                    );
                }

                // 1. Install dependencies first so newly added or modified packages don't fail the build
                append_log_arc_pub(
                    &logs,
                    &log_key,
                    format!("[Install] Ensuring dependencies are up-to-date in {}/ (`bun install`)...", service),
                );

                if let Err(install_err) = run_bun_install(
                    &bun_cmd,
                    &service_dir,
                    &logs,
                    &log_key,
                    &format!("bun install in {}/", service),
                ) {
                    if is_running {
                        append_log_arc_pub(
                            &logs,
                            &log_key,
                            format!(
                                "[Safety] ⚠️ Package installation failed for '{}'. The running process was kept online without downtime.",
                                name
                            ),
                        );
                        return Err(format!("bun install failed: {}. Existing service kept running online.", install_err));
                    } else {
                        return Err(install_err);
                    }
                }
                append_log_arc_pub(&logs, &log_key, format!("[Install] ✓ Dependencies in {}/ are ready.", service));

                // 2. Compile production assets
                append_log_arc_pub(
                    &logs,
                    &log_key,
                    format!("[Build] Compiling production assets for {} (`bun run build`)...", service),
                );

                let mut command = Command::new(&bun_cmd);
                command
                    .arg("run")
                    .arg("build")
                    .current_dir(&service_dir)
                    .env("NODE_ENV", "production")
                    .env("LOCAL_PREVIEW", "true");

                match wait_for_command(
                    command,
                    &logs,
                    &log_key,
                    &format!("bun run build in {}/", service),
                ) {
                    Ok(()) => {
                        append_log_arc_pub(
                            &logs,
                            &log_key,
                            format!("[Build] ✓ {} production build completed successfully.", service),
                        );

                        if is_running {
                            let script_name = get_service_script(&service_dir, &service);
                            append_log_arc_pub(
                                &logs,
                                &log_key,
                                format!(
                                    "[Zero-Downtime] Replacing running process '{}' with newly built assets...",
                                    name
                                ),
                            );
                            spawn_or_replace_pm2_service(&name, &service_dir, script_name, &bun_str, &logs, &log_key)?;
                            Ok(format!("{} built and seamlessly reloaded in PM2 (zero downtime).", service))
                        } else {
                            Ok(format!("{} production build completed successfully.", service))
                        }
                    }
                    Err(err) => {
                        if is_running {
                            append_log_arc_pub(
                                &logs,
                                &log_key,
                                format!(
                                    "[Safety] ⚠️ Build failed. The existing PM2 service '{}' was kept running without downtime.",
                                    name
                                ),
                            );
                            Err(format!("Build failed: {}. Existing service kept running online.", err))
                        } else {
                            Err(err)
                        }
                    }
                }
            }
            "all" => {
                let mut summary = Vec::new();
                let mut had_error = false;

                for name_str in ["backend", "frontend"] {
                    let service_dir = root.join(name_str);
                    let target_log_key = make_key(&instance_id, name_str);
                    reset_logs(&logs, &target_log_key);

                    if service_dir.exists() {
                        if name_str == "backend" {
                            ensure_backend_secrets(&service_dir, Some((&logs, &target_log_key)));
                        }

                        let proc_name = pm2_name(&instance_id, name_str);
                        let is_running = is_pm2_online(&proc_name, Some(&service_dir));

                        if is_running {
                            append_log_arc_pub(
                                &logs,
                                &target_log_key,
                                format!(
                                    "[Zero-Downtime] Service '{}' is currently running online. Keeping old process active while compiling new assets...",
                                    proc_name
                                ),
                            );
                        } else {
                            append_log_arc_pub(
                                &logs,
                                &target_log_key,
                                format!(
                                    "[Build] Starting production build for {} in {:?}...",
                                    name_str, service_dir
                                ),
                            );
                        }

                        // Install dependencies first
                        if let Err(err) = run_bun_install(
                            &bun_cmd,
                            &service_dir,
                            &logs,
                            &target_log_key,
                            &format!("bun install in {}/", name_str),
                        ) {
                            had_error = true;
                            if is_running {
                                append_log_arc_pub(
                                    &logs,
                                    &target_log_key,
                                    format!(
                                        "[Safety] ⚠️ Package installation failed for '{}'. Running process kept online.",
                                        proc_name
                                    ),
                                );
                                summary.push(format!("{}: ✗ bun install failed (kept online)", name_str));
                            } else {
                                summary.push(format!("{}: ✗ bun install failed ({})", name_str, err));
                            }
                            continue;
                        }

                        let mut command = Command::new(&bun_cmd);
                        command
                            .arg("run")
                            .arg("build")
                            .current_dir(&service_dir)
                            .env("NODE_ENV", "production")
                            .env("LOCAL_PREVIEW", "true");

                        match wait_for_command(
                            command,
                            &logs,
                            &target_log_key,
                            &format!("bun run build in {}/", name_str),
                        ) {
                            Ok(()) => {
                                append_log_arc_pub(
                                    &logs,
                                    &target_log_key,
                                    format!("[Build] ✓ {} built successfully.", name_str),
                                );

                                if is_running {
                                    let script = get_service_script(&service_dir, name_str);
                                    let _ = spawn_or_replace_pm2_service(&proc_name, &service_dir, script, &bun_str, &logs, &target_log_key);
                                    summary.push(format!("{}: ✓ Built & Reloaded", name_str));
                                } else {
                                    summary.push(format!("{}: ✓ Built", name_str));
                                }
                            }
                            Err(error) => {
                                had_error = true;
                                if is_running {
                                    append_log_arc_pub(
                                        &logs,
                                        &target_log_key,
                                        format!(
                                            "[Safety] ⚠️ Build failed for '{}'. Running process kept online.",
                                            proc_name
                                        ),
                                    );
                                    summary.push(format!("{}: ✗ Build failed (service kept online)", name_str));
                                } else {
                                    summary.push(format!("{}: ✗ Build failed ({})", name_str, error));
                                }
                            }
                        }
                    }
                }

                let message = summary.join(" | ");
                if had_error {
                    Err(message)
                } else {
                    Ok(message)
                }
            }
            other => Err(format!("Unknown service: {}", other)),
        }
    })
    .await
    .map_err(|error| format!("Build task failed: {}", error))?
}

/// Start a service using PM2 as the process manager.
/// If the service is already running online and build_first is requested, the old process
/// is kept running online during the build and replaced only once the build succeeds.
#[tauri::command]
pub async fn start_service(
    state: State<'_, ProcessState>,
    instance_id: String,
    root_path: String,
    service: String,
    build_first: Option<bool>,
) -> Result<String, String> {
    let logs = Arc::clone(&state.logs);

    tauri::async_runtime::spawn_blocking(move || {
        use crate::commands::instance::find_bun;

        let root = Path::new(&root_path);
        if !root.exists() {
            return Err("Instance directory does not exist".into());
        }

        sanitize_workspaces(root);

        let (bun_cmd, _) = find_bun().ok_or_else(|| {
            "Bun is not installed or could not be found. Please install Bun first (https://bun.sh)"
                .to_string()
        })?;
        let bun_str = bun_cmd.to_string_lossy().to_string();

        let _ = find_pm2().ok_or_else(|| {
            "PM2 is not installed or could not be found. Please install it using: bun add -g pm2"
                .to_string()
        })?;

        let service_dir = match service.as_str() {
            "backend" => root.join("backend"),
            "frontend" => root.join("frontend"),
            _ => return Err(format!("Unknown service: {}", service)),
        };

        if !service_dir.exists() {
            return Err(format!("Service directory {:?} does not exist", service_dir));
        }

        let script_name = get_service_script(&service_dir, &service);
        let name = pm2_name(&instance_id, &service);
        let log_key = make_key(&instance_id, &service);

        reset_logs(&logs, &log_key);

        if service == "backend" {
            ensure_backend_secrets(&service_dir, Some((&logs, &log_key)));
        }

        let is_running = is_pm2_online(&name, Some(&service_dir));

        // Build first if requested by user, or automatically for frontend if .next is missing
        let do_build = build_first.unwrap_or(false)
            || (service == "frontend" && !service_dir.join(".next").exists());

        if do_build {
            if is_running {
                append_log_arc_pub(
                    &logs,
                    &log_key,
                    format!(
                        "[Zero-Downtime] Service '{}' is currently running online. Keeping existing process active while compiling new assets...",
                        name
                    ),
                );
            } else {
                append_log_arc_pub(
                    &logs,
                    &log_key,
                    format!(
                        "[Build] Preparing production build for {} in {:?}...",
                        service, service_dir
                    ),
                );
            }

            // 1. Install dependencies first so newly added or modified packages don't fail the build
            append_log_arc_pub(
                &logs,
                &log_key,
                format!("[Install] Ensuring dependencies are up-to-date in {}/ (`bun install`)...", service),
            );

            if let Err(install_err) = run_bun_install(
                &bun_cmd,
                &service_dir,
                &logs,
                &log_key,
                &format!("bun install in {}/", service),
            ) {
                if is_running {
                    append_log_arc_pub(
                        &logs,
                        &log_key,
                        format!(
                            "[Safety] ⚠️ Package installation failed for '{}'. The running process was kept online without downtime.",
                            name
                        ),
                    );
                    return Err(format!("bun install failed: {}. Existing service kept running online.", install_err));
                } else {
                    return Err(install_err);
                }
            }
            append_log_arc_pub(&logs, &log_key, format!("[Install] ✓ Dependencies in {}/ are ready.", service));

            // 2. Compile production assets
            append_log_arc_pub(
                &logs,
                &log_key,
                format!(
                    "[Build] Compiling production assets for {} (`bun run build`)...",
                    service
                ),
            );

            let mut build_cmd = Command::new(&bun_cmd);
            build_cmd
                .arg("run")
                .arg("build")
                .current_dir(&service_dir)
                .env("NODE_ENV", "production")
                .env("LOCAL_PREVIEW", "true");

            match wait_for_command(
                build_cmd,
                &logs,
                &log_key,
                &format!("bun run build in {}/", service),
            ) {
                Ok(()) => {
                    append_log_arc_pub(
                        &logs,
                        &log_key,
                        format!("[Build] ✓ {} production assets built successfully.", service),
                    );
                }
                Err(err) => {
                    if is_running {
                        append_log_arc_pub(
                            &logs,
                            &log_key,
                            format!(
                                "[Safety] ⚠️ Build failed. The existing PM2 service '{}' was kept running without downtime.",
                                name
                            ),
                        );
                        return Err(format!("Build failed: {}. Existing service kept running online without interruption.", err));
                    } else {
                        return Err(err);
                    }
                }
            }
        }

        if is_running {
            append_log_arc_pub(
                &logs,
                &log_key,
                format!(
                    "[Zero-Downtime] Replacing running process '{}' with updated build...",
                    name
                ),
            );
        } else {
            append_log_arc_pub(
                &logs,
                &log_key,
                format!(
                    "[PM2] Starting production service '{}' ({}) via `bun run {}` in {:?}...",
                    name, service, script_name, service_dir
                ),
            );
        }

        spawn_or_replace_pm2_service(&name, &service_dir, script_name, &bun_str, &logs, &log_key)?;

        Ok(format!("{} online via PM2 ({})", service, name))
    })
    .await
    .map_err(|error| format!("Service start task failed: {}", error))?
}

/// Stop a service via PM2.
#[tauri::command]
pub async fn stop_service(
    state: State<'_, ProcessState>,
    instance_id: String,
    service: String,
) -> Result<String, String> {
    let logs = Arc::clone(&state.logs);

    tauri::async_runtime::spawn_blocking(move || {
        let name = pm2_name(&instance_id, &service);
        let log_key = make_key(&instance_id, &service);

        append_log_arc_pub(&logs, &log_key, format!("[PM2] Stopping '{}'...", name));

        run_pm2(&["stop", &name])
            .map_err(|error| format!("PM2 stop failed: {}", error))?;

        let _ = run_pm2(&["save", "--force"]);

        append_log_arc_pub(&logs, &log_key, format!("[PM2] ✓ '{}' stopped.", name));
        Ok(format!("{} stopped via PM2", service))
    })
    .await
    .map_err(|error| format!("Service stop task failed: {}", error))?
}

/// Delete a service from PM2 completely.
#[tauri::command]
pub async fn delete_service(
    _state: State<'_, ProcessState>,
    instance_id: String,
    service: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = pm2_name(&instance_id, &service);
        let _ = run_pm2(&["delete", &name]);
        let _ = run_pm2(&["save", "--force"]);
        Ok(format!("{} process deleted from PM2", service))
    })
    .await
    .map_err(|error| format!("Service delete task failed: {}", error))?
}

/// Query PM2 for the runtime status of a service.
#[tauri::command]
pub async fn get_service_status(
    _state: State<'_, ProcessState>,
    instance_id: String,
    service: String,
    root_path: Option<String>,
) -> Result<ServiceRuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = pm2_name(&instance_id, &service);

        if let Ok(json) = run_pm2(&["jlist"]) {
            if let Ok(processes) = serde_json::from_str::<serde_json::Value>(&json) {
                if let Some(processes) = processes.as_array() {
                    for process in processes {
                        let proc_name = process["name"].as_str().unwrap_or("");
                        let proc_cwd = process["pm2_env"]["cwd"].as_str().unwrap_or("");

                        let matches_name = proc_name == name;
                        let matches_cwd = if let Some(ref rp) = root_path {
                            let expected_cwd = Path::new(rp).join(&service);
                            Path::new(proc_cwd) == expected_cwd
                        } else {
                            false
                        };

                        if matches_name || matches_cwd {
                            let status = process["pm2_env"]["status"]
                                .as_str()
                                .unwrap_or("stopped");
                            let running = status == "online";
                            let pid = if running {
                                process["pid"].as_u64().map(|value| value as u32)
                            } else {
                                None
                            };

                            return Ok(ServiceRuntimeStatus {
                                service,
                                running,
                                pid,
                                pm2_name: Some(proc_name.to_string()),
                                pm2_status: Some(status.to_string()),
                            });
                        }
                    }
                }
            }
        }

        Ok(ServiceRuntimeStatus {
            service,
            running: false,
            pid: None,
            pm2_name: Some(name),
            pm2_status: Some("not_registered".to_string()),
        })
    })
    .await
    .map_err(|error| format!("Service status task failed: {}", error))?
}

/// Fetch logs for a service from PM2's log files (or in-memory for install/upgrade).
#[tauri::command]
pub async fn get_service_logs(
    state: State<'_, ProcessState>,
    instance_id: String,
    service: String,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let logs = Arc::clone(&state.logs);

    tauri::async_runtime::spawn_blocking(move || {
        let limit = max_lines.unwrap_or(MAX_LOG_LINES);
        let key = make_key(&instance_id, &service);

        // In-memory logs are used for install/upgrade operations.
        if service == "install" || service == "upgrade" {
            if let Ok(map) = logs.lock() {
                if let Some(queue) = map.get(&key) {
                    let start = queue.len().saturating_sub(limit);
                    return Ok(queue.iter().skip(start).cloned().collect());
                }
            }
            return Ok(Vec::new());
        }

        // For backend/frontend, read from PM2's log files on disk.
        let name = pm2_name(&instance_id, &service);

        let pm2_home = std::env::var("PM2_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| dirs_next::home_dir().map(|home| home.join(".pm2")))
            .unwrap_or_else(|| PathBuf::from("/tmp/.pm2"));

        let out_path = pm2_home.join("logs").join(format!("{}-out.log", name));
        let err_path = pm2_home.join("logs").join(format!("{}-error.log", name));

        let mut output = Vec::new();

        // Any initial startup logs in memory
        if let Ok(map) = logs.lock() {
            if let Some(queue) = map.get(&key) {
                output.extend(queue.iter().cloned());
            }
        }

        let out_lines = read_tail(&out_path, limit);
        output.extend(out_lines);

        let err_lines = read_tail(&err_path, limit);
        output.extend(err_lines.into_iter().map(|line| format!("[err] {}", line)));

        if output.len() > limit {
            output.drain(..output.len() - limit);
        }

        Ok(output)
    })
    .await
    .map_err(|error| format!("Service logs task failed: {}", error))?
}

/// Clear logs for a service (in-memory buffer + PM2 log files on disk + `pm2 flush`).
#[tauri::command]
pub async fn clear_service_logs(
    state: State<'_, ProcessState>,
    instance_id: String,
    service: String,
) -> Result<(), String> {
    let logs = Arc::clone(&state.logs);

    tauri::async_runtime::spawn_blocking(move || {
        let key = make_key(&instance_id, &service);

        // 1. Clear in-memory queue
        if let Ok(mut map) = logs.lock() {
            map.remove(&key);
        }

        // 2. If it's a PM2 service (backend or frontend), truncate PM2 log files and run pm2 flush
        if service == "backend" || service == "frontend" {
            let name = pm2_name(&instance_id, &service);
            let _ = run_pm2(&["flush", &name]);

            let pm2_home = std::env::var("PM2_HOME")
                .ok()
                .map(PathBuf::from)
                .or_else(|| dirs_next::home_dir().map(|home| home.join(".pm2")))
                .unwrap_or_else(|| PathBuf::from("/tmp/.pm2"));

            let out_path = pm2_home.join("logs").join(format!("{}-out.log", name));
            let err_path = pm2_home.join("logs").join(format!("{}-error.log", name));

            let _ = std::fs::write(&out_path, "");
            let _ = std::fs::write(&err_path, "");
        }

        Ok(())
    })
    .await
    .map_err(|error| format!("Clear logs task failed: {}", error))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ensure_backend_secrets_populates_missing_keys() {
        let temp_dir = std::env::temp_dir().join(format!("gb_test_secrets_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let env_file = temp_dir.join(".env");
        let sample_env = "PORT=3001\nNODE_ENV=production\nAUTH_SECRET=\"\"\nCHAT_ENCRYPTION_KEY=\"\"\nSTUDENT_CLAIM_CODE_PEPPER=\"\"\n";
        fs::write(&env_file, sample_env).unwrap();

        ensure_backend_secrets(&temp_dir, None);

        let updated = fs::read_to_string(&env_file).unwrap();
        assert!(!updated.contains("AUTH_SECRET=\"\""));
        assert!(!updated.contains("CHAT_ENCRYPTION_KEY=\"\""));
        assert!(!updated.contains("STUDENT_CLAIM_CODE_PEPPER=\"\""));
        assert!(updated.contains("DATA_ENCRYPTION_KEY"));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
