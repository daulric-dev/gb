import { useState, useEffect, useCallback } from "react";
import {
  loadRegisteredInstances,
  saveInstanceConfig,
  scanInstanceDirectory,
  checkSystemEnvironment,
  checkInstanceHealth,
  installServicePackages,
  startService,
  stopService,
  getServiceStatus,
  getServiceLogs,
} from "./useIpc";
import type {
  InstanceConfig,
  InstanceScanResult,
  ServiceRuntimeStatus,
  SystemEnvironment,
} from "@/types/instance";

export interface InstanceWithStatus extends InstanceConfig {
  online?: boolean | null; // null = checking
  has_node_modules?: boolean | null;
  has_bun?: boolean | null;
  bun_version?: string | null;
}

export function useInstances() {
  const [instances, setInstances] = useState<InstanceWithStatus[]>([]);
  const [systemEnv, setSystemEnv] = useState<SystemEnvironment | null>(null);
  const [serviceStatuses, setServiceStatuses] = useState<
    Record<string, { backend: ServiceRuntimeStatus; frontend: ServiceRuntimeStatus }>
  >({});
  const [loading, setLoading] = useState(true);
  const [installingFor, setInstallingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSystem = useCallback(async () => {
    try {
      const env = await checkSystemEnvironment();
      setSystemEnv(env);
    } catch (e) {
      console.error("Failed to check system environment:", e);
    }
  }, []);

  const refreshStatuses = useCallback(async (instList: InstanceConfig[]) => {
    for (const inst of instList) {
      try {
        const [backendStatus, frontendStatus] = await Promise.all([
          getServiceStatus(inst.id, "backend"),
          getServiceStatus(inst.id, "frontend"),
        ]);
        setServiceStatuses((prev) => ({
          ...prev,
          [inst.id]: { backend: backendStatus, frontend: frontendStatus },
        }));
      } catch (e) {
        console.error("Failed to check service status:", e);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshSystem();
      const loaded = await loadRegisteredInstances();
      setInstances(
        loaded.map((i) => ({
          ...i,
          online: null,
          has_node_modules: null,
          has_bun: null,
          bun_version: null,
        }))
      );

      await refreshStatuses(loaded);

      // Kick off health & status checks in parallel
      loaded.forEach((inst, idx) => {
        const url = inst.backend_url || "http://localhost:3001";
        checkInstanceHealth(inst.root_path, url).then((health) => {
          setInstances((prev) => {
            const next = [...prev];
            if (next[idx]) {
              next[idx] = {
                ...next[idx],
                online: health.is_online,
                has_node_modules: health.has_node_modules,
                has_bun: health.has_bun,
                bun_version: health.bun_version,
              };
            }
            return next;
          });
        });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshSystem, refreshStatuses]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    async (rootPath: string, service: "backend" | "frontend" | "all") => {
      const key = `${rootPath}:${service}`;
      setInstallingFor(key);
      try {
        const result = await installServicePackages(rootPath, service);
        await refresh();
        return result;
      } finally {
        setInstallingFor(null);
      }
    },
    [refresh]
  );

  const startAppService = useCallback(
    async (instanceId: string, rootPath: string, service: "backend" | "frontend") => {
      const res = await startService(instanceId, rootPath, service);
      const updated = await getServiceStatus(instanceId, service);
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
    async (instanceId: string, service: "backend" | "frontend") => {
      const res = await stopService(instanceId, service);
      const updated = await getServiceStatus(instanceId, service);
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
    async (instanceId: string, service: "backend" | "frontend", lines?: number) => {
      return getServiceLogs(instanceId, service, lines);
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    setInstances((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return {
    instances,
    systemEnv,
    serviceStatuses,
    loading,
    installingFor,
    error,
    refresh,
    scan,
    save,
    installInFolder,
    startAppService,
    stopAppService,
    fetchLogs,
    remove,
  };
}
