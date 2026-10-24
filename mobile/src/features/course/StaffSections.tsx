import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ChevronRight,
  ClipboardList,
  FileText,
  Monitor,
  NotebookPen,
  PenLine,
  Plus,
  Users,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTheme } from "@/theme/ThemeProvider";
import { dueLabel } from "@/lib/work";
import { formatScore } from "@/lib/format-number";
import { dropRuleLabel, gradeColor, percentLabel } from "@/lib/grades";
import { GradeBar } from "@/features/grades/GradeBits";
import { AnnouncementForm } from "@/features/announcements/AnnouncementForm";
import {
  canManage,
  errorMessage,
  href,
  initials,
  type CourseAnnouncement,
  type CourseModule,
  type CoursePeople,
  type Gradebook,
  type StaffActivity,
  type StaffCourse,
} from "@/lib/course";
import { ModuleList } from "./ModuleList";
import { AnnouncementList } from "./AnnouncementList";
import { useSection } from "./useSection";
import { useOpenModuleItem } from "./useOpenModuleItem";

interface SectionProps {
  course: StaffCourse;
  refreshKey: number;
}

/** "Build this on the web" note, for what mobile only shows. */
export function WebHint({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.hint}>
      <Monitor color={colors.mutedForeground} size={14} />
      <Text variant="muted" size="xs" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
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

function kindIcon(kind: StaffActivity["kind"]) {
  return kind === "quiz" ? ClipboardList : kind === "offline" ? PenLine : FileText;
}

export function StaffModulesSection({ course, refreshKey }: SectionProps) {
  const toast = useToast();
  const { open } = useOpenModuleItem(course.id, "staff");
  const [toggling, setToggling] = useState<string | null>(null);
  const { data, loading, failed, reload } = useSection(
    () => api<CourseModule[]>(`/courses/${course.id}/modules`),
    refreshKey,
  );
  const manage = canManage(course.role);

  async function toggle(m: CourseModule) {
    setToggling(m.id);
    try {
      await api(`/courses/${course.id}/modules/${m.id}`, {
        method: "PATCH",
        body: { isPublished: !m.isPublished },
      });
      toast.success(m.isPublished ? "Module unpublished" : "Module published");
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update the module"));
    } finally {
      setToggling(null);
    }
  }

  if (loading) return <Skeleton style={{ height: 240 }} />;
  if (failed || !data) return <SectionError what="Modules" />;
  return (
    <View style={{ gap: 12 }}>
      <WebHint>
        Add modules, pages and items on the web app. Here you can read them
        {manage ? " and publish or unpublish a module" : ""}.
      </WebHint>
      <ModuleList
        modules={data}
        onOpenItem={open}
        staff
        onTogglePublish={manage ? toggle : undefined}
        togglingId={toggling}
      />
    </View>
  );
}

export function StaffWorkSection({ course, refreshKey }: SectionProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, loading, failed } = useSection(
    () => api<StaffActivity[]>(`/courses/${course.id}/activities`),
    refreshKey,
  );
  if (loading) return <Skeleton style={{ height: 240 }} />;
  if (failed || !data) return <SectionError what="Work" />;
  return (
    <View style={{ gap: 12 }}>
      <WebHint>Create assignments, quizzes and rubrics on the web app.</WebHint>
      {data.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="No work yet"
          description="Activities you create on the web show up here for marking."
        />
      ) : (
        <Card>
          <CardContent style={{ gap: 8 }}>
            {data.map((a) => {
              const Icon = kindIcon(a.kind);
              return (
                <Pressable
                  key={a.id}
                  onPress={() =>
                    router.push(href(`/teaching/${course.id}/activity/${a.id}`))
                  }
                  style={({ pressed }) => [
                    styles.row,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Icon color={colors.mutedForeground} size={18} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="500" numberOfLines={2}>
                      {a.title}
                    </Text>
                    <Text variant="muted" size="xs">
                      {[`${formatScore(a.points)} pts`, dueLabel(a.dueAt)].join(
                        " · ",
                      )}
                    </Text>
                  </View>
                  {a.status !== "published" && (
                    <Badge variant="secondary">
                      {a.status === "draft" ? "Draft" : "Closed"}
                    </Badge>
                  )}
                  <ChevronRight color={colors.mutedForeground} size={16} />
                </Pressable>
              );
            })}
          </CardContent>
        </Card>
      )}
    </View>
  );
}

export function StaffAnnouncementsSection({ course, refreshKey }: SectionProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const base = `/courses/${course.id}/announcements`;
  const { data, loading, failed, reload } = useSection(
    () => api<CourseAnnouncement[]>(base),
    refreshKey,
  );
  const [editing, setEditing] = useState<CourseAnnouncement | "new" | null>(null);
  const [deleting, setDeleting] = useState<CourseAnnouncement | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`${base}/${deleting.id}`, { method: "DELETE" });
      toast.success("Announcement deleted");
      setDeleting(null);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton style={{ height: 200 }} />;
  if (failed || !data) return <SectionError what="Announcements" />;

  const archived = course.status === "archived";
  return (
    <View style={{ gap: 12 }}>
      {!archived && (
        <Button
          icon={<Plus color={colors.primaryForeground} size={16} />}
          onPress={() => setEditing("new")}
        >
          New announcement
        </Button>
      )}
      <AnnouncementList
        announcements={data}
        canChange={(a) =>
          !archived &&
          (canManage(course.role) || a.author_user_profile_id === profile?.id)
        }
        onEdit={(a) => setEditing(a)}
        onDelete={(a) => setDeleting(a)}
        emptyHint="Post news for the course; students get a push."
      />
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New announcement" : "Edit announcement"}
        description={
          editing === "new" ? "Everyone in the course is notified." : undefined
        }
      >
        {editing !== null && (
          <AnnouncementForm
            basePath={base}
            announcement={editing === "new" ? undefined : editing}
            onSuccess={() => {
              setEditing(null);
              void reload();
            }}
          />
        )}
      </Sheet>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this announcement?"
        message={deleting?.title}
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </View>
  );
}

