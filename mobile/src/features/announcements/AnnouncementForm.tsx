import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import type { Announcement } from "./types";

/**
 * Create or edit an announcement. Pass `announcement` to edit; otherwise a new
 * one is posted. Mirrors the web AnnouncementForm.
 */
export function AnnouncementForm({
  announcement,
  onSuccess,
}: {
  announcement?: Announcement;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const isEdit = !!announcement;

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setLoading(true);
    const payload = {
      title: title.trim(),
      body: body.trim() || undefined,
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
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Label>Title</Label>
        <Input
          placeholder="e.g. Staff meeting Friday 3pm"
          value={title}
          onChangeText={setTitle}
          maxLength={200}
        />
      </View>
      <View style={{ gap: 6 }}>
        <Label>Details</Label>
        <TextArea
          placeholder="Write the notice…"
          value={body}
          onChangeText={setBody}
          numberOfLines={5}
          maxLength={5000}
        />
      </View>
      <Button onPress={submit} loading={loading}>
        {isEdit ? "Save changes" : "Post announcement"}
      </Button>
    </View>
  );
}
