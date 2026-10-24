"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { DiscussionTopic } from "@/lib/courses/discussions";
import { MarkdownEditor } from "@/app/dashboard/courses/[courseId]/_components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Editable = Pick<
  DiscussionTopic,
  "id" | "title" | "body" | "isPinned" | "isLocked" | "isPublished" | "requireInitialPost"
>;

/**
 * Start or edit a topic. Staff also get the topic settings; a student's
 * topic is always a plain published thread.
 */
export function TopicEditorDialog({
  open,
  onOpenChangeAction,
  apiBase,
  topic,
  isStaff,
  onSavedAction,
}: {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  /** `/courses/:id/discussions` or `/portal/me/courses/:id/discussions`. */
  apiBase: string;
  /** The topic being edited; null starts a new one. */
  topic: Editable | null;
  isStaff: boolean;
  onSavedAction: (topic: DiscussionTopic) => void;
}) {
  useSignals();
  const title = useSignal("");
  const body = useSignal("");
  const isPinned = useSignal(false);
  const isLocked = useSignal(false);
  const isPublished = useSignal(true);
  const requireInitialPost = useSignal(false);
  const saving = useSignal(false);

  useEffect(() => {
    if (!open) return;
    title.value = topic?.title ?? "";
    body.value = topic?.body ?? "";
    isPinned.value = topic?.isPinned ?? false;
    isLocked.value = topic?.isLocked ?? false;
    isPublished.value = topic?.isPublished ?? true;
    requireInitialPost.value = topic?.requireInitialPost ?? false;
  }, [open, topic, title, body, isPinned, isLocked, isPublished, requireInitialPost]);

  async function save() {
    if (!title.value.trim()) {
      toast.error("Title is required");
      return;
    }
    saving.value = true;
    const payload = {
      title: title.value.trim(),
      body: body.value,
      ...(isStaff
        ? {
            isPinned: isPinned.value,
            isLocked: isLocked.value,
            isPublished: isPublished.value,
            requireInitialPost: requireInitialPost.value,
          }
        : {}),
    };
    try {
      const saved = await api<DiscussionTopic>(
        topic ? `${apiBase}/${topic.id}` : apiBase,
        { method: topic ? "PATCH" : "POST", body: payload },
      );
      toast.success(topic ? "Topic updated" : "Topic posted");
      onOpenChangeAction(false);
      onSavedAction(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      saving.value = false;
    }
  }

  const flag = (
    id: string,
    label: string,
    hint: string,
    value: { value: boolean },
  ) => (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        checked={value.value}
        onCheckedChange={(v) => (value.value = v)}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{topic ? "Edit topic" : "New topic"}</DialogTitle>
          <DialogDescription>
            Everyone in the course can read and reply.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="topicTitle">Title</Label>
            <Input
              id="topicTitle"
              value={title.value}
              onChange={(e) => (title.value = e.target.value)}
              placeholder="What did you notice in the lab?"
              maxLength={200}
            />
          </div>
          <MarkdownEditor
            value={body.value}
            onChangeAction={(v) => (body.value = v)}
            rows={8}
            placeholder="Set out the question or prompt..."
          />
          {isStaff && (
            <div className="space-y-3 rounded-lg border p-3">
              {flag("topicPublished", "Published", "Students see it once published.", isPublished)}
              {flag("topicPinned", "Pinned", "Keep it at the top of the list.", isPinned)}
              {flag("topicLocked", "Locked", "No new replies.", isLocked)}
              {flag(
                "topicPostFirst",
                "Post before seeing replies",
                "Students see classmates' replies after posting their own.",
                requireInitialPost,
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={saving.value}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            {topic ? "Save" : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
