import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useOfflineReads } from "@/features/offline/OfflineReads";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Markdown } from "@/components/ui/Markdown";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/portal";
import type { CoursePage } from "@/lib/course";

/** One course page, rendered from its Markdown. Read-only on mobile. */
export function PageScreen({
  path,
  staff = false,
}: {
  /** `/portal/me/courses/:c/pages/:p` or `/courses/:c/pages/:p`. */
  path: string;
  staff?: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState<CoursePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Students read pages offline from the copy saved on their last visit.
  const { get, savedAt } = useOfflineReads();

  const load = useCallback(async () => {
    setPage(await get<CoursePage>(path).catch(() => null));
  }, [path, get]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  if (loading) {
    return (
      <Screen title="Page" onBack={() => router.back()}>
        <Skeleton style={{ height: 320 }} />
      </Screen>
    );
  }

  if (!page) {
    return (
      <Screen
        title="Page"
        description="This page could not be loaded. Pages you have not opened before need a connection the first time."
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View />
      </Screen>
    );
  }

  return (
    <Screen
      title={page.title}
      description={page.updatedAt ? `Updated ${formatDate(page.updatedAt)}` : undefined}
      onBack={() => router.back()}
      offlineSavedAt={savedAt}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {staff && !page.isPublished && <Badge variant="secondary">Draft</Badge>}
      <Card>
        <CardContent>
          {page.body?.trim() ? (
            <Markdown size="base">{page.body}</Markdown>
          ) : (
            <Text variant="muted">This page is empty.</Text>
          )}
        </CardContent>
      </Card>
      {staff && (
        <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
          Edit pages on the web app.
        </Text>
      )}
    </Screen>
  );
}
