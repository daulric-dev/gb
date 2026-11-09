import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setupRedirectPath } from "@/lib/routing";

/**
 * First-run setup state. A fresh install has no organisation until a signed-in
 * user names it on /setup. The API says whether setup is pending and whether
 * this user may run it (the same rule POST /setup applies), so someone who can
 * set up is always sent there and nobody else is.
 *
 * GET /setup/eligibility is asked at most once per page load (and again only
 * after setup itself), so navigating around the app costs no extra requests.
 */

export interface SetupEligibility {
  needsSetup: boolean;
  canSetUp: boolean;
}

const DONE: SetupEligibility = { needsSetup: false, canSetUp: false };

let status: Promise<SetupEligibility> | null = null;

/** Whether setup is pending and this user may run it; a failed check counts as "no". */
export function setupEligibility(): Promise<SetupEligibility> {
  if (!status) {
    status = api<SetupEligibility>("/setup/eligibility", { skipAuthRedirect: true })
      .then((res) => ({
        needsSetup: !!res?.needsSetup,
        canSetUp: !!res?.canSetUp,
      }))
      .catch(() => {
        // Ask again next time rather than caching a network blip.
        status = null;
        return DONE;
      });
  }
  return status;
}

/** Forget the cached status (after setup succeeds, or to ask again). */
export function resetSetupStatus(done = false) {
  status = done ? Promise.resolve(DONE) : null;
}

/**
 * Sends a signed-in user who may run setup to /setup while the install has no
 * organisation. Mount it in the signed-in entry points (dashboard, portal,
 * onboarding, the school list); pass `enabled` false until the profile has
 * loaded. Returns the eligibility once known, so a page can explain the wait
 * to someone who cannot set up.
 */
export function useSetupGate(enabled: boolean): SetupEligibility | null {
  useSignals();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const eligibility = useSignal<SetupEligibility | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void setupEligibility().then((result) => {
      if (cancelled) return;
      eligibility.value = result;
      const target = setupRedirectPath(result.canSetUp, pathname);
      if (target) router.replace(target);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, pathname, router, eligibility]);

  return eligibility.value;
}
