import { useEffect, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "@/lib/api";
import { homeRouteFor } from "@/lib/routing";
import {
  isHandledByAuthSession,
  redeemSsoCode,
  ssoErrorMessage,
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

    if (!code) {
      router.replace({
        pathname: "/(auth)/login",
        params: { ssoError: ssoErrorMessage(error) },
      });
      return;
    }

    void (async () => {
      try {
        await redeemSsoCode(code);
        const profile = await refresh();
        router.replace(homeRouteFor(profile));
      } catch (err) {
        router.replace({
          pathname: "/(auth)/login",
          params: {
            ssoError:
              err instanceof ApiError ? err.message : ssoErrorMessage("failed"),
          },
        });
      }
    })();
  }, [params.code, params.error, refresh, router]);

  return <Loading />;
}
