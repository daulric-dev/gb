import { useEffect, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { homeRouteFor } from "@/lib/routing";
import { ApiError } from "@/lib/api";
import {
  hasPendingSignIn,
  isHandledByAuthSession,
  redeemSsoCode,
} from "@/lib/sso";
import { useAuth } from "@/providers/AuthProvider";
import { Loading } from "@/components/layout/Loading";

/**
 * `gradebook://sso?code=` / `?error=` opened as a deep link.
 *
 * Normally the login screen's auth session receives this URL itself. This
 * route is the fallback for when it does not - the app was killed while the
 * browser was open, or Android delivered the redirect as a plain link - so a
 * finished sign-in still lands.
 *
 * Anyone can open this link, so it only redeems a code when this app started
 * a sign-in that is still waiting (its verifier is in the keychain), and only
 * shows known error reasons - never the link's own text.
 */
export default function SsoReturnScreen() {
  const router = useRouter();
  const { refresh } = useAuth();
  const params = useLocalSearchParams<{ code?: string; error?: string }>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = typeof params.code === "string" ? params.code : null;
    const error = typeof params.error === "string" ? params.error : null;

    // The login screen is already finishing this sign-in; step aside.
    if (isHandledByAuthSession(code)) {
      if (router.canGoBack()) router.back();
      else router.replace("/");
      return;
    }

    // A reason code only; the login screen maps it to fixed text.
    const fail = (reason: string) =>
      router.replace({ pathname: "/(auth)/login", params: { ssoError: reason } });

    void (async () => {
      // No sign-in of ours is waiting: someone else's link. Ignore it.
      if (!(await hasPendingSignIn())) {
        fail("failed");
        return;
      }
      if (!code) {
        fail(error ?? "failed");
        return;
      }
      try {
        await redeemSsoCode(code);
        const profile = await refresh();
        router.replace(homeRouteFor(profile));
      } catch (err) {
        fail(err instanceof ApiError && err.status < 500 ? "expired" : "failed");
      }
    })();
  }, [params.code, params.error, refresh, router]);

  return <Loading />;
}
