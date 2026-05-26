"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useSignal, type Signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
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
  profile: Signal<UserProfile | null>;
  loading: Signal<boolean>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const profile = useSignal<UserProfile | null>(null);
  const loading = useSignal<boolean>(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const fetchProfile = () => {
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
  };

  useEffect(() => {
    void fetchProfile();
  }, []);

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
