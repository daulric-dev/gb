"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useProfile } from "@/providers/AuthProvider";
import { Markdown } from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { MarkdownEditor } from "../_components/MarkdownEditor";
import {
  announcementAuthor,
  type CourseAnnouncement,
} from "../_components/types";

function formatWhen(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CourseAnnouncementsPage() {
  useSignals();
  const { course, canManage } = useCourse();
  const { profile } = useProfile();
  const myId = profile.value?.id;

  const items = useSignal<CourseAnnouncement[]>([]);
  const loading = useSignal(true);
  const dialogOpen = useSignal(false);
  const editing = useSignal<CourseAnnouncement | null>(null);
  const title = useSignal("");
  const body = useSignal("");
  const saving = useSignal(false);

  const load = useCallback(() => {
    api<CourseAnnouncement[]>(`/courses/${course.id}/announcements`)
      .then((data) => (items.value = data))
      .catch(() => toast.error("Failed to load announcements"))
      .finally(() => (loading.value = false));
  }, [course.id, items, loading]);

  useEffect(() => {
    load();
  }, [load]);

  function openEditor(a: CourseAnnouncement | null) {
    editing.value = a;
    title.value = a?.title ?? "";
    body.value = a?.body ?? "";
    dialogOpen.value = true;
  }

  async function save() {
    if (!title.value.trim()) {
      toast.error("Title is required");
      return;
    }
    saving.value = true;
    const payload = { title: title.value.trim(), body: body.value.trim() };
    try {
      if (editing.value) {
        await api(`/announcements/${editing.value.id}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Announcement updated");
      } else {
        await api(`/courses/${course.id}/announcements`, {
          method: "POST",
          body: payload,
        });
        toast.success("Announcement posted");
      }
      dialogOpen.value = false;
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      saving.value = false;
    }
  }

  async function remove(a: CourseAnnouncement) {
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    try {
      await api(`/announcements/${a.id}`, { method: "DELETE" });
      toast.success("Announcement deleted");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  // Authors edit their own; teachers and admins moderate the course's.
  const canEdit = (a: CourseAnnouncement) =>
    canManage || (!!myId && a.author_user_profile_id === myId);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Announcements"
        description="News for everyone in the course"
        actions={
          <Button onClick={() => openEditor(null)}>
            <Plus className="mr-2 size-4" />
            New announcement
          </Button>
        }
      />

      {loading.value ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : items.value.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>No announcements yet</EmptyTitle>
            <EmptyDescription>
              Post reminders, changes and news for the class.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3 animate-fade-in-up-delay-1">
          {items.value.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <Avatar className="size-9">
                    {a.author?.avatar_url && (
                      <AvatarImage src={a.author.avatar_url} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {(a.author?.first_name?.[0] ?? "") +
                        (a.author?.last_name?.[0] ?? "") || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {announcementAuthor(a)} · {formatWhen(a.created_at)}
                    </p>
                  </div>
                  {canEdit(a) && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit announcement"
                        onClick={() => openEditor(a)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete announcement"
                        onClick={() => remove(a)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                {a.body?.trim() && <Markdown className="pl-12">{a.body}</Markdown>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen.value} onOpenChange={(v) => (dialogOpen.value = v)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing.value ? "Edit announcement" : "New announcement"}
            </DialogTitle>
            <DialogDescription>
              Everyone enrolled in {course.name} sees it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="annTitle">Title</Label>
              <Input
                id="annTitle"
                value={title.value}
                onChange={(e) => (title.value = e.target.value)}
                placeholder="Test moved to Friday"
                maxLength={200}
              />
            </div>
            <MarkdownEditor
              value={body.value}
              onChangeAction={(v) => (body.value = v)}
              rows={8}
              placeholder="Write the announcement..."
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (dialogOpen.value = false)}
              disabled={saving.value}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editing.value ? "Save" : "Post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
