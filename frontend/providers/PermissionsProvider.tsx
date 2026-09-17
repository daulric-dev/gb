"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useSignal, type Signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";

/** The caller's effective permissions in their active school (GET /permissions/me). */
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
  const data = useSignal<MyPermissions | null>(null);
  const loading = useSignal<boolean>(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchPermissions = () => {
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
        inFlight.current = null;
      });
    return inFlight.current;
  };

  useEffect(() => {
    void fetchPermissions();
  }, []);

  const value: PermissionsContextValue = {
    data,
    loading,
    refresh: async () => {
      inFlight.current = null;
      await fetchPermissions();
    },
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

/**
 * Read the current user's effective permissions and check them.
 * `can("student", "read")` mirrors the backend: admins get everything; others
 * are checked against their effective `resource:action` keys.
 */
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
