"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { api } from "./api";
import { useSignals } from "@preact/signals-react/runtime";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  avatar_url: string | null;
  school: {
    id: string;
    name: string;
  } | null;
}

export function useProfile() {
  useSignals();
  const profile = useSignal<UserProfile | null>(null);
  const loading = useSignal(true);

  useEffect(() => {
    api<UserProfile>("/auth/me")
      .then((data) => {
        profile.value = data;
      })
      .catch(() => {
        profile.value = null;
      })
      .finally(() => {
        loading.value = false;
      });
  }, []);

  return { profile, loading };
}
