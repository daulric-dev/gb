import { useState, useEffect, useCallback } from "react";
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

export interface InstanceWithStatus extends InstanceConfig {
  online?: boolean | null; // null = checking
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

export function useInstances() {
  const [instances, setInstances] = useState<InstanceWithStatus[]>([]);
  const [systemEnv, setSystemEnv] = useState<SystemEnvironment | null>(null);
  const [serviceStatuses, setServiceStatuses] = useState<
    Record<string, { backend: ServiceRuntimeStatus; frontend: ServiceRuntimeStatus }>
  >({});
  const [latestRelease, setLatestRelease] = useState<GitHubRelease | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installingFor, setInstallingFor] = useState<string | null>(null);
  const [buildingFor, setBuildingFor] = useState<string | null>(null);
  const [upgradingFor, setUpgradingFor] = useState<string | null>(null);
  const [upgradeProgress, setUpgradeProgress] = useState<Record<string, UpgradeProgressInfo>>({});
  const [error, setError] = useState<string | null>(null);

  // Listen to live upgrade progress events emitted by Tauri Rust backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<UpgradeProgressInfo>("upgrade-progress", (event) => {
      const payload = event.payload;
      if (!payload || !payload.instance_id) return;
      setUpgradeProgress((prev) => {
        const current = prev[payload.instance_id];
        return {
          ...prev,
          [payload.instance_id]: {
            ...payload,
            target_version: current?.target_version ?? payload.target_version,
          },
        };
      });

