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
import { api, setUnauthorizedHandler } from "@/lib/api";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  /** 'staff' | 'student' - students use /portal, staff use /dashboard. */
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
  profile: Signal<UserProfile | null>;
  loading: Signal<boolean>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const profile = useSignal<UserProfile | null>(null);
  const loading = useSignal<boolean>(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchProfile = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    loading.value = true;
    inFlight.current = api<UserProfile>("/auth/me", {
      skipAuthRedirect: true,
    })
      .then((data) => {
        profile.value = data;
      })
      .catch(() => {
        profile.value = null;
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

  // `lib/api` throws on a 401 from anywhere in the app, including code with no
  // component around it. Giving it the router here is what keeps the trip to
  // /login a client transition instead of a document reload.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Drop the stale profile first, so nothing renders as signed in during
      // the transition.
      profile.value = null;
      router.push("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [router, profile]);

  const value: AuthContextValue = {
    profile,
    loading,
    refresh: async () => {
      inFlight.current = null;
      await fetchProfile();
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
