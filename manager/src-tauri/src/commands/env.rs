use std::fs;
use std::path::Path;
use crate::models::{EnvVariable, ServiceEnv};

const SECRET_KEYWORDS: &[&str] = &[
    "secret", "key", "token", "password", "passwd", "pwd", "auth", "jwt",
    "private", "credential", "api_key", "access_key",
];

fn is_secret_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    SECRET_KEYWORDS.iter().any(|kw| lower.contains(kw))
}

fn parse_env_lines(content: &str) -> Vec<EnvVariable> {
    let mut vars = Vec::new();
    let mut pending_comment: Option<String> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            pending_comment = None;
            continue;
        }
        if trimmed.starts_with('#') {
            pending_comment = Some(trimmed[1..].trim().to_string());
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_string();
            let mut val = v.trim().to_string();
            if (val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\''))
            {
                if val.len() >= 2 {
                    val = val[1..val.len() - 1].to_string();
                }
            }
            vars.push(EnvVariable {
                is_secret: is_secret_key(&key),
                comment: pending_comment.take(),
                key,
                value: val,
            });
        }
    }
    vars
}

fn serialize_env_vars(vars: &[EnvVariable]) -> String {
    let mut lines = Vec::new();
    for var in vars {
        if let Some(comment) = &var.comment {
            lines.push(format!("# {}", comment));
        }
        let val = &var.value;
        let needs_quotes = val.contains(' ') || val.contains('#') || val.is_empty();
        if needs_quotes {
            lines.push(format!("{}=\"{}\"", var.key, val));
        } else {
            lines.push(format!("{}={}", var.key, val));
        }
    }
    lines.join("\n")
}

#[tauri::command]
pub fn read_service_envs(instance_root: String) -> Result<Vec<ServiceEnv>, String> {
    let root = Path::new(&instance_root);
    if !root.exists() {
        return Err("Root path does not exist".into());
    }

    let mut result = Vec::new();

    // Backend env
    let backend_env_path = root.join("backend").join(".env");
    let root_env_path = root.join(".env");
    let chosen_backend = if backend_env_path.exists() { backend_env_path } else { root_env_path };
    let backend_raw = fs::read_to_string(&chosen_backend).unwrap_or_default();
    result.push(ServiceEnv {
        service: "backend".into(),
        service_id: "backend".into(),
        path: chosen_backend.to_string_lossy().to_string(),
        variables: parse_env_lines(&backend_raw),
    });

    // Frontend env
    let frontend_local = root.join("frontend").join(".env.local");
    let frontend_env = root.join("frontend").join(".env");
    let chosen_frontend = if frontend_local.exists() { frontend_local } else { frontend_env };
    let frontend_raw = fs::read_to_string(&chosen_frontend).unwrap_or_default();
    result.push(ServiceEnv {
        service: "frontend".into(),
        service_id: "frontend".into(),
        path: chosen_frontend.to_string_lossy().to_string(),
        variables: parse_env_lines(&frontend_raw),
    });

    Ok(result)
}

#[tauri::command]
pub fn save_service_envs(instance_root: String, services: Vec<ServiceEnv>) -> Result<(), String> {
    let root = Path::new(&instance_root);
    for svc in &services {
        let path = if svc.service == "backend" {
            root.join("backend").join(".env")
        } else {
            root.join("frontend").join(".env.local")
        };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let content = serialize_env_vars(&svc.variables);
        fs::write(&path, content)
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    }
    Ok(())
}
