use std::path::PathBuf;
use std::process::Command;

/// Return a comprehensive, enriched PATH string that works in macOS GUI apps (which miss interactive shell PATH).
pub fn get_enriched_path() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // 1. On Unix, query the user's interactive login shell for their complete PATH
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = Command::new(&shell).args(["-l", "-c", "echo -n \"$PATH\""]).output() {
            if output.status.success() {
                let shell_path = String::from_utf8_lossy(&output.stdout);
                for p in shell_path.split(':') {
                    let pb = PathBuf::from(p.trim());
                    if !pb.as_os_str().is_empty() && pb.exists() && !dirs.contains(&pb) {
                        dirs.push(pb);
                    }
                }
            }
        }
    }

    // 2. Add common user tool directories (NVM, FNM, Bun, Volta, Asdf, Homebrew, Cargo, etc.)
    if let Some(home) = dirs_next::home_dir() {
        let candidates = [
            home.join(".bun").join("bin"),
            home.join(".local").join("bin"),
            home.join(".cargo").join("bin"),
            home.join(".npm-global").join("bin"),
            home.join(".yarn").join("bin"),
            home.join(".volta").join("bin"),
            home.join(".asdf").join("shims"),
            home.join(".asdf").join("bin"),
            home.join(".local").join("share").join("fnm").join("current").join("bin"),
            home.join("Library").join("Application Support").join("fnm").join("current").join("bin"),
        ];
        for c in candidates {
            if c.exists() && !dirs.contains(&c) {
                dirs.push(c);
            }
        }

        // Scan NVM node versions: ~/.nvm/versions/node/*/bin
        let nvm_node_dir = home.join(".nvm").join("versions").join("node");
        if nvm_node_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_node_dir) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.exists() && !dirs.contains(&bin) {
                        dirs.push(bin);
                    }
                }
            }
        }
    }

    // 3. System directories
    let sys_dirs = [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/local/sbin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/usr/sbin"),
        PathBuf::from("/sbin"),
    ];
    for s in sys_dirs {
        if s.exists() && !dirs.contains(&s) {
            dirs.push(s);
        }
    }

    // 4. Current PATH
    if let Ok(curr) = std::env::var("PATH") {
        #[cfg(target_os = "windows")]
        let sep = ';';
        #[cfg(not(target_os = "windows"))]
        let sep = ':';

        for p in curr.split(sep) {
            let pb = PathBuf::from(p.trim());
            if !pb.as_os_str().is_empty() && pb.exists() && !dirs.contains(&pb) {
                dirs.push(pb);
            }
        }
    }

    #[cfg(target_os = "windows")]
    let join_sep = ";";
    #[cfg(not(target_os = "windows"))]
    let join_sep = ":";

    dirs.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(join_sep)
}

/// Ensure that the running process's environment has the enriched PATH.
pub fn ensure_system_path() {
    let enriched = get_enriched_path();
    if !enriched.is_empty() {
        std::env::set_var("PATH", &enriched);
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        result.push(CHARS[(b0 >> 2) as usize] as char);
        result.push(CHARS[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[(((b1 & 15) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(b2 & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Generate a cryptographically secure 32-byte base64-encoded string.
pub fn generate_secret_32() -> String {
    #[cfg(unix)]
    {
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            use std::io::Read;
            let mut buf = [0u8; 32];
            if f.read_exact(&mut buf).is_ok() {
                return base64_encode(&buf);
            }
        }
    }
    use sha2::{Digest, Sha256};
    let seed = format!("{}-{}-gradebook-secret-salt", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0), std::process::id());
    let hash = Sha256::digest(seed.as_bytes());
    base64_encode(&hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enriched_path_resolves_pm2_under_minimal_path() {
        // Simulate a production macOS GUI app launched by Finder/Dock where PATH is minimal
        std::env::set_var("PATH", "/usr/bin:/bin");

        let enriched = get_enriched_path();
        assert!(!enriched.is_empty());
        assert!(enriched.contains(".bun/bin") || enriched.contains("node") || enriched.contains("homebrew"));

        // Verify that with enriched PATH, pm2 is found
        let pm2_opt = crate::commands::service::find_pm2();
        assert!(pm2_opt.is_some(), "PM2 should be detected even when initial PATH is minimal /usr/bin:/bin");
        println!("Detected PM2: {:?}", pm2_opt);

        let bun_opt = crate::commands::instance::find_bun();
        assert!(bun_opt.is_some(), "Bun should be detected even when initial PATH is minimal /usr/bin:/bin");
        println!("Detected Bun: {:?}", bun_opt);
    }
}
