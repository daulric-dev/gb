"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  school: {
    id: string;
    name: string;
  } | null;
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<UserProfile>("/auth/me")
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  return { profile, loading };
}
