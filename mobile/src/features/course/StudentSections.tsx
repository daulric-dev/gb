import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  NotebookPen,
  PenLine,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/ui/Markdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import { teacherNames, formatDate, type PortalCourseCard } from "@/lib/portal";
import { dueLabel } from "@/lib/work";
import { formatScore } from "@/lib/format-number";
import {
  activityGradeState,
  gradeColor,
  percentLabel,
  type PortalGradeActivity,
} from "@/lib/grades";
import { STATUS_LABEL, type PortalCourseAttendance } from "@/lib/attendance";
import {
  announcementAuthor,
  href,
  timeAgo,
  type CourseAnnouncement,
  type CourseModule,
  type CourseTab,
} from "@/lib/course";
import { ModuleList } from "./ModuleList";
import { AnnouncementList } from "./AnnouncementList";
import { useSection } from "./useSection";
import { useOpenModuleItem } from "./useOpenModuleItem";

interface SectionProps {
  courseId: string;
  refreshKey: number;
}

function SectionError({ what }: { what: string }) {
  return (
    <EmptyState
      icon={FileText}
      title={`${what} could not be loaded`}
      description="Pull down to try again."
    />
  );
}

function kindIcon(kind: PortalGradeActivity["kind"]) {
  return kind === "quiz" ? ClipboardList : kind === "offline" ? PenLine : FileText;
}

/** Work a student still owes: published, handed in online, not handed in. */
function isOpen(a: PortalGradeActivity) {
  if (a.kind === "offline" || a.status !== "published") return false;
  return !a.submission || a.submission.status === "draft";
}

/** One piece of work with its state; opens the work screen. */
export function WorkRow({ item }: { item: PortalGradeActivity }) {
  const router = useRouter();
  const { colors } = useTheme();
  const Icon = kindIcon(item.kind);
  const state = activityGradeState(item);
  const handedIn = !!item.submission && item.submission.status !== "draft";

  return (
    <Pressable
      onPress={() => router.push(href(`/work/${item.id}`))}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon color={colors.mutedForeground} size={18} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="500" numberOfLines={2}>
          {item.title}
        </Text>
        <Text variant="muted" size="xs">
          {[`${formatScore(item.points)} pts`, dueLabel(item.dueAt)].join(" · ")}
        </Text>
      </View>
      {state.kind === "graded" ? (
        <Text weight="600">
          {formatScore(state.score)}/{formatScore(item.points)}
        </Text>
      ) : state.kind === "excused" ? (
        <Badge variant="secondary">Excused</Badge>
      ) : state.kind === "missing" ? (
        <Badge variant="outline" color={colors.destructive}>
          Missing
        </Badge>
      ) : handedIn ? (
        <Badge variant="secondary">Handed in</Badge>
      ) : item.status === "closed" ? (
        <Badge variant="outline">Closed</Badge>
      ) : null}
      <ChevronRight color={colors.mutedForeground} size={16} />
    </Pressable>
  );
}

