"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ChevronRight, FileText, Loader2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CoursePage, CoursePageSummary } from "@/lib/courses/types";
import { formatDate } from "@/lib/courses/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";

export default function CoursePagesPage() {
  useSignals();
  const router = useRouter();
  const { course, base, canManage } = useCourse();

  const pages = useSignal<CoursePageSummary[]>([]);
  const loading = useSignal(true);
  const creating = useSignal(false);
  const saving = useSignal(false);
  const newTitle = useSignal("");

  const load = useCallback(() => {
    api<CoursePageSummary[]>(`/courses/${course.id}/pages`)
      .then((data) => (pages.value = data))
      .catch(() => toast.error("Failed to load pages"))
      .finally(() => (loading.value = false));
  }, [course.id, pages, loading]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.value.trim()) return;
    saving.value = true;
    try {
      const page = await api<CoursePage>(`/courses/${course.id}/pages`, {
        method: "POST",
        body: { title: newTitle.value.trim(), body: "", isPublished: false },
      });
      creating.value = false;
      router.push(`${base}/pages/${page.id}?edit=1`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      saving.value = false;
    }
  }

  async function togglePublished(page: CoursePageSummary, isPublished: boolean) {
    pages.value = pages.value.map((p) =>
      p.id === page.id ? { ...p, isPublished } : p,
    );
    try {
      await api(`/courses/${course.id}/pages/${page.id}`, {
        method: "PATCH",
        body: { isPublished },
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
      load();
    }
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Pages"
        description="Reading, notes and resources written in Markdown"
        actions={
          canManage ? (
            <Button
              onClick={() => {
                newTitle.value = "";
                creating.value = true;
              }}
            >
              <Plus className="mr-2 size-4" />
              New page
            </Button>
          ) : undefined
        }
      />

      {loading.value ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : pages.value.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No pages yet</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Write a page for notes, a syllabus or reading, then add it to a module."
                : "Pages the teacher writes will appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="animate-fade-in-up-delay-1 gap-0 divide-y py-0">
          {pages.value.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <Link
                href={`${base}/pages/${p.id}`}
                className="min-w-0 flex-1"
              >
                <p className="truncate font-medium hover:underline">
                  {p.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  Updated {formatDate(p.updatedAt)}
                </p>
              </Link>
              {canManage ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {p.isPublished ? "Published" : "Unpublished"}
                  <Switch
                    checked={p.isPublished}
                    onCheckedChange={(v) => void togglePublished(p, v)}
                    aria-label="Published"
                  />
                </label>
              ) : (
                !p.isPublished && (
                  <span className="text-xs text-muted-foreground">
                    Unpublished
                  </span>
                )
              )}
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          ))}
        </Card>
      )}

      <Dialog open={creating.value} onOpenChange={(v) => (creating.value = v)}>
        <DialogContent>
          <form onSubmit={create} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New page</DialogTitle>
              <DialogDescription>
                It starts unpublished. You can write it straight away.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="pageTitle">Title</Label>
              <Input
                id="pageTitle"
                placeholder="Week 1 reading"
                value={newTitle.value}
                onChange={(e) => (newTitle.value = e.target.value)}
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => (creating.value = false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving.value}>
                {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
