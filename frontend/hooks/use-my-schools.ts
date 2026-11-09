"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth, useProfile } from "@/providers/AuthProvider";
import {
  loadMySchools,
  mySchools,
  switchActiveSchool,
  type MySchool,
} from "@/lib/active-school";
import { userMessage } from "@/lib/errors";

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
  useSignals();
  const router = useRouter();
  const switching = useSignal<string | null>(null);

  async function switchTo(schoolId: string, path = "/dashboard") {
    switching.value = schoolId;
    try {
      await switchActiveSchool(schoolId);
      await refreshSilently();
      router.push(path);
      router.refresh();
    } catch (err) {
      toast.error(userMessage(err, "Could not switch school"));
    } finally {
      switching.value = null;
    }
  }

  return { switchTo, switching: switching.value };
}
