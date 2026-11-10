import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { StyleSheet, View } from "react-native";
import { CloudOff } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/theme/ThemeProvider";
import {
  connectivity,
  subscribeConnectivity,
  type Connectivity,
} from "@/lib/connectivity";
import { cachedGet } from "@/lib/offline-reads";
import {
  draftQueue,
  offlineScopeKey,
  subscribeOfflineScope,
} from "@/lib/offline-store";
import type { DraftKind, QueuedDraft } from "@/lib/sync-queue";

// ── connectivity and drafts ────────────────────────────────────────────────

/** "online" | "offline", re-rendering when it changes. */
export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribeConnectivity, connectivity, connectivity);
}

/** Re-render whenever the draft queue or the signed-in student changes. */
function useQueueChanges(): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const offQueue = draftQueue.subscribe(bump);
    const offScope = subscribeOfflineScope(bump);
    return () => {
      offQueue();
      offScope();
    };
  }, []);
}

/** This student's draft for a piece of work (live), or null. */
export function useDraft(
  activityId: string | undefined,
  kind?: DraftKind,
): QueuedDraft | null {
  useQueueChanges();
  const key = offlineScopeKey();
  if (!key || !activityId) return null;
  const item = draftQueue.get(key, activityId, kind);
  // A copy, so a screen holding it sees a new object when the queue changes.
  return item ? { ...item } : null;
}

// ── saved copies and the banner ────────────────────────────────────────────

interface OfflineReadContextValue {
  report: (id: string, savedAt: number | null) => void;
}

const OfflineReadContext = createContext<OfflineReadContextValue | null>(null);

/**
 * Collects which loads on a screen were served from a saved copy. `Screen`
 * wraps its content in one and shows the banner.
 */
export function useOfflineReadScope(): {
  value: OfflineReadContextValue;
  savedAt: number | null;
} {
  const [reports, setReports] = useState<Record<string, number | null>>({});
  const report = useCallback((id: string, savedAt: number | null) => {
    setReports((prev) =>
      prev[id] === savedAt ? prev : { ...prev, [id]: savedAt },
    );
  }, []);
  const value = useMemo(() => ({ report }), [report]);
  return { value, savedAt: oldest(Object.values(reports)) };
}

export function OfflineReadProvider({
  value,
  children,
}: {
  value: OfflineReadContextValue;
  children: ReactNode;
}) {
  return (
    <OfflineReadContext.Provider value={value}>
      {children}
    </OfflineReadContext.Provider>
  );
}

function oldest(values: (number | null)[]): number | null {
  const saved = values.filter((v): v is number => typeof v === "number");
  return saved.length ? Math.min(...saved) : null;
}

let nextReaderId = 0;

/**
 * `get(path)`: GET with the saved copy as a fallback (offline-reads.ts).
 * `savedAt`: when the oldest copy this component is showing was saved, or
 * null when everything is live. Inside a `Screen` the banner shows on its
 * own; a component that renders the `Screen` itself passes `savedAt` to it
 * as `offlineSavedAt`.
 */
export function useOfflineReads(): {
  get: <T>(path: string, toStore?: (data: T) => T) => Promise<T>;
  savedAt: number | null;
} {
  const parent = useContext(OfflineReadContext);
  const id = useRef(`reader-${++nextReaderId}`).current;
  const [reports, setReports] = useState<Record<string, number | null>>({});

  const get = useCallback(
    async <T,>(path: string, toStore?: (data: T) => T): Promise<T> => {
      const result = await cachedGet<T>(path, toStore);
      setReports((prev) =>
        prev[path] === result.savedAt
          ? prev
          : { ...prev, [path]: result.savedAt },
      );
      parent?.report(`${id}:${path}`, result.savedAt);
      return result.data;
    },
    [parent, id],
  );

  // A section that goes away (another tab) stops counting.
  const shown = useRef(reports);
  shown.current = reports;
  useEffect(
    () => () => {
      for (const path of Object.keys(shown.current)) {
        parent?.report(`${id}:${path}`, null);
      }
    },
    [parent, id],
  );

  return { get, savedAt: oldest(Object.values(reports)) };
}

export function formatSavedAt(savedAt: number): string {
  const date = new Date(savedAt);
  const sameDay = new Date().toDateString() === date.toDateString();
  const timeText = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return sameDay
    ? `today at ${timeText}`
    : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${timeText}`;
}

/** "Offline — showing saved copy from today at 9:12" */
export function OfflineBanner({ savedAt }: { savedAt: number }) {
  const { colors, clay } = useTheme();
  const text = `Offline — showing saved copy from ${formatSavedAt(savedAt)}`;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${text}. It refreshes when you are back online.`}
      style={[
        styles.banner,
        {
          backgroundColor: colors.muted,
          borderColor: colors.border,
          borderRadius: clay.radius.lg,
        },
      ]}
    >
      <CloudOff color={colors.foreground} size={16} />
      <View style={{ flex: 1 }}>
        <Text size="sm" weight="500">
          {text}
        </Text>
        <Text variant="muted" size="xs">
          It refreshes when you are back online.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
