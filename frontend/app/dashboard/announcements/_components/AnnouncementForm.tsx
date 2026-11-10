"use client";

import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ANNOUNCEMENT_AUDIENCES,
  AUDIENCE_LABELS,
  audienceOf,
  type AnnouncementAudience,
} from "@/lib/announcement-audience";
import type { Announcement } from "./types";
import { userMessage } from "@/lib/errors";

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
  const audience = useSignal<AnnouncementAudience>(
    audienceOf(announcement?.audience),
  );
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.value.trim()) {
      toast.error("Title is required");
      return;
    }
    loading.value = true;
    const payload = {
      title: title.value.trim(),
      body: body.value.trim() || undefined,
      audience: audience.value,
    };

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
      const msg = userMessage(err, "Failed to save");
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
      <div className="space-y-2">
        <Label id="annAudienceLabel">Who can see this?</Label>
        <RadioGroup
          aria-labelledby="annAudienceLabel"
          value={audience.value}
          onValueChange={(v) => (audience.value = audienceOf(v))}
          className="grid-cols-1"
        >
          {ANNOUNCEMENT_AUDIENCES.map((value) => (
            <Label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-primary/5"
            >
              <RadioGroupItem value={value} />
              {AUDIENCE_LABELS[value]}
            </Label>
          ))}
        </RadioGroup>
        {audience.value === "everyone" && (
          <p className="text-xs text-muted-foreground">
            Students see it in their portal and get a push notification;
            parents see it in the parent portal if your school shows them
            announcements. Read receipts only count staff.
          </p>
        )}
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
