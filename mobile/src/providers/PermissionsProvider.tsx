import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";

/** The caller's effective permissions in their active school (GET /permissions/me). */
export interface MyPermissions {
  schoolId: string | null;
  role: string | null;
  isAdmin: boolean;
  permissions: string[];
}

interface PermissionsContextValue {
  data: MyPermissions | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<MyPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchPermissions = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    inFlight.current = api<MyPermissions>("/permissions/me", {
      skipAuthRedirect: true,
    })
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => {
        setLoading(false);
        inFlight.current = null;
      });
    return inFlight.current;
  }, []);

  useEffect(() => {
    void fetchPermissions();
  }, [fetchPermissions]);

  const refresh = useCallback(async () => {
    inFlight.current = null;
    await fetchPermissions();
  }, [fetchPermissions]);

  return (
    <PermissionsContext.Provider value={{ data, loading, refresh }}>
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
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error("usePermissions must be used inside <PermissionsProvider>");
  }
  const { data } = ctx;

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
