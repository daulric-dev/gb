"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CoursePage } from "@/lib/courses/types";
import { formatDate } from "@/lib/courses/format";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { useCourse } from "../../_components/course-context";
import { MarkdownEditor } from "../../_components/MarkdownEditor";

export default function CoursePageDetail() {
  useSignals();
  const router = useRouter();
  const params = useParams<{ pageId: string }>();
  const pageId = params?.pageId ?? "";
  const { course, base, canManage } = useCourse();

  const page = useSignal<CoursePage | null>(null);
  const loading = useSignal(true);
  const editing = useSignal(false);
  const saving = useSignal(false);
  const confirmDelete = useSignal(false);
  const draftTitle = useSignal("");
  const draftBody = useSignal("");

  const startEditing = useCallback(
    (p: CoursePage) => {
      draftTitle.value = p.title;
      draftBody.value = p.body ?? "";
      editing.value = true;
    },
    [draftTitle, draftBody, editing],
  );

  useEffect(() => {
    if (!pageId) return;
    api<CoursePage>(`/courses/${course.id}/pages/${pageId}`)
      .then((data) => {
        page.value = data;
        // A freshly created page opens straight into the editor.
        const wantsEdit =
          new URLSearchParams(window.location.search).get("edit") === "1";
        if (wantsEdit && canManage) startEditing(data);
      })
      .catch(() => (page.value = null))
      .finally(() => (loading.value = false));
  }, [course.id, pageId, canManage, page, loading, startEditing]);

  async function save() {
    if (!draftTitle.value.trim()) {
      toast.error("Give the page a title");
      return;
    }
    saving.value = true;
    try {
      const updated = await api<CoursePage>(
        `/courses/${course.id}/pages/${pageId}`,
        {
          method: "PATCH",
          body: { title: draftTitle.value.trim(), body: draftBody.value },
        },
      );
      page.value = { ...page.value!, ...updated, body: draftBody.value };
      editing.value = false;
      router.replace(`${base}/pages/${pageId}`);
      toast.success("Page saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      saving.value = false;
    }
  }

  async function setPublished(isPublished: boolean) {
    if (!page.value) return;
    page.value = { ...page.value, isPublished };
    try {
      await api(`/courses/${course.id}/pages/${pageId}`, {
        method: "PATCH",
        body: { isPublished },
      });
      toast.success(isPublished ? "Published" : "Unpublished");
    } catch (err) {
      page.value = { ...page.value, isPublished: !isPublished };
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    }
  }

  async function remove() {
    try {
      await api(`/courses/${course.id}/pages/${pageId}`, { method: "DELETE" });
      toast.success("Page deleted");
      router.push(`${base}/pages`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 text-muted-foreground"
      onClick={() => router.push(`${base}/pages`)}
    >
      <ArrowLeft className="mr-1.5 size-4" />
      Pages
    </Button>
  );

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!page.value) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            This page could not be found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const p = page.value;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        {canManage && !editing.value && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {p.isPublished ? "Published" : "Unpublished"}
              <Switch
                checked={p.isPublished}
                onCheckedChange={(v) => void setPublished(v)}
              />
            </label>
            <Button variant="outline" onClick={() => startEditing(p)}>
              <Pencil className="mr-2 size-4" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete page"
              onClick={() => (confirmDelete.value = true)}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {editing.value ? (
        <Card className="animate-fade-in-up">
          <CardContent className="space-y-4">
            <Input
              aria-label="Title"
              value={draftTitle.value}
              onChange={(e) => (draftTitle.value = e.target.value)}
              className="h-10 text-lg font-semibold"
            />
            <MarkdownEditor
              value={draftBody.value}
              onChangeAction={(v) => (draftBody.value = v)}
              rows={18}
              placeholder="Write the page..."
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={saving.value}
                onClick={() => {
                  editing.value = false;
                  router.replace(`${base}/pages/${pageId}`);
                }}
              >
                Cancel
              </Button>
              <Button onClick={save} disabled={saving.value}>
                {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save page
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="animate-fade-in-up">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 border-b pb-3">
              <h2 className="text-2xl font-bold">{p.title}</h2>
              {!p.isPublished && <Badge variant="secondary">Unpublished</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">
                Updated {formatDate(p.updatedAt)}
              </span>
            </div>
            {p.body?.trim() ? (
              <Markdown className="text-base">{p.body}</Markdown>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                This page is empty.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={confirmDelete.value}
        onOpenChange={(v) => (confirmDelete.value = v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this page?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{p.title}&rdquo; is removed, along with any module items
              that link to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