export function HomeSection({
  courseId,
  refreshKey,
  course,
  onTab,
}: SectionProps & {
  course: PortalCourseCard | null;
  onTab: (tab: CourseTab) => void;
}) {
  const work = useSection(
    () => api<PortalGradeActivity[]>(`/portal/me/courses/${courseId}/activities`),
    refreshKey,
  );
  const news = useSection(
    () => api<CourseAnnouncement[]>(`/portal/me/courses/${courseId}/announcements`),
    refreshKey,
  );

  const upcoming = (work.data ?? [])
    .filter(isOpen)
    .sort((a, b) => {
      const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return ad - bd;
    })
    .slice(0, 5);
  const recent = (news.data ?? []).slice(0, 3);
  const teachers = course ? teacherNames(course.teachers) : null;

  return (
    <View style={{ gap: 16 }}>
      {course?.description?.trim() || teachers ? (
        <Card>
          <CardContent style={{ gap: 10 }}>
            {teachers ? (
              <Text variant="muted" size="sm">
                Taught by {teachers}
              </Text>
            ) : null}
            <Markdown>{course?.description}</Markdown>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Upcoming work</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 8 }}>
          {work.loading ? (
            <Skeleton style={{ height: 60 }} />
          ) : work.failed ? (
            <Text variant="muted" size="sm">
              Work could not be loaded.
            </Text>
          ) : upcoming.length === 0 ? (
            <Text variant="muted" size="sm">
              Nothing to hand in right now.
            </Text>
          ) : (
            upcoming.map((a) => <WorkRow key={a.id} item={a} />)
          )}
          <Button variant="ghost" size="sm" onPress={() => onTab("work")}>
            All work
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent announcements</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 12 }}>
          {news.loading ? (
            <Skeleton style={{ height: 60 }} />
          ) : recent.length === 0 ? (
            <Text variant="muted" size="sm">
              No announcements yet.
            </Text>
          ) : (
            recent.map((a) => (
              <Pressable key={a.id} onPress={() => onTab("announcements")}>
                <Text weight="500">{a.title}</Text>
                <Text variant="muted" size="xs">
                  {announcementAuthor(a)} · {timeAgo(a.created_at)}
                </Text>
                {a.body ? (
                  <Text variant="muted" size="sm" numberOfLines={2}>
                    {a.body.replace(/[*_`#>]/g, "")}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
          {recent.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onTab("announcements")}
            >
              All announcements
            </Button>
          )}
        </CardContent>
      </Card>
    </View>
  );
}

export function ModulesSection({ courseId, refreshKey }: SectionProps) {
  const { open } = useOpenModuleItem(courseId, "student");
  const { data, loading, failed } = useSection(
    () => api<CourseModule[]>(`/portal/me/courses/${courseId}/modules`),
    refreshKey,
  );
  if (loading) return <Skeleton style={{ height: 240 }} />;
  if (failed || !data) return <SectionError what="Modules" />;
  return <ModuleList modules={data} onOpenItem={open} />;
}

export function WorkSection({ courseId, refreshKey }: SectionProps) {
  const { data, loading, failed } = useSection(
    () => api<PortalGradeActivity[]>(`/portal/me/courses/${courseId}/activities`),
    refreshKey,
  );
  if (loading) return <Skeleton style={{ height: 200 }} />;
  if (failed || !data) return <SectionError what="Work" />;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={NotebookPen}
        title="No work yet"
        description="Assignments and quizzes show up here once published."
      />
    );
  }
  const todo = data.filter(isOpen);
  const rest = data.filter((a) => !isOpen(a));
  return (
    <View style={{ gap: 12 }}>
      {todo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>To do</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 8 }}>
            {todo.map((a) => (
              <WorkRow key={a.id} item={a} />
            ))}
          </CardContent>
        </Card>
      )}
      {rest.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Everything else</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 8 }}>
            {rest.map((a) => (
              <WorkRow key={a.id} item={a} />
            ))}
          </CardContent>
        </Card>
      )}
    </View>
  );
}

export function GradesSection({
  courseId,
  course,
}: SectionProps & { course: PortalCourseCard | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const percent = course?.grade?.percent ?? null;
  const color = gradeColor(percent) ?? colors.mutedForeground;
  return (
    <Card>
      <CardContent style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
        <GraduationCap color={colors.mutedForeground} size={28} />
        <Text style={{ fontSize: 32, fontWeight: "700", color }}>
          {percentLabel(percent) ?? "—"}
        </Text>
        <Text variant="muted">
          {percent === null
            ? "No marks yet"
            : course?.grade?.letter
              ? `Grade ${course.grade.letter}`
              : "Course total"}
        </Text>
        {course?.grade?.dropped?.length ? (
          <Text variant="muted" size="xs">
            {course.grade.dropped.length === 1
              ? "1 mark dropped by a drop rule"
              : `${course.grade.dropped.length} marks dropped by drop rules`}
          </Text>
        ) : null}
        <Button
          style={{ marginTop: 8, alignSelf: "stretch" }}
          onPress={() => router.push(href(`/grades/${courseId}`))}
        >
          See every mark
        </Button>
      </CardContent>
    </Card>
  );
}

export function AnnouncementsSection({ courseId, refreshKey }: SectionProps) {
  const { data, loading, failed } = useSection(
    () => api<CourseAnnouncement[]>(`/portal/me/courses/${courseId}/announcements`),
    refreshKey,
  );
  if (loading) return <Skeleton style={{ height: 200 }} />;
  if (failed || !data) return <SectionError what="Announcements" />;
  return <AnnouncementList announcements={data} />;
}

export function AttendanceSection({ courseId, refreshKey }: SectionProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, loading, failed } = useSection(
    () => api<PortalCourseAttendance>(`/portal/me/courses/${courseId}/attendance`),
    refreshKey,
  );
  if (loading) return <Skeleton style={{ height: 200 }} />;
  if (failed || !data) return <SectionError what="Attendance" />;
  const s = data.summary;
  return (
    <View style={{ gap: 12 }}>
      <Button variant="outline" onPress={() => router.push(href("/attendance/scan"))}>
        Scan attendance QR
      </Button>
      <Card>
        <CardContent style={styles.summary}>
          {(
            [
              ["Rate", s.rate === null ? "—" : `${formatScore(s.rate)}%`],
              ["Present", s.present],
              ["Late", s.late],
              ["Absent", s.absent],
              ["Excused", s.excused],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={{ alignItems: "center", flex: 1 }}>
              <Text weight="700" size="lg">
                {String(value)}
              </Text>
              <Text variant="muted" size="xs">
                {label}
              </Text>
            </View>
          ))}
        </CardContent>
      </Card>
      {data.records.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No sessions yet"
          description="Each time your teacher takes attendance it shows up here."
        />
      ) : (
        <Card>
          <CardContent style={{ gap: 8 }}>
            {data.records.map((r) => (
              <View
                key={r.sessionId}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text weight="500">{r.title || formatDate(r.openedAt)}</Text>
                  {r.title ? (
                    <Text variant="muted" size="xs">
                      {formatDate(r.openedAt)}
                    </Text>
                  ) : null}
                </View>
                <Badge
                  variant={r.status === "present" ? "secondary" : "outline"}
                  color={r.status === "absent" ? colors.destructive : undefined}
                >
                  {r.status ? STATUS_LABEL[r.status] : "Not recorded"}
                </Badge>
              </View>
            ))}
          </CardContent>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summary: { flexDirection: "row", paddingVertical: 16, paddingHorizontal: 8 },
});