      if (payload.stage === "complete" || payload.stage === "error") {
        setTimeout(() => {
          setUpgradeProgress((prev) => {
            const next = { ...prev };
            delete next[payload.instance_id];
            return next;
          });
        }, 7000);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const refreshSystem = useCallback(async () => {
    try {
      const env = await checkSystemEnvironment();
      setSystemEnv(env);
    } catch (e) {
      console.error("Failed to check system environment:", e);
    }
  }, []);

  const refreshReleases = useCallback(async () => {
    try {
      const releases = await fetchGithubReleases("daulric-dev", "gb");
      if (releases && releases.length > 0) {
        const first = releases[0];
        setLatestRelease(first);
        setLatestVersion(cleanVersion(first.tag_name));
      }
    } catch (e) {
      console.warn("Could not fetch GitHub releases (offline or rate limited):", e);
    }
  }, []);

  const refreshStatuses = useCallback(async (instList: InstanceConfig[]) => {
    for (const inst of instList) {
      try {
        const [backendStatus, frontendStatus] = await Promise.all([
          getServiceStatus(inst.id, "backend", inst.root_path),
          getServiceStatus(inst.id, "frontend", inst.root_path),
        ]);
        setServiceStatuses((prev) => ({
          ...prev,
          [inst.id]: { backend: backendStatus, frontend: frontendStatus },
        }));

        // Dynamically update online status if services are running or stopped
        if (backendStatus.running || frontendStatus.running) {
          const url = inst.backend_url || "http://localhost:3001";
          checkInstanceHealth(inst.root_path, url).then((health) => {
            setInstances((prev) =>
              prev.map((i) =>
                i.id === inst.id
                  ? {
                      ...i,
                      online: health.is_online,
                      has_node_modules: health.has_node_modules,
                    }
                  : i
              )
            );
          });
        } else {
          setInstances((prev) =>
            prev.map((i) => (i.id === inst.id ? { ...i, online: false } : i))
          );
        }
      } catch (e) {
        console.error("Failed to check service status:", e);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([refreshSystem(), refreshReleases()]);
      const loaded = await loadRegisteredInstances();
      setInstances(
        loaded.map((i) => ({
          ...i,
          online: null,
          root_exists: null,
          has_backend: null,
          has_frontend: null,
          has_node_modules: null,
          has_bun: null,
          bun_version: null,
        }))
      );

      await refreshStatuses(loaded);

      // Kick off initial health & existence checks
      loaded.forEach((inst) => {
        const url = inst.backend_url || "http://localhost:3001";
        checkInstanceHealth(inst.root_path, url).then((health) => {
          setInstances((prev) =>
            prev.map((i) =>
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
            )
          );
        });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshSystem, refreshReleases, refreshStatuses]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Continuously track PM2 backend & frontend processes in the background (survives app reopens)
  useEffect(() => {
    if (instances.length === 0) return;

    const interval = setInterval(() => {
      // Don't poll while an install, build, or upgrade is actively running
      if (!installingFor && !upgradingFor && !buildingFor) {
        refreshStatuses(instances);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [instances, installingFor, upgradingFor, buildingFor, refreshStatuses]);

  // Immediately refresh statuses when the manager window regains focus
  useEffect(() => {
    const onFocus = () => {
      if (instances.length > 0) {
        refreshStatuses(instances);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [instances, refreshStatuses]);

  const scan = useCallback(
    async (path: string): Promise<InstanceScanResult> => scanInstanceDirectory(path),
    []
  );

  const save = useCallback(
    async (config: InstanceConfig) => {
      await saveInstanceConfig(config);
      await refresh();
    },
    [refresh]
  );

  const installInFolder = useCallback(
    async (instanceId: string, rootPath: string, service: "backend" | "frontend" | "all") => {
      const key = `${instanceId}:${service}`;
      setInstallingFor(key);
      try {
        const result = await installServicePackages(instanceId, rootPath, service);
        await refresh();
        return result;
      } finally {
        setInstallingFor(null);
      }
    },
    [refresh]
  );

  const upgradeInstance = useCallback(
    async (instanceId: string, rootPath: string, release: GitHubRelease) => {
      setUpgradingFor(instanceId);
      const targetVersion = cleanVersion(release.tag_name || release.name);
      setUpgradeProgress((prev) => ({
        ...prev,
        [instanceId]: {
          instance_id: instanceId,
          step: 1,
          total_steps: 5,
          stage: "downloading",
          title: "Downloading Release Archive",
          detail: `Fetching ${release.tag_name} package from GitHub...`,
          percent: 10,
          target_version: targetVersion,
        },
      }));

      try {
        const zipAsset = release.assets.find(
          (a) => a.name.endsWith(".zip") && !a.name.includes("debug")
        ) || release.assets[0];
        if (!zipAsset) {
          throw new Error(`No downloadable archive found in release ${release.tag_name}`);
        }
        const zipPath = await downloadReleaseArchive(
          zipAsset.browser_download_url,
          rootPath,
          zipAsset.name || "release.zip"
        );
        const result = await extractAndUpgradeInstance(instanceId, rootPath, zipPath);
        await refresh();
        return result;
      } catch (err) {
        setUpgradeProgress((prev) => ({
          ...prev,
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
        }));
        throw err;
      } finally {
        setUpgradingFor(null);
      }
    },
    [refresh]
  );

  const clearUpgradeProgress = useCallback((instanceId: string) => {
    setUpgradeProgress((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  }, []);

  const buildFolder = useCallback(
    async (instanceId: string, rootPath: string, service: "backend" | "frontend" | "all") => {
      const key = `${instanceId}:${service}`;
      setBuildingFor(key);
      try {
        const result = await buildService(instanceId, rootPath, service);
        await refresh();
        return result;
      } finally {
        setBuildingFor(null);
      }
    },
    [refresh]
  );

  const startAppService = useCallback(
    async (
      instanceId: string,
      rootPath: string,
      service: "backend" | "frontend",
      buildFirst?: boolean
    ) => {
      const res = await startService(instanceId, rootPath, service, buildFirst);
      const updated = await getServiceStatus(instanceId, service, rootPath);
      setServiceStatuses((prev) => ({
        ...prev,
        [instanceId]: {
          ...prev[instanceId],
          [service]: updated,
        },
      }));
      return res;
    },
    []
  );

  const stopAppService = useCallback(
    async (instanceId: string, rootPath: string, service: "backend" | "frontend") => {
      const res = await stopService(instanceId, service);
      const updated = await getServiceStatus(instanceId, service, rootPath);
      setServiceStatuses((prev) => ({
        ...prev,
        [instanceId]: {
          ...prev[instanceId],
          [service]: updated,
        },
      }));
      return res;
    },
    []
  );

  const fetchLogs = useCallback(
    async (
      instanceId: string,
      service: "backend" | "frontend" | "install" | "upgrade" | string,
      lines?: number
    ) => {
      return getServiceLogs(instanceId, service, lines);
    },
    []
  );

  const clearLogs = useCallback(
    async (
      instanceId: string,
      service: "backend" | "frontend" | "install" | "upgrade" | string
    ) => {
      return clearServiceLogs(instanceId, service);
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    try {
      // Stop & delete both PM2 processes before removing from registry
      await Promise.allSettled([
        deleteService(id, "backend"),
        deleteService(id, "frontend"),
      ]);
      await removeRegisteredInstance(id);
      setInstances((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      console.error("Failed to remove instance:", e);
      setError(String(e));
    }
  }, []);

  return {
    instances,
    systemEnv,
    serviceStatuses,
    latestRelease,
    latestVersion,
    loading,
    installingFor,
    buildingFor,
    upgradingFor,
    upgradeProgress,
    clearUpgradeProgress,
    error,
    refresh,
    scan,
    save,
    installInFolder,
    buildFolder,
    upgradeInstance,
    startAppService,
    stopAppService,
    fetchLogs,
    clearLogs,
    remove,
  };
}
