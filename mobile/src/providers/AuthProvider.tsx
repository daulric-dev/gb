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
import {
  api,
  ApiError,
  apiServerOrigin,
  isNetworkError,
  setFeatureDisabledHandler,
} from "@/lib/api";
import { resolveFeatures } from "@/lib/features";
import { registerForPush, unregisterPush } from "@/lib/push";
import { clearOpenedFiles } from "@/lib/open-file";
import { clearOfflineData, savedProfile } from "@/lib/offline-store";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  /** 'staff' | 'student' - students use the portal, staff use the tabs. */
  account_type: "staff" | "student" | "parent" | null;
  avatar_url: string | null;
  school_management: {
    role: string | null;
  } | null;
  school: {
    id: string;
    name: string;
    /** The school's logo; null shows nothing extra. */
    logo_url?: string | null;
  } | null;
  /** Runs this install's organisation (managed on the web). */
  is_org_admin?: boolean;
  /** The organisation running this install; null before setup. */
  organisation?: { name: string } | null;
  /**
   * Effective feature switches for the active school. Missing on servers that
   * predate them; read it through `useFeatures()`, which fills the gaps.
   */
  features?: Partial<Record<string, boolean>>;
}

interface AuthContextValue {
  profile: UserProfile | null;
  loading: boolean;
  /** Re-reads the session; resolves with the profile (null when signed out). */
  refresh: () => Promise<UserProfile | null>;
  /** Re-reads the profile without the loading state (no splash flash). */
  refreshSilently: () => Promise<UserProfile | null>;
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

  const fetchProfile = useCallback((silent = false): Promise<UserProfile | null> => {
    if (inFlight.current) return inFlight.current;
    if (silent) {
      // Only the profile is re-read; a failure keeps what we have.
      inFlight.current = api<UserProfile>("/auth/me", { skipAuthRedirect: true })
        .then((data) => {
          setProfile(data);
          return data;
        })
        .catch(() => null)
        .finally(() => {
          inFlight.current = null;
        });
      return inFlight.current;
    }
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
        // Offline mode: a student opening the app without a signal gets the
        // profile saved on their last visit (this server only), so saved
        // copies and drafts are usable. OfflineProvider re-reads it once
        // the server answers.
        const server = apiServerOrigin();
        const saved =
          isNetworkError(err) && server
            ? savedProfile<UserProfile>(server)
            : null;
        if (saved?.account_type === "student") {
          setProfile((current) => current ?? saved);
          return saved;
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
  // Not while the school has push notifications switched off.
  const userId = profile?.id ?? null;
  const pushOn = resolveFeatures(profile?.features).push_notifications;
  useEffect(() => {
    if (!userId) return;
    // Switched off while signed in: hand this device's token back too.
    if (pushOn) void registerForPush();
    else void unregisterPush();
  }, [userId, pushOn]);

  // A feature was switched off while the app was open: re-read the profile
  // (at most every few seconds) so tabs and lists drop it.
  const lastFeatureRefresh = useRef(0);
  useEffect(() => {
    setFeatureDisabledHandler(() => {
      const now = Date.now();
      if (now - lastFeatureRefresh.current < 5_000) return;
      lastFeatureRefresh.current = now;
      void fetchProfile(true);
    });
    return () => setFeatureDisabledHandler(null);
  }, [fetchProfile]);

  const refresh = useCallback(async () => {
    inFlight.current = null;
    return fetchProfile();
  }, [fetchProfile]);

  const refreshSilently = useCallback(() => fetchProfile(true), [fetchProfile]);

  const logout = useCallback(async () => {
    // Before /auth/logout: the device is removed as the signed-in user.
    await unregisterPush();
    try {
      await api("/auth/logout", { method: "POST", skipAuthRedirect: true });
    } catch {
      /* clear local state regardless of network result */
    }
    await setSessionToken(null);
    clearOpenedFiles();
    // Saved copies, drafts and the remembered profile: the next person on
    // this device finds nothing (settings warns about unsent drafts first).
    clearOfflineData();
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading, refresh, refreshSilently, logout }}>
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