export function StaffPeopleSection({ course, refreshKey }: SectionProps) {
  const { colors } = useTheme();
  const { data, loading, failed } = useSection(
    () => api<CoursePeople>(`/courses/${course.id}/people`),
    refreshKey,
  );
  if (loading) return <Skeleton style={{ height: 240 }} />;
  if (failed || !data) return <SectionError what="People" />;
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 10, paddingTop: 8 }}>
          {data.staff.map((s) => (
            <View key={s.userProfileId} style={styles.person}>
              <Avatar
                uri={s.avatarUrl}
                fallback={initials(s.firstName, s.lastName)}
                size={32}
              />
              <View style={{ flex: 1 }}>
                <Text weight="500">
                  {[s.firstName, s.lastName].filter(Boolean).join(" ") ||
                    s.email}
                </Text>
                {s.email ? (
                  <Text variant="muted" size="xs">
                    {s.email}
                  </Text>
                ) : null}
              </View>
              <Badge variant="secondary">
                {s.role === "ta" ? "TA" : "Teacher"}
              </Badge>
            </View>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{`Students (${data.students.length})`}</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 10, paddingTop: 8 }}>
          {data.students.length === 0 ? (
            <Text variant="muted" size="sm">
              No students yet. Share the join code or add them on the web.
            </Text>
          ) : (
            data.students.map((s) => (
              <View key={s.studentId} style={styles.person}>
                <Avatar fallback={initials(s.firstName, s.lastName)} size={32} />
                <Text weight="500" style={{ flex: 1 }}>
                  {[s.firstName, s.lastName].filter(Boolean).join(" ")}
                </Text>
                {s.status !== "active" && (
                  <Badge variant="outline">{s.status}</Badge>
                )}
                {!s.hasAccount && (
                  <Text variant="muted" size="xs" style={{ color: colors.mutedForeground }}>
                    No account
                  </Text>
                )}
              </View>
            ))
          )}
        </CardContent>
      </Card>
      <WebHint>Add or remove people on the web app.</WebHint>
    </View>
  );
}

