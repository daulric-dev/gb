"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useSignal, type Signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  api,
  setFeatureDisabledHandler,
  setUnauthorizedHandler,
} from "@/lib/api";
import { loginPath } from "@/lib/routing";
import { clearTranslationCache } from "@/lib/translation";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  /** 'staff' | 'student' - students use /portal, staff use /dashboard. */
  account_type: "staff" | "student" | "parent" | null;
  avatar_url: string | null;
  school_management: {
    role: string | null;
  } | null;
  school: {
    id: string;
    name: string;
    /** The school's logo; null shows the app mark. */
    logo_url?: string | null;
  } | null;
  /** Runs this install's organisation (the /organisation console). */
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
  profile: Signal<UserProfile | null>;
  loading: Signal<boolean>;
  refresh: () => Promise<void>;
  /** Re-reads the profile without the loading state (no skeleton flash). */
  refreshSilently: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const profile = useSignal<UserProfile | null>(null);
  const loading = useSignal<boolean>(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchProfile = useCallback((silent = false) => {
    if (inFlight.current) return inFlight.current;
    if (!silent) loading.value = true;
    inFlight.current = api<UserProfile>("/auth/me", {
      skipAuthRedirect: true,
    })
      .then((data) => {
        profile.value = data;
      })
      .catch(() => {
        if (!silent) profile.value = null;
      })
      .finally(() => {
        loading.value = false;
        inFlight.current = null;
      });
    return inFlight.current;
  }, [loading, profile]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  // Signed out (or another account signed in) in this tab: forget cached
  // translations of the previous user's pages. Leaving the app shell (the
  // sign-out buttons) clears them too; the language choice stays.
  useEffect(() => {
    let lastId: string | null = null;
    return profile.subscribe((p) => {
      const id = p?.id ?? null;
      if (lastId !== null && id !== lastId) clearTranslationCache();
      lastId = id;
    });
  }, [profile]);

  // `lib/api` throws on a 401 from anywhere in the app, including code with no
  // component around it. Giving it the router here is what keeps the trip to
  // /login a client transition instead of a document reload.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Drop the stale profile first, so nothing renders as signed in during
      // the transition.
      profile.value = null;
      const { pathname, search } = window.location;
      router.push(loginPath(`${pathname}${search}`));
    });
    return () => setUnauthorizedHandler(null);
  }, [router, profile]);

  // A feature was switched off while the app was open: re-read the profile
  // (at most every few seconds) so the navigation drops it.
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

  const value: AuthContextValue = {
    profile,
    loading,
    refresh: async () => {
      inFlight.current = null;
      await fetchProfile();
    },
    refreshSilently: async () => {
      await fetchProfile(true);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useProfile() {
  useSignals();
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useProfile must be used inside <AuthProvider>");
  }
  return { profile: ctx.profile, loading: ctx.loading };
}

export function useAuth() {
  useSignals();
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
