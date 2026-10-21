"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ChevronRight, ClipboardList, Plus, Scale, SlashIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { Activity, AssignmentGroup } from "@/lib/courses/types";
import { ACTIVITY_KIND_LABEL, formatDue } from "@/lib/courses/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";
import { CreateActivityDialog } from "./_components/CreateActivityDialog";
import { AssignmentGroupsDialog } from "./_components/AssignmentGroupsDialog";
import {
  ACTIVITY_ICON,
  ActivityStatusBadge,
} from "./_components/ActivityStatusBadge";

function sortByDue(a: Activity, b: Activity) {
  if (a.dueAt && b.dueAt) {
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  }
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export default function CourseAssignmentsPage() {
  useSignals();
  const { course, base, canManage } = useCourse();

  const activities = useSignal<Activity[]>([]);
  const groups = useSignal<AssignmentGroup[]>([]);
  const loading = useSignal(true);
  const creating = useSignal(false);
  const createGroupId = useSignal<string | null>(null);
  const createKey = useSignal(0);
  const groupsOpen = useSignal(false);

  const loadGroups = useCallback(() => {
    return api<AssignmentGroup[]>(`/courses/${course.id}/assignment-groups`)
      .then((data) => (groups.value = data))
      .catch(() => (groups.value = []));
  }, [course.id, groups]);

  useEffect(() => {
    void Promise.all([
      api<Activity[]>(`/courses/${course.id}/activities`)
        .then((data) => (activities.value = data))
        .catch(() => toast.error("Failed to load assignments")),
      loadGroups(),
    ]).finally(() => (loading.value = false));
  }, [course.id, activities, loading, loadGroups]);

  function openCreate(groupId: string | null) {
    createGroupId.value = groupId;
    createKey.value += 1;
    creating.value = true;
  }

  const sections: {
    id: string | null;
    name: string;
    weight: number | null;
    items: Activity[];
  }[] = [
    ...[...groups.value]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({
        id: g.id,
        name: g.name,
        weight: g.weight,
        items: activities.value
          .filter((a) => a.assignmentGroupId === g.id)
          .sort(sortByDue),
      })),
  ];
  const known = new Set(groups.value.map((g) => g.id));
  const ungrouped = activities.value
    .filter((a) => !a.assignmentGroupId || !known.has(a.assignmentGroupId))
    .sort(sortByDue);
  if (ungrouped.length > 0 || groups.value.length === 0) {
    sections.push({
      id: null,
      name: groups.value.length ? "Ungrouped" : "Assignments",
      weight: null,
      items: ungrouped,
    });
  }

  const totalPoints = activities.value
    .filter((a) => !a.omitFromFinalGrade)
    .reduce((s, a) => s + a.points, 0);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Assignments"
        description={
          activities.value.length
            ? `${activities.value.length} items · ${totalPoints} points counted`
            : "Quizzes, assignments and offline work"
        }
        actions={
          <>
            <Button variant="outline" onClick={() => (groupsOpen.value = true)}>
              <Scale className="mr-2 size-4" />
              Groups
              {groups.value.some((g) => g.weight !== null) && (
                <Badge variant="secondary" className="ml-1">
                  Weighted
                </Badge>
              )}
            </Button>
            {canManage && (
              <Button onClick={() => openCreate(null)}>
                <Plus className="mr-2 size-4" />
                New
              </Button>
            )}
          </>
        }
      />

      {loading.value ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ))}
        </div>
      ) : activities.value.length === 0 && groups.value.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>Nothing set yet</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Create a quiz, an assignment, or an offline test to record marks for."
                : "Work the teacher sets will appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-4 animate-fade-in-up-delay-1">
          {sections.map((section) => (
            <Card key={section.id ?? "ungrouped"} className="gap-0 py-0">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
                <h3 className="font-semibold">{section.name}</h3>
                {section.weight !== null && (
                  <Badge variant="outline">{section.weight}% of total</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {section.items.length}{" "}
                  {section.items.length === 1 ? "item" : "items"}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Add to ${section.name}`}
                    onClick={() => openCreate(section.id)}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </div>
              {section.items.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">
                  No work in this group yet.
                </p>
              ) : (
                <div className="divide-y">
                  {section.items.map((a) => {
                    const Icon = ACTIVITY_ICON[a.kind];
                    return (
                      <Link
                        key={a.id}
                        href={`${base}/assignments/${a.id}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                      >
                        <Icon
                          className={
                            a.status === "draft"
                              ? "size-5 shrink-0 text-muted-foreground"
                              : "size-5 shrink-0 text-emerald-600 dark:text-emerald-500"
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{a.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {ACTIVITY_KIND_LABEL[a.kind]} · {formatDue(a.dueAt)}{" "}
                            · {a.points} pts
                          </p>
                        </div>
                        {a.omitFromFinalGrade && (
                          <span
                            className="hidden items-center gap-1 text-xs text-amber-600 sm:flex dark:text-amber-500"
                            title="Not counted toward the final grade"
                          >
                            <SlashIcon className="size-3.5" />
                            Not counted
                          </span>
                        )}
                        <ActivityStatusBadge status={a.status} />
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <CreateActivityDialog
        key={createKey.value}
        open={creating.value}
        courseId={course.id}
        groups={groups.value}
        defaultGroupId={createGroupId.value}
        onOpenChangeAction={(v) => (creating.value = v)}
      />

      <AssignmentGroupsDialog
        open={groupsOpen.value}
        courseId={course.id}
        groups={[...groups.value].sort((a, b) => a.position - b.position)}
        canEdit={canManage}
        onOpenChangeAction={(v) => (groupsOpen.value = v)}
        onChangedAction={() => void loadGroups()}
      />
    </div>
  );
}
