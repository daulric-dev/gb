"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Search, Trash2, UserPlus, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  CoursePeople,
  CourseStaffMember,
  CourseStudent,
} from "@/lib/courses/types";
import { formatDate, initials, personName } from "@/lib/courses/format";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";
import { JoinCodeCard } from "./_components/JoinCodeCard";
import { AddStaffDialog } from "./_components/AddStaffDialog";
import { AddStudentsDialog } from "./_components/AddStudentsDialog";

const ROLE_ITEMS = [
  { value: "teacher", label: "Teacher" },
  { value: "ta", label: "TA" },
];

type Removal =
  | { kind: "staff"; person: CourseStaffMember }
  | { kind: "student"; person: CourseStudent };

export default function CoursePeoplePage() {
  useSignals();
  const { course, canManage, reload } = useCourse();
  const { can } = usePermissions();

  const people = useSignal<CoursePeople>({ staff: [], students: [] });
  const loading = useSignal(true);
  const search = useSignal("");
  const addStaffOpen = useSignal(false);
  const addStudentsOpen = useSignal(false);
  const removing = useSignal<Removal | null>(null);

  const load = useCallback(() => {
    api<CoursePeople>(`/courses/${course.id}/people`)
      .then((data) => (people.value = data))
      .catch(() => toast.error("Failed to load people"))
      .finally(() => (loading.value = false));
  }, [course.id, people, loading]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(member: CourseStaffMember, role: "teacher" | "ta") {
    if (role === member.role) return;
    try {
      await api(`/courses/${course.id}/staff/${member.userProfileId}`, {
        method: "PATCH",
        body: { role },
      });
      toast.success("Role updated");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update");
      load();
    }
  }

  async function confirmRemove() {
    const r = removing.value;
    if (!r) return;
    try {
      if (r.kind === "staff") {
        await api(`/courses/${course.id}/staff/${r.person.userProfileId}`, {
          method: "DELETE",
        });
      } else {
        await api(`/courses/${course.id}/students/${r.person.studentId}`, {
          method: "DELETE",
        });
      }
      toast.success("Removed from the course");
      removing.value = null;
      load();
      if (r.kind === "student") void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove");
    }
  }

  const q = search.value.trim().toLowerCase();
  const students = people.value.students
    .filter((s) => !q || personName(s).toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return personName(a).localeCompare(personName(b));
    });
  const activeCount = people.value.students.filter(
    (s) => s.status === "active",
  ).length;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="People"
        description={`${people.value.staff.length} staff · ${activeCount} students`}
        actions={
          canManage ? (
            <>
              <Button
                variant="outline"
                onClick={() => (addStaffOpen.value = true)}
              >
                <UserPlus className="mr-2 size-4" />
                Add staff
              </Button>
              <Button onClick={() => (addStudentsOpen.value = true)}>
                <Users className="mr-2 size-4" />
                Add students
              </Button>
            </>
          ) : undefined
        }
      />

      <JoinCodeCard
        courseId={course.id}
        joinCode={course.joinCode}
        canManage={canManage}
        onChangedAction={() => void reload()}
      />

      {loading.value ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <Card className="animate-fade-in-up-delay-1 gap-0 pb-0">
            <CardHeader className="border-b">
              <CardTitle>Staff</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableBody>
                  {people.value.staff.map((m) => (
                    <TableRow key={m.userProfileId}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            {m.avatarUrl && (
                              <AvatarImage src={m.avatarUrl} alt="" />
                            )}
                            <AvatarFallback className="text-xs">
                              {initials(m)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {personName(m)}
                            </p>
                            {m.email && (
                              <p className="truncate text-xs text-muted-foreground">
                                {m.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="w-36">
                        {canManage ? (
                          <Select
                            value={m.role}
                            onValueChange={(v) =>
                              void changeRole(m, v as "teacher" | "ta")
                            }
                            items={ROLE_ITEMS}
                          >
                            <SelectTrigger size="sm" className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_ITEMS.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary">
                            {m.role === "ta" ? "TA" : "Teacher"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="w-12 pr-4 text-right">
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${personName(m)}`}
                            onClick={() =>
                              (removing.value = { kind: "staff", person: m })
                            }
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up-delay-2 gap-0 pb-0">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b">
              <CardTitle>Students</CardTitle>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search students"
                  className="h-8 w-52 pl-8"
                  value={search.value}
                  onChange={(e) => (search.value = e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="px-0">
              {students.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {q
                    ? "No one matches."
                    : canManage
                      ? "No students yet. Add them from the roster, or share the join code."
                      : "No students yet."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Enrolled
                      </TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Account
                      </TableHead>
                      <TableHead className="w-12 pr-4" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((s) => (
                      <TableRow
                        key={s.studentId}
                        className={s.status !== "active" ? "opacity-60" : ""}
                      >
                        <TableCell className="pl-4 font-medium">
                          {can("student", "read") ? (
                            <Link
                              href={`/dashboard/students/${s.studentId}`}
                              className="hover:underline"
                            >
                              {personName(s)}
                            </Link>
                          ) : (
                            personName(s)
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.status === "active" ? "secondary" : "outline"
                            }
                            className="capitalize"
                          >
                            {s.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {formatDate(s.enrolledAt)}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {s.hasAccount ? "Linked" : "None"}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          {canManage && s.status === "active" && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${personName(s)}`}
                              onClick={() =>
                                (removing.value = { kind: "student", person: s })
                              }
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AddStaffDialog
        open={addStaffOpen.value}
        courseId={course.id}
        existing={people.value.staff.map((m) => m.userProfileId)}
        onOpenChangeAction={(v) => (addStaffOpen.value = v)}
        onAddedAction={load}
      />
      <AddStudentsDialog
        open={addStudentsOpen.value}
        courseId={course.id}
        enrolled={people.value.students
          .filter((s) => s.status === "active")
          .map((s) => s.studentId)}
        onOpenChangeAction={(v) => (addStudentsOpen.value = v)}
        onAddedAction={() => {
          load();
          void reload();
        }}
      />

      <AlertDialog
        open={!!removing.value}
        onOpenChange={(v) => {
          if (!v) removing.value = null;
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing.value ? personName(removing.value.person) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing.value?.kind === "student"
                ? "They are dropped from the course. Their submissions and marks are kept, and enrolling them again restores access."
                : "They lose access to this course."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
