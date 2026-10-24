import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PortalCourseCard } from "@/lib/portal";
import { href, type CourseTab } from "@/lib/course";
import {
  AnnouncementsSection,
  AttendanceSection,
  GradesSection,
  HomeSection,
  ModulesSection,
  WorkSection,
} from "@/features/course/StudentSections";
import { TopicList } from "@/features/discussions/TopicList";

const TABS: TabItem<CourseTab>[] = [
  { value: "home", label: "Home" },
  { value: "modules", label: "Modules" },
  { value: "work", label: "Work" },
  { value: "grades", label: "Grades" },
  { value: "announcements", label: "Announcements" },
  { value: "discussions", label: "Discussions" },
  { value: "attendance", label: "Attendance" },
];

function isTab(value: unknown): value is CourseTab {
  return TABS.some((t) => t.value === value);
}

/**
 * A student's course: home, modules, work, grades, announcements,
 * discussions and attendance, one section at a time. `?tab=` opens a section
 * directly, which is how an announcement push lands here.
 */
export default function StudentCourseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ courseId: string; tab?: string }>();
  const courseId = params.courseId;
  const [tab, setTab] = useState<CourseTab>(
    isTab(params.tab) ? params.tab : "home",
  );
  const [course, setCourse] = useState<PortalCourseCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (isTab(params.tab)) setTab(params.tab);
  }, [params.tab]);

  const load = useCallback(async () => {
    if (!courseId) return;
    setCourse(
      await api<PortalCourseCard>(`/portal/me/courses/${courseId}`).catch(
        () => null,
      ),
    );
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

  if (!loading && !course) {
    return (
      <Screen
        title="Course"
        description="This course could not be loaded. You may no longer be enrolled."
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View />
      </Screen>
    );
  }

  const section = (() => {
    const props = { courseId, refreshKey };
    switch (tab) {
      case "home":
        return <HomeSection {...props} course={course} onTab={setTab} />;
      case "modules":
        return <ModulesSection {...props} />;
      case "work":
        return <WorkSection {...props} />;
      case "grades":
        return <GradesSection {...props} course={course} />;
      case "announcements":
        return <AnnouncementsSection {...props} />;
      case "discussions":
        return (
          <TopicList
            apiBase={`/portal/me/courses/${courseId}/discussions`}
            isStaff={false}
            refreshKey={refreshKey}
            onOpen={(topicId) =>
              router.push(href(`/course/${courseId}/discussion/${topicId}`))
            }
          />
        );
      case "attendance":
        return <AttendanceSection {...props} />;
    }
  })();

  return (
    <Screen
      title={course?.name ?? "Course"}
      description={course?.code ?? undefined}
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {loading ? <Skeleton style={{ height: 220 }} /> : section}
    </Screen>
  );
}
