/**
 * InstancesContext — Preact signals-based store for all instance state.
 *
 * WHY signals:
 *   - Signals are reactive values that live outside the React render cycle.
 *   - A component only re-renders when the specific signal it reads (.value) changes.
 *   - The 2500ms polling loop previously triggered state updates → full re-renders
 *     of InstancesView + EnvStudioView + ReleasesView on every tick.
 *   - With signals: a tick where PM2 status hasn't changed writes the same value
 *     → no subscriber re-renders at all.
 *
 * USAGE:
 *   import { useInstances } from "@/hooks/useInstances";
 *   const { instances, serviceStatuses, ... } = useInstances();
 *   // read .value inside JSX — the transform plugin handles subscription automatically
 */

import React, { createContext, useContext, useEffect, useRef, useCallback } from "react";
import { signal, computed, batch } from "@preact/signals-react";
// useSignals manually activates signal tracking in the calling component,
// so we don't have to rely solely on the Babel transform for subscription wiring.
import { useSignals } from "@preact/signals-react/runtime";
import { listen } from "@tauri-apps/api/event";
import {
  loadRegisteredInstances,
  saveInstanceConfig,
  scanInstanceDirectory,
  checkSystemEnvironment,
  checkInstanceHealth,
  installServicePackages,
  removeRegisteredInstance,
  startService,
  stopService,
  deleteService,
  buildService,
  getServiceStatus,
  getServiceLogs,
  clearServiceLogs,
  fetchGithubReleases,
  downloadReleaseArchive,
  extractAndUpgradeInstance,
} from "./useIpc";
import type {
  InstanceConfig,
  InstanceScanResult,
  ServiceRuntimeStatus,
  SystemEnvironment,
} from "@/types/instance";
import type { GitHubRelease } from "@/types/releases";

// ── Shared types ───────────────────────────────────────────────────────────────

export interface InstanceWithStatus extends InstanceConfig {
  online?: boolean | null;
  root_exists?: boolean | null;
  has_backend?: boolean | null;
  has_frontend?: boolean | null;
  has_node_modules?: boolean | null;
  has_bun?: boolean | null;
  bun_version?: string | null;
}

export interface UpgradeProgressInfo {
  instance_id: string;
  step: number;
  total_steps: number;
  stage:
    | "downloading"
    | "backup"
    | "extracting"
    | "updating_config"
    | "migrating"
    | "reloading"
    | "complete"
    | "error";
  title: string;
  detail: string;
  percent: number;
  target_version?: string;
}

// ── Module-level signals (single global store) ─────────────────────────────────

export const instancesSignal = signal<InstanceWithStatus[]>([]);
export const systemEnvSignal = signal<SystemEnvironment | null>(null);
export const serviceStatusesSignal = signal<
  Record<string, { backend: ServiceRuntimeStatus; frontend: ServiceRuntimeStatus }>
>({});
export const latestReleaseSignal = signal<GitHubRelease | null>(null);
export const latestVersionSignal = signal<string | null>(null);
export const loadingSignal = signal<boolean>(true);
export const installingForSignal = signal<string | null>(null);
export const buildingForSignal = signal<string | null>(null);
export const upgradingForSignal = signal<string | null>(null);
export const upgradeProgressSignal = signal<Record<string, UpgradeProgressInfo>>({});
export const errorSignal = signal<string | null>(null);

// ── Helpers ────────────────────────────────────────────────────────────────────

export function cleanVersion(v?: string | null): string {
  if (!v) return "0.0.0";
  return v.trim().replace(/^v/i, "");
}