export function StaffGradebookSection({ course, refreshKey }: SectionProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { data, loading, failed } = useSection(
    () => api<Gradebook>(`/courses/${course.id}/gradebook`),
    refreshKey,
  );
  const [selected, setSelected] = useState<string | null>(null);

  if (loading) return <Skeleton style={{ height: 240 }} />;
  if (failed || !data) return <SectionError what="The gradebook" />;
  if (data.students.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No students yet"
        description="Totals appear once students are enrolled."
      />
    );
  }

  const student = data.students.find((s) => s.studentId === selected) ?? null;

  return (
    <View style={{ gap: 12 }}>
      <WebHint>
        Read-only here. Mark from the Work tab; import, export and weights are
        on the web app.
      </WebHint>
      <Card>
        <CardContent style={{ gap: 8 }}>
          {data.students.map((s) => {
            const p = s.grade.percent;
            return (
              <Pressable
                key={s.studentId}
                onPress={() => setSelected(s.studentId)}
                style={({ pressed }) => [
                  styles.row,
                  { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text weight="500" numberOfLines={1}>
                    {[s.firstName, s.lastName].filter(Boolean).join(" ")}
                  </Text>
                  <GradeBar percent={p} height={4} />
                </View>
                <Text
                  weight="600"
                  style={{ color: gradeColor(p) ?? colors.mutedForeground }}
                >
                  {percentLabel(p) ?? "—"}
                </Text>
                {s.grade.letter && p !== null ? (
                  <Badge variant="outline" color={gradeColor(p) ?? undefined}>
                    {s.grade.letter}
                  </Badge>
                ) : null}
                <ChevronRight color={colors.mutedForeground} size={16} />
              </Pressable>
            );
          })}
        </CardContent>
      </Card>

      <Sheet
        open={student !== null}
        onClose={() => setSelected(null)}
        title={
          student
            ? [student.firstName, student.lastName].filter(Boolean).join(" ")
            : undefined
        }
        description={
          student
            ? `${percentLabel(student.grade.percent) ?? "No marks yet"}${
                student.grade.letter && student.grade.percent !== null
                  ? ` · ${student.grade.letter}`
                  : ""
              }`
            : undefined
        }
      >
        {student && (
          <View style={{ gap: 16 }}>
            {student.grade.groups.length > 0 && (
              <View style={{ gap: 10 }}>
                {student.grade.groups.map((g) => {
                  const rule = dropRuleLabel(
                    data.groups.find((x) => x.id === g.groupId),
                  );
                  return (
                    <View key={g.groupId ?? g.name} style={{ gap: 4 }}>
                      <View style={styles.between}>
                        <View style={{ flex: 1 }}>
                          <Text weight="500" size="sm">
                            {g.name}
                            {g.weight !== null ? ` (${formatScore(g.weight)}%)` : ""}
                          </Text>
                          {rule ? (
                            <Text variant="muted" size="xs">
                              {rule}
                            </Text>
                          ) : null}
                        </View>
                        <Text size="sm" weight="600">
                          {percentLabel(g.percent) ?? "—"}
                        </Text>
                      </View>
                      <GradeBar percent={g.percent} height={4} />
                    </View>
                  );
                })}
              </View>
            )}
            <View style={{ gap: 6 }}>
              {data.activities.map((a) => {
                const cell = student.cells[a.id];
                const dropped =
                  !!cell?.dropped || !!student.grade.dropped?.includes(a.id);
                const label = cell?.excused
                  ? "Excused"
                  : cell?.score !== null && cell?.score !== undefined
                    ? `${formatScore(cell.score)}/${formatScore(a.points)}`
                    : cell && cell.status !== "draft"
                      ? "To mark"
                      : "—";
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => {
                      const id = student.studentId;
                      setSelected(null);
                      router.push(
                        href(`/teaching/${course.id}/mark/${a.id}/${id}`),
                      );
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text size="sm" style={{ flex: 1 }} numberOfLines={2}>
                      {a.title}
                    </Text>
                    {dropped ? <Badge variant="secondary">Dropped</Badge> : null}
                    <Text
                      size="sm"
                      weight="600"
                      style={
                        dropped
                          ? {
                              color: colors.mutedForeground,
                              textDecorationLine: "line-through",
                            }
                          : undefined
                      }
                    >
                      {label}
                    </Text>
                    <ChevronRight color={colors.mutedForeground} size={14} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { flexDirection: "row", alignItems: "center", gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  person: { flexDirection: "row", alignItems: "center", gap: 10 },
  between: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
});
