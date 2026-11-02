"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth, useProfile } from "@/providers/AuthProvider";
import {
  loadMySchools,
  mySchools,
  switchActiveSchool,
  type MySchool,
} from "@/lib/active-school";
import { errorMessage } from "@/lib/organisation";

/**
 * The schools the signed-in staff member can switch between, reloaded when
 * the active school changes; null while loading (and always for students).
 */
export function useMySchools(): MySchool[] | null {
  const { profile } = useProfile();
  const signedIn = !!profile.value;
  const isStudent = profile.value?.account_type === "student";
  const activeId = profile.value?.school?.id ?? null;

  useEffect(() => {
    if (signedIn && !isStudent) void loadMySchools(activeId);
  }, [signedIn, isStudent, activeId]);

  const current = mySchools.value;
  return current && current.forSchool === activeId ? current.list : null;
}

/**
 * Switch the active school, re-read the profile (which refetches
 * permissions and remounts the dashboard's school-scoped pages), then go to
 * `path` in that school.
 */
export function useSwitchSchool() {
  const { refreshSilently } = useAuth();
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);

  async function switchTo(schoolId: string, path = "/dashboard") {
    setSwitching(schoolId);
    try {
      await switchActiveSchool(schoolId);
      await refreshSilently();
      router.push(path);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not switch school"));
    } finally {
      setSwitching(null);
    }
  }

  return { switchTo, switching };
}
