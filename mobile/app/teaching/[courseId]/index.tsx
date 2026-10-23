import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Hand } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import { href, type StaffCourse } from "@/lib/course";
import {
  StaffAnnouncementsSection,
  StaffGradebookSection,
  StaffModulesSection,
  StaffPeopleSection,
  StaffWorkSection,
} from "@/features/course/StaffSections";
import { TopicList } from "@/features/discussions/TopicList";

type StaffTab =
  | "modules"
  | "work"
  | "announcements"
  | "discussions"
  | "people"
  | "gradebook";

const TABS: TabItem<StaffTab>[] = [
  { value: "work", label: "Marking" },
  { value: "modules", label: "Modules" },
  { value: "announcements", label: "Announcements" },
  { value: "discussions", label: "Discussions" },
  { value: "gradebook", label: "Gradebook" },
  { value: "people", label: "People" },
];

function isTab(value: unknown): value is StaffTab {
  return TABS.some((t) => t.value === value);
}

/**
 * A course from the staff side: marking, modules (read-only, with module
 * publishing), announcements, discussions, the gradebook and the roster.
 * Building content stays on the web app.
 */
export default function StaffCourseScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ courseId: string; tab?: string }>();
  const courseId = params.courseId;
  const [tab, setTab] = useState<StaffTab>(
    isTab(params.tab) ? params.tab : "work",
  );
  const [course, setCourse] = useState<StaffCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!courseId) return;
    setCourse(await api<StaffCourse>(`/courses/${courseId}`).catch(() => null));
  }, [courseId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    load().finally(() => setRefreshing(false));
  }, [load]);

  if (!courseId) return null;

  if (loading) {
    return (
      <Screen title="Course" onBack={() => router.back()}>
        <Skeleton style={{ height: 240 }} />
      </Screen>
    );
  }

  if (!course) {
    return (
      <Screen
        title="Course"
        description="This course could not be loaded"
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View />
      </Screen>
    );
  }

  const props = { course, refreshKey };
  const section = (() => {
    switch (tab) {
      case "modules":
        return <StaffModulesSection {...props} />;
      case "work":
        return <StaffWorkSection {...props} />;
      case "announcements":
        return <StaffAnnouncementsSection {...props} />;
      case "discussions":
        return (
          <TopicList
            apiBase={`/courses/${course.id}/discussions`}
            isStaff
            refreshKey={refreshKey}
            onOpen={(topicId) =>
              router.push(href(`/teaching/${course.id}/discussion/${topicId}`))
            }
          />
        );
      case "people":
        return <StaffPeopleSection {...props} />;
      case "gradebook":
        return <StaffGradebookSection {...props} />;
    }
  })();

  return (
    <Screen
      title={course.name}
      description={
        [
          course.code,
          course.status !== "published"
            ? course.status === "draft"
              ? "Draft"
              : "Archived"
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {course.status === "published" && (
        <Button
          variant="secondary"
          size="sm"
          icon={<Hand size={14} color={colors.secondaryForeground} />}
          onPress={() =>
            router.push(
              href(
                `/attendance/take/${course.id}?name=${encodeURIComponent(course.name)}`,
              ),
            )
          }
        >
          Take attendance
        </Button>
      )}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {section}
    </Screen>
  );
}
