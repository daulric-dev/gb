import { invoke } from "@tauri-apps/api/core";
import type {
  InstanceConfig,
  InstanceHealth,
  InstanceScanResult,
  ServiceRuntimeStatus,
  SystemEnvironment,
} from "@/types/instance";
import type { ServiceEnv } from "@/types/env";
import type { GitHubRelease } from "@/types/releases";

// ── Instance commands ──────────────────────────────────────────────────────
export const scanInstanceDirectory = (path: string): Promise<InstanceScanResult> =>
  invoke("scan_instance_directory", { path });

export const saveInstanceConfig = (config: InstanceConfig): Promise<void> =>
  invoke("save_instance_config", { config });

export const removeRegisteredInstance = (instanceId: string): Promise<void> =>
  invoke("remove_registered_instance", { instanceId });

export const loadRegisteredInstances = (): Promise<InstanceConfig[]> =>
  invoke("load_registered_instances");

export const checkInstanceOnline = (url: string): Promise<boolean> =>
  invoke("check_instance_online", { url });

export const checkSystemEnvironment = (): Promise<SystemEnvironment> =>
  invoke("check_system_environment");

export const checkInstanceHealth = (
  rootPath: string,
  url: string
): Promise<InstanceHealth> =>
  invoke("check_instance_health", { rootPath, url });

export const installInstancePackages = (rootPath: string): Promise<string> =>
  invoke("install_instance_packages", { rootPath });

// ── Service Execution & Package Management ─────────────────────────────────
export const installServicePackages = (
  instanceId: string,
  rootPath: string,
  service: "backend" | "frontend" | "all"
): Promise<string> => invoke("install_service_packages", { instanceId, rootPath, service });

export const startService = (
  instanceId: string,
  rootPath: string,
  service: "backend" | "frontend"
): Promise<string> => invoke("start_service", { instanceId, rootPath, service });

export const stopService = (
  instanceId: string,
  service: "backend" | "frontend"
): Promise<string> => invoke("stop_service", { instanceId, service });

export const deleteService = (
  instanceId: string,
  service: "backend" | "frontend"
): Promise<string> => invoke("delete_service", { instanceId, service });

export const getServiceStatus = (
  instanceId: string,
  service: "backend" | "frontend"
): Promise<ServiceRuntimeStatus> =>
  invoke("get_service_status", { instanceId, service });

export const getServiceLogs = (
  instanceId: string,
  service: "backend" | "frontend" | "install" | "upgrade" | string,
  maxLines?: number
): Promise<string[]> =>
  invoke("get_service_logs", { instanceId, service, maxLines });

// ── Env commands ───────────────────────────────────────────────────────────
export const readServiceEnvs = (instanceRoot: string): Promise<ServiceEnv[]> =>
  invoke("read_service_envs", { instanceRoot });

export const saveServiceEnvs = (instanceRoot: string, services: ServiceEnv[]): Promise<void> =>
  invoke("save_service_envs", { instanceRoot, services });

// ── Releases commands ──────────────────────────────────────────────────────
export const fetchGithubReleases = (owner: string, repo: string): Promise<GitHubRelease[]> =>
  invoke("fetch_github_releases", { owner, repo });

export const downloadReleaseArchive = (
  url: string,
  destDir: string,
  filename: string
): Promise<string> => invoke("download_release_archive", { url, destDir, filename });

export const verifyReleaseChecksum = (
  filePath: string,
  expectedSha256: string
): Promise<boolean> => invoke("verify_release_checksum", { filePath, expectedSha256 });

// ── Upgrade commands ───────────────────────────────────────────────────────
export const extractAndUpgradeInstance = (
  instanceId: string,
  instanceRoot: string,
  zipPath: string
): Promise<string> => invoke("extract_and_upgrade_instance", { instanceId, instanceRoot, zipPath });

// ── SSH commands ───────────────────────────────────────────────────────────
export const testSshConnection = (
  host: string,
  port: number,
  user: string,
  password?: string
): Promise<boolean> => invoke("test_ssh_connection", { host, port, user, password });

export const executeRemoteCommand = (
  host: string,
  port: number,
  user: string,
  command: string,
  password?: string
): Promise<string> => invoke("execute_remote_command", { host, port, user, command, password });
