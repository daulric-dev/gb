export type InstanceMode = "local" | "ssh";

export interface InstanceConfig {
  id: string;
  name: string;
  version: string;
  mode?: InstanceMode;
  root_path: string;
  backend_url: string;
  frontend_url: string;
  remote?: {
    host: string;
    port: number;
    username: string;
    auth_method: "key" | "password" | "agent";
  } | null;
  status?: "running" | "stopped" | "checking" | "unknown";
  created_at: string;
  updated_at: string;
}

export interface InstanceScanResult {
  valid: boolean;
  version?: string;
  has_backend: boolean;
  has_frontend: boolean;
  has_instance_file: boolean;
  has_node_modules: boolean;
  has_bun: boolean;
  bun_version?: string | null;
  existing_config?: InstanceConfig | null;
  error?: string;
}

export interface SystemEnvironment {
  has_bun: boolean;
  bun_version?: string | null;
  bun_path?: string | null;
}

export interface InstanceHealth {
  has_node_modules: boolean;
  has_bun: boolean;
  bun_version?: string | null;
  is_online: boolean;
}

export interface ServiceRuntimeStatus {
  service: string;
  running: boolean;
  pid?: number | null;
}
