use std::process::Command;
use crate::models::RemoteConfig;

#[tauri::command]
pub fn test_ssh_connection(config: RemoteConfig) -> Result<String, String> {
    let port_str = config.port.to_string();
    let dest = format!("{}@{}", config.username, config.host);

    let output = Command::new("ssh")
        .args([
            "-p",
            &port_str,
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=5",
            "-o",
            "StrictHostKeyChecking=accept-new",
            &dest,
            "echo connected",
        ])
        .output()
        .map_err(|e| format!("Failed to execute ssh: {}", e))?;

    if output.status.success() {
        Ok(format!("Successfully connected to {} via SSH", dest))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(if err.trim().is_empty() {
            "SSH connection failed (timeout or unauthorized)".into()
        } else {
            err.to_string()
        })
    }
}

#[tauri::command]
pub fn execute_remote_command(config: RemoteConfig, command: String) -> Result<String, String> {
    let port_str = config.port.to_string();
    let dest = format!("{}@{}", config.username, config.host);

    let output = Command::new("ssh")
        .args([
            "-p",
            &port_str,
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            &dest,
            &command,
        ])
        .output()
        .map_err(|e| format!("Failed to execute remote command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("Command failed with exit code {:?}: {}\n{}", output.status.code(), stdout, stderr))
    }
}
