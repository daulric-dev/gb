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

fn is_valid_env_key(k: &str) -> bool {
    !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
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
            // Check if this commented line is a template variable like "# API_URL=http://localhost:3001"
            let comment_body = trimmed.trim_start_matches('#').trim();
            if let Some((k, v)) = comment_body.split_once('=') {
                let key = k.trim();
                if is_valid_env_key(key) && !vars.iter().any(|existing: &EnvVariable| existing.key == key) {
                    let mut val = v.trim().to_string();
                    if (val.starts_with('"') && val.ends_with('"'))
                        || (val.starts_with('\'') && val.ends_with('\''))
                    {
                        if val.len() >= 2 {
                            val = val[1..val.len() - 1].to_string();
                        }
                    }
                    vars.push(EnvVariable {
                        is_secret: is_secret_key(key),
                        comment: pending_comment.take(),
                        key: key.to_string(),
                        value: val,
                    });
                    continue;
                }
            }
            pending_comment = Some(trimmed.trim_start_matches('#').trim().to_string());
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
            if let Some(pos) = vars.iter().position(|existing: &EnvVariable| existing.key == key) {
                vars[pos] = EnvVariable {
                    key,
                    value: val,
                    is_secret: is_secret_key(&vars[pos].key),
                    comment: pending_comment.take().or_else(|| vars[pos].comment.clone()),
                };
            } else {
                vars.push(EnvVariable {
                    is_secret: is_secret_key(&key),
                    comment: pending_comment.take(),
                    key,
                    value: val,
                });
            }
        }
    }
    vars
}

fn merge_env_variables(template_vars: Vec<EnvVariable>, actual_vars: Vec<EnvVariable>) -> Vec<EnvVariable> {
    let mut merged = template_vars;
    for actual in actual_vars {
        if let Some(pos) = merged.iter().position(|m| m.key == actual.key) {
            merged[pos].value = actual.value;
            if actual.comment.is_some() {
                merged[pos].comment = actual.comment;
            }
        } else {
            merged.push(actual);
        }
    }
    merged
}

fn default_backend_template() -> Vec<EnvVariable> {
    vec![
        EnvVariable {
            key: "PORT".into(),
            value: "3001".into(),
            is_secret: false,
            comment: Some("Backend HTTP server port".into()),
        },
        EnvVariable {
            key: "FRONTEND_URL".into(),
            value: "http://localhost:3000".into(),
            is_secret: false,
            comment: Some("Allowed CORS origin and cookie domain".into()),
        },
        EnvVariable {
            key: "API_URL".into(),
            value: "http://localhost:3001".into(),
            is_secret: false,
            comment: Some("Absolute public URL of this API".into()),
        },
        EnvVariable {
            key: "AUTH_SECRET".into(),
            value: "".into(),
            is_secret: true,
            comment: Some("32+ characters: openssl rand -base64 32".into()),
        },
        EnvVariable {
            key: "NODE_ENV".into(),
            value: "development".into(),
            is_secret: false,
            comment: Some("development or production".into()),
        },
        EnvVariable {
            key: "DATABASE_URL".into(),
            value: "file:./prisma/dev.db".into(),
            is_secret: true,
            comment: Some("Database connection string (SQLite file or PostgreSQL URL)".into()),
        },
        EnvVariable {
            key: "DATABASE_PORTABILITY".into(),
            value: "sqlite".into(),
            is_secret: false,
            comment: Some("Database driver: sqlite or postgres".into()),
        },
        EnvVariable {
            key: "S3_ENDPOINT".into(),
            value: "".into(),
            is_secret: false,
            comment: Some("S3 or Cloudflare R2 object storage endpoint".into()),
        },
        EnvVariable {
            key: "S3_BUCKET".into(),
            value: "".into(),
            is_secret: false,
            comment: Some("Object storage bucket name".into()),
        },
        EnvVariable {
            key: "S3_ACCESS_KEY_ID".into(),
            value: "".into(),
            is_secret: true,
            comment: Some("S3 access key ID".into()),
        },
        EnvVariable {
            key: "S3_SECRET_ACCESS_KEY".into(),
            value: "".into(),
            is_secret: true,
            comment: Some("S3 secret access key".into()),
        },
        EnvVariable {
            key: "SMTP_HOST".into(),
            value: "".into(),
            is_secret: false,
            comment: Some("Outgoing SMTP email host".into()),
        },
        EnvVariable {
            key: "SMTP_PORT".into(),
            value: "587".into(),
            is_secret: false,
            comment: Some("Outgoing SMTP port (587 for TLS, 465 for SSL)".into()),
        },
        EnvVariable {
            key: "SMTP_USER".into(),
            value: "".into(),
            is_secret: false,
            comment: Some("SMTP username".into()),
        },
        EnvVariable {
            key: "SMTP_PASS".into(),
            value: "".into(),
            is_secret: true,
            comment: Some("SMTP password or app password".into()),
        },
        EnvVariable {
            key: "SMTP_FROM".into(),
            value: "".into(),
            is_secret: false,
            comment: Some("From address: e.g. Gradebook <noreply@example.com>".into()),
        },
        EnvVariable {
            key: "OPENAI_API_KEY".into(),
            value: "".into(),
            is_secret: true,
            comment: Some("OpenAI API key for AI assistant features".into()),
        },
    ]
}

