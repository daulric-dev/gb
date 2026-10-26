import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSessionToken, setSessionToken } from "@/lib/session-token";
import { api, ApiError } from "@/lib/api";
import { registerForPush, unregisterPush } from "@/lib/push";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  /** 'staff' | 'student' - students use the portal, staff use the tabs. */
  account_type: "staff" | "student" | null;
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
  /** Re-reads the session; resolves with the profile (null when signed out). */
  refresh: () => Promise<UserProfile | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** How soon to ask again when the API couldn't be reached. */
const PROFILE_RETRY_MS = 3_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<Promise<UserProfile | null> | null>(null);

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProfile = useCallback((): Promise<UserProfile | null> => {
    if (inFlight.current) return inFlight.current;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setLoading(true);
    let retrying = false;
    inFlight.current = api<UserProfile>("/auth/me", {
      skipAuthRedirect: true,
    })
      .then((data) => {
        setProfile(data);
        return data;
      })
      .catch(async (err) => {
        // Only the server saying "no session" (401) signs the app out. A
        // network failure or a server/database outage (0, 5xx) says nothing
        // about the session: keep the token and the profile we have, and try
        // again shortly instead of dropping the user on the sign-in screen.
        const signedOut = err instanceof ApiError && err.status === 401;
        if (signedOut || !(await getSessionToken())) {
          setProfile(null);
          return null;
        }
        retrying = true;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void fetchProfile();
        }, PROFILE_RETRY_MS);
        return null;
      })
      .finally(() => {
        if (!retrying) setLoading(false);
        inFlight.current = null;
      });
    return inFlight.current;
  }, []);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Register this device for pushes once per signed-in account. Staff get a
  // token too; the API only sends them what is meant for them.
  const userId = profile?.id ?? null;
  useEffect(() => {
    if (userId) void registerForPush();
  }, [userId]);

  const refresh = useCallback(async () => {
    inFlight.current = null;
    return fetchProfile();
  }, [fetchProfile]);

  const logout = useCallback(async () => {
    // Before /auth/logout: the device is removed as the signed-in user.
    await unregisterPush();
    try {
      await api("/auth/logout", { method: "POST", skipAuthRedirect: true });
    } catch {
      /* clear local state regardless of network result */
    }
    await setSessionToken(null);
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
