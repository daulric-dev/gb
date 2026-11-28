use std::fs;
use std::io::Write;
use std::path::PathBuf;
use sha2::{Digest, Sha256};
use crate::models::{GitHubRelease, ReleaseAsset};

fn get_cache_dir() -> PathBuf {
    let mut dir = dirs_next::cache_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("gradebook-manager");
    dir.push("releases");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub async fn fetch_github_releases(owner: String, repo: String) -> Result<Vec<GitHubRelease>, String> {
    let effective_owner = if owner.is_empty() || owner == "daulric" {
        "daulric-dev"
    } else {
        owner.as_str()
    };
    let url = format!("https://api.github.com/repos/{}/{}/releases", effective_owner, repo);

    let client = reqwest::Client::builder()
        .user_agent("GradeBook-Desktop-Manager/1.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("GitHub API returned HTTP {}", res.status()));
    }

    let json: Vec<serde_json::Value> = res.json().await.map_err(|e| e.to_string())?;

    let mut releases = Vec::new();
    for r in json {
        let id = r.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        let tag_name = r.get("tag_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let name = r.get("name").and_then(|v| v.as_str()).unwrap_or(&tag_name).to_string();
        let published_at = r.get("published_at").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let body = r.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let prerelease = r.get("prerelease").and_then(|v| v.as_bool()).unwrap_or(false);

        let mut assets: Vec<ReleaseAsset> = Vec::new();
        if let Some(asset_list) = r.get("assets").and_then(|v| v.as_array()) {
            for a in asset_list {
                let aname = a.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let url = a.get("browser_download_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let size = a.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                assets.push(ReleaseAsset { name: aname, browser_download_url: url, size });
            }
        }

        releases.push(GitHubRelease { id, tag_name, name, published_at, body, prerelease, assets });
    }

    Ok(releases)
}

#[tauri::command]
pub async fn download_release_archive(url: String, dest_dir: String, filename: String) -> Result<String, String> {
    let dir = if dest_dir.is_empty() { get_cache_dir() } else { PathBuf::from(&dest_dir) };
    let _ = fs::create_dir_all(&dir);
    let dest_path = dir.join(&filename);

    let client = reqwest::Client::builder()
        .user_agent("GradeBook-Desktop-Manager/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Download failed with status: {}", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| format!("Failed to read archive bytes: {}", e))?;
    let mut file = fs::File::create(&dest_path)
        .map_err(|e| format!("Failed to create destination file: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("Failed to write archive: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn verify_release_checksum(file_path: String, expected_sha256: String) -> Result<bool, String> {
    let bytes = fs::read(&file_path)
        .map_err(|e| format!("Failed to read archive for checksum: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = hasher.finalize();
    let calculated = hex::encode(hash);
    let clean_expected = expected_sha256.trim().to_lowercase();
    Ok(clean_expected.contains(&calculated) || calculated == clean_expected)
}