fn default_frontend_template() -> Vec<EnvVariable> {
    vec![
        EnvVariable {
            key: "NEXT_PUBLIC_API_URL".into(),
            value: "http://localhost:3001".into(),
            is_secret: false,
            comment: Some("Backend API URL (no /api suffix - lib/api.ts adds it)".into()),
        },
        EnvVariable {
            key: "NEXT_PUBLIC_STORAGE_URL".into(),
            value: "http://127.0.0.1:8333".into(),
            is_secret: false,
            comment: Some("Object storage origin that browsers upload to with presigned URLs".into()),
        },
        EnvVariable {
            key: "NEXT_PUBLIC_IMAGES_URL".into(),
            value: "https://images.example.com".into(),
            is_secret: false,
            comment: Some("Optional public image CDN origin for avatar URLs".into()),
        },
    ]
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

    // 1. Backend env: check .env.example template first, then merge existing .env
    let backend_example_path = root.join("backend").join(".env.example");
    let root_example_path = root.join(".env.example");
    let chosen_backend_example = if backend_example_path.exists() {
        Some(backend_example_path)
    } else if root_example_path.exists() {
        Some(root_example_path)
    } else {
        None
    };

    let backend_env_path = root.join("backend").join(".env");
    let root_env_path = root.join(".env");
    let chosen_backend_actual = if backend_env_path.exists() {
        backend_env_path
    } else {
        root_env_path
    };

    let backend_template = if let Some(ref p) = chosen_backend_example {
        let raw = fs::read_to_string(p).unwrap_or_default();
        parse_env_lines(&raw)
    } else {
        default_backend_template()
    };

    let backend_actual = if chosen_backend_actual.exists() {
        let raw = fs::read_to_string(&chosen_backend_actual).unwrap_or_default();
        parse_env_lines(&raw)
    } else {
        Vec::new()
    };

    let backend_vars = merge_env_variables(backend_template, backend_actual);

    result.push(ServiceEnv {
        service: "backend".into(),
        service_id: "backend".into(),
        path: chosen_backend_actual.to_string_lossy().to_string(),
        variables: backend_vars,
    });

    // 2. Frontend env: check frontend/.env.example template first, then merge existing .env.local
    let frontend_example_path = root.join("frontend").join(".env.example");
    let frontend_local_path = root.join("frontend").join(".env.local");
    let frontend_env_path = root.join("frontend").join(".env");
    let chosen_frontend_actual = if frontend_local_path.exists() {
        frontend_local_path
    } else {
        frontend_env_path
    };

    let frontend_template = if frontend_example_path.exists() {
        let raw = fs::read_to_string(&frontend_example_path).unwrap_or_default();
        parse_env_lines(&raw)
    } else {
        default_frontend_template()
    };

    let frontend_actual = if chosen_frontend_actual.exists() {
        let raw = fs::read_to_string(&chosen_frontend_actual).unwrap_or_default();
        parse_env_lines(&raw)
    } else {
        Vec::new()
    };

    let frontend_vars = merge_env_variables(frontend_template, frontend_actual);

    result.push(ServiceEnv {
        service: "frontend".into(),
        service_id: "frontend".into(),
        path: chosen_frontend_actual.to_string_lossy().to_string(),
        variables: frontend_vars,
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
