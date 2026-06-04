"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Announcement } from "./types";

export function AnnouncementForm({
  announcement,
  onSuccess,
}: {
  announcement?: Announcement;
  onSuccess: () => void;
}) {
  useSignals();
  const isEdit = !!announcement;
  const title = useSignal(announcement?.title ?? "");
  const body = useSignal(announcement?.body ?? "");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.value.trim()) {
      toast.error("Title is required");
      return;
    }
    loading.value = true;
    const payload = { title: title.value.trim(), body: body.value.trim() || undefined };

    try {
      if (isEdit) {
        await api(`/announcements/${announcement.id}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Announcement updated");
      } else {
        await api("/announcements", { method: "POST", body: payload });
        toast.success("Announcement posted");
      }
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to save";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="annTitle">Title</Label>
        <Input
          id="annTitle"
          value={title.value}
          onChange={(e) => (title.value = e.target.value)}
          placeholder="e.g. Staff meeting Friday 3pm"
          maxLength={200}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="annBody">Details</Label>
        <Textarea
          id="annBody"
          value={body.value}
          onChange={(e) => (body.value = e.target.value)}
          placeholder="Write the notice…"
          rows={5}
          maxLength={5000}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={loading.value}>
          {loading.value
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : "Post announcement"}
        </Button>
      </div>
    </form>
  );
}
