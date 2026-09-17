"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useSignal, type Signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { useProfile } from "@/providers/AuthProvider";

export interface MyPermissions {
  schoolId: string | null;
  role: string | null;
  isAdmin: boolean;
  permissions: string[];
}

interface PermissionsContextValue {
  data: Signal<MyPermissions | null>;
  loading: Signal<boolean>;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  useSignals();
  const { profile } = useProfile();
  const data = useSignal<MyPermissions | null>(null);
  const loading = useSignal<boolean>(true);

  const initialized = useSignal<boolean>(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchPermissions = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    loading.value = true;
    inFlight.current = api<MyPermissions>("/permissions/me", {
      skipAuthRedirect: true,
    })
      .then((res) => {
        data.value = res;
      })
      .catch(() => {
        data.value = null;
      })
      .finally(() => {
        loading.value = false;
        initialized.value = true;
        inFlight.current = null;
      });
    return inFlight.current;
  }, [data, loading, initialized]);

  const refresh = useCallback(async () => {
    inFlight.current = null;
    await fetchPermissions();
  }, [fetchPermissions]);

  const activeSchoolId = profile.value?.school?.id ?? null;
  useEffect(() => {
    void refresh();
  }, [activeSchoolId, refresh]);

  const value: PermissionsContextValue = { data, loading, refresh };

  if (!initialized.value) return null;

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  useSignals();
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error("usePermissions must be used inside <PermissionsProvider>");
  }
  const data = ctx.data.value;

  const can = (resource: string, action: string): boolean => {
    if (!data) return false;
    if (data.isAdmin) return true;
    return data.permissions.includes(`${resource}:${action}`);
  };

  return {
    can,
    isAdmin: data?.isAdmin ?? false,
    role: data?.role ?? null,
    permissions: data?.permissions ?? [],
    loading: ctx.loading,
    refresh: ctx.refresh,
  };
}
