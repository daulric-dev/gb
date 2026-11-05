import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { developmentServerUrl, setApiServerUrl } from "@/lib/api";
import {
  checkServerUrl,
  normalizeServerUrl,
  resolveServerUrl,
  savedServerUrl,
  saveServerUrl,
} from "@/lib/server-url";
import { setSessionToken } from "@/lib/session-token";
import { clearPushState } from "@/lib/push-state";
import { clearOpenedFiles } from "@/lib/open-file";

interface ApiServerContextValue {
  ready: boolean;
  serverUrl: string | null;
  error: string | null;
  connect: (input: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

const ApiServerContext = createContext<ApiServerContextValue | null>(null);

export function ApiServerProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    savedServerUrl()
      .then((saved) => {
        const developmentUrl = developmentServerUrl();
        const selected = saved
          ? normalizeServerUrl(saved, __DEV__)
          : developmentUrl
            ? normalizeServerUrl(developmentUrl, true)
            : null;
        if (!active) return;
        setApiServerUrl(selected);
        setServerUrl(selected);
      })
      .catch(() => {
        if (active)
          setError(
            "Couldn't load the saved server. Enter it again to continue.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = useCallback(async (input: string) => {
    setError(null);
    try {
      const selected = await resolveServerUrl(input, __DEV__);
      await checkServerUrl(selected);
      await saveServerUrl(selected);
      // Never send a session token or cached school file to a newly selected instance.
      await setSessionToken(null);
      clearPushState();
      clearOpenedFiles();
      setApiServerUrl(selected);
      setServerUrl(selected);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Couldn't save the server. Please try again.";
      setError(message);
      throw cause;
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await saveServerUrl(null);
      setApiServerUrl(null);
      setServerUrl(null);
    } catch (cause) {
      setError("Couldn't clear the saved server. Please try again.");
      throw cause;
    }
  }, []);

  return (
    <ApiServerContext.Provider
      value={{ ready, serverUrl, error, connect, disconnect }}
    >
      {children}
    </ApiServerContext.Provider>
  );
}

export function useApiServer(): ApiServerContextValue {
  const context = useContext(ApiServerContext);
  if (!context) {
    throw new Error("useApiServer must be used inside <ApiServerProvider>");
  }
  return context;
}
