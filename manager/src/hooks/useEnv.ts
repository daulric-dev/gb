import { useState, useCallback } from "react";
import { readServiceEnvs, saveServiceEnvs } from "./useIpc";
import type { ServiceEnv, EnvVariable } from "@/types/env";
import { isSecretKey } from "./envUtils";

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
          const exists = svc.variables.some(
            (v) => v.key.toUpperCase() === key.toUpperCase()
          );
          if (exists) {
            return {
              ...svc,
              variables: svc.variables.map((v) =>
                v.key.toUpperCase() === key.toUpperCase() ? { ...v, value } : v
              ),
            };
          } else {
            return {
              ...svc,
              variables: [
                ...svc.variables,
                {
                  key: key.trim(),
                  value,
                  is_secret: isSecretKey(key),
                },
              ],
            };
          }
        })
      );
      setDirty(true);
    },
    []
  );

  const addVar = useCallback((serviceId: string, variable: EnvVariable) => {
    setServices((prev) =>
      prev.map((svc) => {
        if (svc.service_id !== serviceId) return svc;
        const exists = svc.variables.some(
          (v) => v.key.toUpperCase() === variable.key.toUpperCase()
        );
        if (exists) {
          return {
            ...svc,
            variables: svc.variables.map((v) =>
              v.key.toUpperCase() === variable.key.toUpperCase()
                ? { ...v, value: variable.value, comment: variable.comment ?? v.comment }
                : v
            ),
          };
        }
        return { ...svc, variables: [...svc.variables, variable] };
      })
    );
    setDirty(true);
  }, []);

  const removeVar = useCallback((serviceId: string, key: string) => {
    setServices((prev) =>
      prev.map((svc) =>
        svc.service_id === serviceId
          ? {
              ...svc,
              variables: svc.variables.filter(
                (v) => v.key.toUpperCase() !== key.toUpperCase()
              ),
            }
          : svc
      )
    );
    setDirty(true);
  }, []);

  /**
   * Atomic batch merge function:
   * Merges incoming variables into serviceId (updating existing, adding new),
   * updates state, and optionally persists directly to disk via Tauri IPC.
   */
  const mergeVariables = useCallback(
    async (
      serviceId: string,
      incoming: Array<{ key: string; value: string; comment?: string; is_secret?: boolean }>,
      autoSave = true
    ) => {
      let nextServices: ServiceEnv[] = [];

      setServices((prev) => {
        let found = false;
        const next = prev.map((svc) => {
          if (svc.service_id !== serviceId) return svc;
          found = true;

          const vars = [...svc.variables];
          for (const inc of incoming) {
            const keyTrimmed = inc.key.trim();
            const existingIdx = vars.findIndex(
              (v) => v.key.toUpperCase() === keyTrimmed.toUpperCase()
            );

            if (existingIdx >= 0) {
              vars[existingIdx] = {
                ...vars[existingIdx],
                value: inc.value,
                comment: inc.comment !== undefined ? inc.comment : vars[existingIdx].comment,
                is_secret: inc.is_secret !== undefined ? inc.is_secret : vars[existingIdx].is_secret,
              };
            } else {
              vars.push({
                key: keyTrimmed,
                value: inc.value,
                is_secret: inc.is_secret ?? isSecretKey(keyTrimmed),
                comment: inc.comment,
              });
            }
          }

          return { ...svc, variables: vars };
        });

        if (!found) {
          const newVars = incoming.map((inc) => ({
            key: inc.key.trim(),
            value: inc.value,
            is_secret: inc.is_secret ?? isSecretKey(inc.key),
            comment: inc.comment,
          }));
          next.push({
            service: serviceId as "backend" | "frontend",
            service_id: serviceId,
            path: "",
            variables: newVars,
          });
        }

        nextServices = next;
        return next;
      });

      setDirty(!autoSave);

      if (autoSave && instanceRoot) {
        setSaving(true);
        setError(null);
        try {
          await saveServiceEnvs(instanceRoot, nextServices);
          setDirty(false);
        } catch (e) {
          setError(String(e));
          throw e;
        } finally {
          setSaving(false);
        }
      }

      return nextServices;
    },
    [instanceRoot]
  );

  /**
   * Replaces an entire service's variables list (e.g. from direct raw .env text editor).
   */
  const replaceServiceVariables = useCallback(
    async (
      serviceId: string,
      variables: EnvVariable[],
      autoSave = true
    ) => {
      let nextServices: ServiceEnv[] = [];

      setServices((prev) => {
        let found = false;
        const next = prev.map((svc) => {
          if (svc.service_id !== serviceId) return svc;
          found = true;
          return { ...svc, variables };
        });

        if (!found) {
          next.push({
            service: serviceId as "backend" | "frontend",
            service_id: serviceId,
            path: "",
            variables,
          });
        }

        nextServices = next;
        return next;
      });

      setDirty(!autoSave);

      if (autoSave && instanceRoot) {
        setSaving(true);
        setError(null);
        try {
          await saveServiceEnvs(instanceRoot, nextServices);
          setDirty(false);
        } catch (e) {
          setError(String(e));
          throw e;
        } finally {
          setSaving(false);
        }
      }

      return nextServices;
    },
    [instanceRoot]
  );

  const save = useCallback(
    async (overrideServices?: ServiceEnv[] | unknown) => {
      if (!instanceRoot) return;
      setSaving(true);
      setError(null);
      const toSave = Array.isArray(overrideServices) ? overrideServices : services;
      try {
        await saveServiceEnvs(instanceRoot, toSave);
        setDirty(false);
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    },
    [instanceRoot, services]
  );

  return {
    services,
    loading,
    saving,
    error,
    dirty,
    load,
    updateVar,
    addVar,
    removeVar,
    mergeVariables,
    replaceServiceVariables,
    save,
  };
}