export function compareSemver(v1: string, v2: string): number {
  const parts1 = cleanVersion(v1).split(".").map((n) => parseInt(n, 10) || 0);
  const parts2 = cleanVersion(v2).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

// ── Core async actions (plain functions, signals as side effects) ───────────────

async function _refreshSystem() {
  try {
    const env = await checkSystemEnvironment();
    systemEnvSignal.value = env;
  } catch (e) {
    console.error("Failed to check system environment:", e);
  }
}

async function _refreshReleases() {
  try {
    const releases = await fetchGithubReleases("daulric-dev", "gb");
    if (releases?.length > 0) {
      batch(() => {
        latestReleaseSignal.value = releases[0];
        latestVersionSignal.value = cleanVersion(releases[0].tag_name);
      });
    }
  } catch (e) {
    console.warn("Could not fetch GitHub releases:", e);
  }
}

/**
 * refreshStatuses — polls PM2 for each instance.
 * Guards: only writes to signals when values actually changed,
 * so components reading those signals don't re-render on a no-op poll.
 */
export async function refreshStatuses(instList: InstanceConfig[]) {
  for (const inst of instList) {
    try {
      const [backendStatus, frontendStatus] = await Promise.all([
        getServiceStatus(inst.id, "backend", inst.root_path),
        getServiceStatus(inst.id, "frontend", inst.root_path),
      ]);

      // Guard: only update if running/pid changed
      const prev = serviceStatusesSignal.peek()[inst.id];
      const changed =
        !prev ||
        prev.backend.running !== backendStatus.running ||
        prev.backend.pid !== backendStatus.pid ||
        prev.frontend.running !== frontendStatus.running ||
        prev.frontend.pid !== frontendStatus.pid;

      if (changed) {
        serviceStatusesSignal.value = {
          ...serviceStatusesSignal.peek(),
          [inst.id]: { backend: backendStatus, frontend: frontendStatus },
        };
      }

      if (backendStatus.running || frontendStatus.running) {
        const url = inst.backend_url || "http://localhost:3001";
        checkInstanceHealth(inst.root_path, url).then((health) => {
          const list = instancesSignal.peek();
          const existing = list.find((i) => i.id === inst.id);
          if (
            existing &&
            existing.online === health.is_online &&
            existing.has_node_modules === health.has_node_modules
          )
            return; // no change — don't write signal
          instancesSignal.value = list.map((i) =>
            i.id === inst.id
              ? { ...i, online: health.is_online, has_node_modules: health.has_node_modules }
              : i
          );
        });
      } else {
        const list = instancesSignal.peek();
        const existing = list.find((i) => i.id === inst.id);
        if (existing?.online !== false) {
          instancesSignal.value = list.map((i) =>
            i.id === inst.id ? { ...i, online: false } : i
          );
        }
      }
    } catch (e) {
      console.error("Failed to check service status for", inst.id, e);
    }
  }
}

export async function refresh() {
  loadingSignal.value = true;
  errorSignal.value = null;
  try {
    await Promise.all([_refreshSystem(), _refreshReleases()]);
    const loaded = await loadRegisteredInstances();
    instancesSignal.value = loaded.map((i) => ({
      ...i,
      online: null,
      root_exists: null,
      has_backend: null,
      has_frontend: null,
      has_node_modules: null,
      has_bun: null,
      bun_version: null,
    }));

    await refreshStatuses(loaded);

    loaded.forEach((inst) => {
      const url = inst.backend_url || "http://localhost:3001";
      checkInstanceHealth(inst.root_path, url).then((health) => {
        instancesSignal.value = instancesSignal.peek().map((i) =>
          i.id === inst.id
            ? {
                ...i,
                online: health.is_online,
                root_exists: health.root_exists,
                has_backend: health.has_backend,
                has_frontend: health.has_frontend,
                has_node_modules: health.has_node_modules,
                has_bun: health.has_bun,
                bun_version: health.bun_version,
              }
            : i
        );
      });
    });
  } catch (e) {
    errorSignal.value = String(e);
  } finally {
    loadingSignal.value = false;
  }
}

export async function saveInstance(config: InstanceConfig) {
  await saveInstanceConfig(config);
  await refresh();
}

export async function installInFolder(
  instanceId: string,
  rootPath: string,
  service: "backend" | "frontend" | "all"
) {
  const key = `${instanceId}:${service}`;
  installingForSignal.value = key;
  try {
    const result = await installServicePackages(instanceId, rootPath, service);
    await refresh();
    return result;
  } finally {
    installingForSignal.value = null;
  }
}

export async function buildFolder(
  instanceId: string,
  rootPath: string,
  service: "backend" | "frontend" | "all"
) {
  const key = `${instanceId}:${service}`;
  buildingForSignal.value = key;
  try {
    const result = await buildService(instanceId, rootPath, service);
    await refresh();
    return result;
  } finally {
    buildingForSignal.value = null;
  }
}

export async function upgradeInstance(
  instanceId: string,
  rootPath: string,
  release: GitHubRelease
) {
  upgradingForSignal.value = instanceId;
  const targetVersion = cleanVersion(release.tag_name || release.name);
  upgradeProgressSignal.value = {
    ...upgradeProgressSignal.peek(),
    [instanceId]: {
      instance_id: instanceId,
      step: 1,
      total_steps: 5,
      stage: "downloading",
      title: "Downloading Release Archive",
      detail: `Fetching ${release.tag_name} from GitHub...`,
      percent: 10,
      target_version: targetVersion,
    },
  };
  try {
    const zipAsset =
      release.assets.find((a) => a.name.endsWith(".zip") && !a.name.includes("debug")) ||
      release.assets[0];
    if (!zipAsset) throw new Error(`No downloadable archive found in ${release.tag_name}`);
    const zipPath = await downloadReleaseArchive(
      zipAsset.browser_download_url,
      rootPath,
      zipAsset.name || "release.zip"
    );
    const result = await extractAndUpgradeInstance(instanceId, rootPath, zipPath);
    await refresh();
    return result;
  } catch (err) {
    upgradeProgressSignal.value = {
      ...upgradeProgressSignal.peek(),
      [instanceId]: {
        instance_id: instanceId,
        step: 1,
        total_steps: 5,
        stage: "error",
        title: "Upgrade Failed",
        detail: String(err),
        percent: 0,
        target_version: targetVersion,
      },
    };
    throw err;
  } finally {
    upgradingForSignal.value = null;
  }
}

export function clearUpgradeProgress(instanceId: string) {
  const next = { ...upgradeProgressSignal.peek() };
  delete next[instanceId];
  upgradeProgressSignal.value = next;
}

export async function startAppService(
  instanceId: string,
  rootPath: string,
  service: "backend" | "frontend",
  buildFirst?: boolean
) {
  const res = await startService(instanceId, rootPath, service, buildFirst);
  const updated = await getServiceStatus(instanceId, service, rootPath);
  serviceStatusesSignal.value = {
    ...serviceStatusesSignal.peek(),
    [instanceId]: { ...serviceStatusesSignal.peek()[instanceId], [service]: updated },
  };
  return res;
}

export async function stopAppService(
  instanceId: string,
  rootPath: string,
  service: "backend" | "frontend"
) {
  const res = await stopService(instanceId, service);
  const updated = await getServiceStatus(instanceId, service, rootPath);
  serviceStatusesSignal.value = {
    ...serviceStatusesSignal.peek(),
    [instanceId]: { ...serviceStatusesSignal.peek()[instanceId], [service]: updated },
  };
  return res;
}

export async function fetchLogs(instanceId: string, service: string, lines?: number) {
  return getServiceLogs(instanceId, service, lines);
}

export async function clearLogs(instanceId: string, service: string) {
  return clearServiceLogs(instanceId, service);
}

export async function removeInstance(id: string) {
  try {
    await Promise.allSettled([deleteService(id, "backend"), deleteService(id, "frontend")]);
    await removeRegisteredInstance(id);
    instancesSignal.value = instancesSignal.peek().filter((i) => i.id !== id);
  } catch (e) {
    console.error("Failed to remove instance:", e);
    errorSignal.value = String(e);
  }
}

// ── Computed signals ───────────────────────────────────────────────────────────

/** Derived: true while any background operation is in flight */
export const isBusySignal = computed(
  () =>
    !!installingForSignal.value ||
    !!buildingForSignal.value ||
    !!upgradingForSignal.value
);

// ── Provider — initialises the polling loop once ───────────────────────────────

interface CtxValue {
  scan: (path: string) => Promise<InstanceScanResult>;
}
const InstancesCtx = createContext<CtxValue | null>(null);

export function InstancesProvider({ children }: { children: React.ReactNode }) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Wire Tauri upgrade-progress event (once)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<UpgradeProgressInfo>("upgrade-progress", (event) => {
      const payload = event.payload;
      if (!payload?.instance_id) return;
      upgradeProgressSignal.value = {
        ...upgradeProgressSignal.peek(),
        [payload.instance_id]: {
          ...payload,
          target_version:
            upgradeProgressSignal.peek()[payload.instance_id]?.target_version ??
            payload.target_version,
        },
      };
      if (payload.stage === "complete" || payload.stage === "error") {
        setTimeout(() => clearUpgradeProgress(payload.instance_id), 7000);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Initial data load
  useEffect(() => {
    refresh();
  }, []);

  // Single background polling interval — reads signals directly (stable closure)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const insts = instancesSignal.peek();
      if (insts.length === 0) return;
      if (isBusySignal.peek()) return; // don't poll during active operations
      refreshStatuses(insts);
    }, 2500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []); // runs once — no deps needed because we use .peek() not .value

  // Refresh on window focus
  useEffect(() => {
    const onFocus = () => {
      const insts = instancesSignal.peek();
      if (insts.length > 0) refreshStatuses(insts);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const scan = useCallback(
    async (path: string): Promise<InstanceScanResult> => scanInstanceDirectory(path),
    []
  );

  return <InstancesCtx.Provider value={{ scan }}>{children}</InstancesCtx.Provider>;
}

// ── Consumer hook — returns plain values (auto-subscribed via signals transform) ──

export interface InstancesContextValue {
  // Plain values — the signals transform plugin makes reading these reactive
  instances: InstanceWithStatus[];
  systemEnv: SystemEnvironment | null;
  serviceStatuses: Record<string, { backend: ServiceRuntimeStatus; frontend: ServiceRuntimeStatus }>;
  latestRelease: GitHubRelease | null;
  latestVersion: string | null;
  loading: boolean;
  installingFor: string | null;
  buildingFor: string | null;
  upgradingFor: string | null;
  upgradeProgress: Record<string, UpgradeProgressInfo>;
  error: string | null;
  // Actions
  refresh: typeof refresh;
  scan: (path: string) => Promise<InstanceScanResult>;
  save: typeof saveInstance;
  installInFolder: typeof installInFolder;
  buildFolder: typeof buildFolder;
  upgradeInstance: typeof upgradeInstance;
  clearUpgradeProgress: typeof clearUpgradeProgress;
  startAppService: typeof startAppService;
  stopAppService: typeof stopAppService;
  fetchLogs: typeof fetchLogs;
  clearLogs: typeof clearLogs;
  remove: typeof removeInstance;
}

export function useInstances(): InstancesContextValue {
  const ctx = useContext(InstancesCtx);
  if (!ctx) throw new Error("useInstances() must be used inside <InstancesProvider>");

  // Manually activate signal tracking in the calling component.
  // This is equivalent to what @preact/signals-react-transform does automatically,
  // but works reliably regardless of the Babel transform's static analysis constraints.
  useSignals();

  // Reading .value here registers this component as a subscriber via the transform.
  // Each field is only reactive in the component that reads it.
  return {
    instances: instancesSignal.value,
    systemEnv: systemEnvSignal.value,
    serviceStatuses: serviceStatusesSignal.value,
    latestRelease: latestReleaseSignal.value,
    latestVersion: latestVersionSignal.value,
    loading: loadingSignal.value,
    installingFor: installingForSignal.value,
    buildingFor: buildingForSignal.value,
    upgradingFor: upgradingForSignal.value,
    upgradeProgress: upgradeProgressSignal.value,
    error: errorSignal.value,
    refresh,
    scan: ctx.scan,
    save: saveInstance,
    installInFolder,
    buildFolder,
    upgradeInstance,
    clearUpgradeProgress,
    startAppService,
    stopAppService,
    fetchLogs,
    clearLogs,
    remove: removeInstance,
  };
}
