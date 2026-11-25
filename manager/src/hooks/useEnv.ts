import { useState, useCallback } from "react";
import { readServiceEnvs, saveServiceEnvs } from "./useIpc";
import type { ServiceEnv, EnvVariable } from "@/types/env";

export function useEnv(instanceRoot: string | null) {
  const [services, setServices] = useState<ServiceEnv[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!instanceRoot) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await readServiceEnvs(instanceRoot);
      setServices(loaded);
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [instanceRoot]);

  const updateVar = useCallback(
    (serviceId: string, key: string, value: string) => {
      setServices((prev) =>
        prev.map((svc) => {
          if (svc.service_id !== serviceId) return svc;
          return {
            ...svc,
            variables: svc.variables.map((v) =>
              v.key === key ? { ...v, value } : v
            ),
          };
        })
      );
      setDirty(true);
    },
    []
  );

  const addVar = useCallback((serviceId: string, variable: EnvVariable) => {
    setServices((prev) =>
      prev.map((svc) =>
        svc.service_id === serviceId
          ? { ...svc, variables: [...svc.variables, variable] }
          : svc
      )
    );
    setDirty(true);
  }, []);

  const removeVar = useCallback((serviceId: string, key: string) => {
    setServices((prev) =>
      prev.map((svc) =>
        svc.service_id === serviceId
          ? { ...svc, variables: svc.variables.filter((v) => v.key !== key) }
          : svc
      )
    );
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!instanceRoot) return;
    setSaving(true);
    setError(null);
    try {
      await saveServiceEnvs(instanceRoot, services);
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [instanceRoot, services]);

  return { services, loading, saving, error, dirty, load, updateVar, addVar, removeVar, save };
}
