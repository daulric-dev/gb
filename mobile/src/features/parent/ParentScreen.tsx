import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PowerOff, Users } from "lucide-react-native";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { personName, type ParentChild } from "@/lib/parent";
import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { useParent } from "./ParentContext";

/**
 * A parent tab: the child switcher on top, then `render(child)`. Handles the
 * portal being off, no linked children and loading.
 */
export function ParentScreen({
  title,
  render,
  onRefresh,
}: {
  title: string;
  render: (child: ParentChild) => ReactNode;
  onRefresh?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const { children, selected, select, loading, disabled, reload } = useParent();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    await onRefresh?.();
    setRefreshing(false);
  }, [reload, onRefresh]);

  let body: ReactNode;
  if (loading) body = <Skeleton style={{ height: 120 }} />;
  else if (disabled) {
    body = (
      <EmptyState
        icon={PowerOff}
        title="The parent portal is turned off"
        description="Your child's school has not switched the parent portal on."
      />
    );
  } else if (!selected) {
    body = (
      <EmptyState
        icon={Users}
        title="No children linked yet"
        description="Use the invitation email or the code your child's school gave you."
        action={<Button onPress={() => router.push("/parent-link")}>Enter a code</Button>}
      />
    );
  } else body = render(selected);

  return (
    <Screen title={title} refreshing={refreshing} onRefresh={refresh}>
      {children.length > 1 && selected ? (
        <SegmentedControl
          options={children.map((c) => ({ value: c.id, label: personName(c, "Child") }))}
          value={selected.id}
          onChange={select}
        />
      ) : selected ? (
        <Text variant="muted">
          {personName(selected, "Your child")}
          {selected.school.name ? ` · ${selected.school.name}` : ""}
        </Text>
      ) : null}
      <View style={{ gap: 12 }}>{body}</View>
    </Screen>
  );
}

/** Load a child resource; refetches when the path changes. */
export function useChildResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (err) {
      setData(null);
      setError(userMessage(err, "This could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

export function formatWhen(value: string | null | undefined, withTime = false): string {
  if (!value) return "No due date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}
