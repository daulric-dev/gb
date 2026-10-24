"use client";

import { useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Inbox,
  Layers,
  Loader2,
  Megaphone,
  Send,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Activity, CourseModule } from "@/lib/courses/types";
import { ACTIVITY_KIND_LABEL, formatDate, formatDue } from "@/lib/courses/format";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCourse } from "./_components/course-context";
import {
  announcementAuthor,
  type CourseAnnouncement,
} from "./_components/types";

function Stat({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  loading?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div>
          {loading ? (
            <Skeleton className="h-6 w-10" />
          ) : (
            <p className="text-xl font-semibold leading-tight">{value}</p>
          )}
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CourseHomePage() {
  useSignals();
  const { course, base, canManage, reload } = useCourse();

  const activities = useSignal<Activity[]>([]);
  const modules = useSignal<CourseModule[]>([]);
  const announcements = useSignal<CourseAnnouncement[]>([]);
  const upcoming = useSignal<Activity[]>([]);
  const loading = useSignal(true);
  const publishing = useSignal(false);

  useEffect(() => {
    void Promise.all([
      api<Activity[]>(`/courses/${course.id}/activities`).catch(
        () => [] as Activity[],
      ),
      api<CourseModule[]>(`/courses/${course.id}/modules`).catch(
        () => [] as CourseModule[],
      ),
      api<CourseAnnouncement[]>(`/courses/${course.id}/announcements`).catch(
        () => [] as CourseAnnouncement[],
      ),
    ]).then(([a, m, n]) => {
      activities.value = a;
      const now = Date.now();
      upcoming.value = a
        .filter(
          (x) =>
            x.status !== "draft" &&
            x.dueAt &&
            new Date(x.dueAt).getTime() >= now,
        )
        .sort(
          (x, y) =>
            new Date(x.dueAt!).getTime() - new Date(y.dueAt!).getTime(),
        )
        .slice(0, 5);
      modules.value = m;
      announcements.value = n;
      loading.value = false;
    });
  }, [course.id, activities, upcoming, modules, announcements, loading]);

  async function publish() {
    publishing.value = true;
    try {
      await api(`/courses/${course.id}`, {
        method: "PATCH",
        body: { status: "published" },
      });
      toast.success("Published. Enrolled students can see it now.");
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to publish");
    } finally {
      publishing.value = false;
    }
  }

  const drafts = activities.value.filter((a) => a.status === "draft").length;

  return (
    <div className="space-y-6">
      {course.status === "draft" && (
        <Card className="animate-fade-in-up border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">This course is a draft</p>
              <p className="text-sm text-muted-foreground">
                Students cannot see it yet. Publish when it is ready.
              </p>
            </div>
            {canManage && (
              <Button onClick={publish} disabled={publishing.value}>
                {publishing.value ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                Publish course
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {course.status === "archived" && (
        <Card className="animate-fade-in-up bg-muted/50">
          <CardContent className="text-sm text-muted-foreground">
            This course is archived. It is read-only for students and kept for
            the record.
          </CardContent>
        </Card>
      )}

      <div className="grid animate-fade-in-up-delay-1 grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Students" value={course.studentCount} />
        <Stat
          icon={Layers}
          label="Modules"
          value={modules.value.length}
          loading={loading.value}
        />
        <Stat
          icon={ClipboardList}
          label={drafts ? `Assignments (${drafts} draft)` : "Assignments"}
          value={activities.value.length}
          loading={loading.value}
        />
        <Stat
          icon={Megaphone}
          label="Announcements"
          value={announcements.value.length}
          loading={loading.value}
        />
      </div>

      <div className="grid animate-fade-in-up-delay-2 gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>About this course</CardTitle>
          </CardHeader>
          <CardContent>
            {course.description?.trim() ? (
              <Markdown>{course.description}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">
                No description yet.
                {canManage && (
                  <>
                    {" "}
                    <Link
                      href={`${base}/settings`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Add one in Settings.
                    </Link>
                  </>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarClock className="size-4" />
                Coming up
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {loading.value ? (
                <Skeleton className="h-16 w-full" />
              ) : upcoming.value.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Nothing due soon.
                </p>
              ) : (
                upcoming.value.map((a) => (
                  <Link
                    key={a.id}
                    href={`${base}/assignments/${a.id}`}
                    className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {ACTIVITY_KIND_LABEL[a.kind]} · {formatDue(a.dueAt)}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Megaphone className="size-4" />
                Recent announcements
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {loading.value ? (
                <Skeleton className="h-16 w-full" />
              ) : announcements.value.length === 0 ? (
                <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Inbox className="size-4" />
                  None yet.
                </p>
              ) : (
                announcements.value.slice(0, 3).map((a) => (
                  <Link
                    key={a.id}
                    href={`${base}/announcements`}
                    className="-mx-2 block rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {announcementAuthor(a)} · {formatDate(a.created_at)}
                    </p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
