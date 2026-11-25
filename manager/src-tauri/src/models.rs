use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub mode: String, // "local" or "ssh"
    pub root_path: String,
    #[serde(default = "default_backend_url")]
    pub backend_url: String,
    #[serde(default = "default_frontend_url")]
    pub frontend_url: String,
    pub remote: Option<RemoteConfig>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_backend_url() -> String { "http://localhost:3001".into() }
fn default_frontend_url() -> String { "http://localhost:3000".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstancePaths {
    pub backend: String,
    pub frontend: String,
    pub storage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceRuntime {
    pub backend_port: u16,
    pub frontend_port: u16,
    pub bun_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceScanResult {
    pub valid: bool,
    pub version: Option<String>,
    pub has_backend: bool,
    pub has_frontend: bool,
    pub has_instance_file: bool,
    pub has_node_modules: bool,
    pub has_bun: bool,
    pub bun_version: Option<String>,
    pub existing_config: Option<InstanceConfig>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemEnvironment {
    pub has_bun: bool,
    pub bun_version: Option<String>,
    pub bun_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceHealth {
    pub has_node_modules: bool,
    pub has_bun: bool,
    pub bun_version: Option<String>,
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
    pub is_secret: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceEnv {
    pub service: String,
    pub service_id: String,
    pub path: String,
    pub variables: Vec<EnvVariable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceRuntimeStatus {
    pub service: String,
    pub running: bool,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub id: u64,
    pub tag_name: String,
    pub name: String,
    pub published_at: String,
    pub body: String,
    pub prerelease: bool,
    pub assets: Vec<ReleaseAsset>,
}
