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

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  avatar_url: string | null;
  school_management: {
    role: string | null;
  } | null;
  school: {
    id: string;
    name: string;
  } | null;
}

interface AuthContextValue {
  profile: UserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchProfile = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    inFlight.current = api<UserProfile>("/auth/me", {
      skipAuthRedirect: true,
    })
      .then((data) => {
        setProfile(data);
      })
      .catch(() => {
        setProfile(null);
      })
      .finally(() => {
        setLoading(false);
        inFlight.current = null;
      });
    return inFlight.current;
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const refresh = useCallback(async () => {
    inFlight.current = null;
    await fetchProfile();
  }, [fetchProfile]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", skipAuthRedirect: true });
    } catch {
      /* clear local state regardless of network result */
    }
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
