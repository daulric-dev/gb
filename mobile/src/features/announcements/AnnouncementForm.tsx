import { useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { Text } from "@/components/ui/Text";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  AUDIENCE_OPTIONS,
  audienceOf,
  type AnnouncementAudience,
} from "@/lib/announcement-audience";
import type { Announcement } from "./types";
import { userMessage } from "@/lib/errors";

/**
 * Create or edit an announcement. Pass `announcement` to edit; otherwise a new
 * one is posted. Mirrors the web AnnouncementForm.
 */
export function AnnouncementForm({
  announcement,
  onSuccess,
  basePath = "/announcements",
}: {
  announcement?: Pick<Announcement, "id" | "title" | "body" | "audience">;
  onSuccess: () => void;
  /** Collection route; a course passes `/courses/:courseId/announcements`. */
  basePath?: string;
}) {
  // Only school-wide posts have an audience; course posts go to the course.
  const schoolWide = basePath === "/announcements";
  const toast = useToast();
  const isEdit = !!announcement;

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [audience, setAudience] = useState<AnnouncementAudience>(
    audienceOf(announcement?.audience),
  );
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
      ...(schoolWide ? { audience } : {}),
    };
    try {
      if (isEdit) {
        await api(`${basePath}/${announcement.id}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Announcement updated");
      } else {
        await api(basePath, { method: "POST", body: payload });
        toast.success("Announcement posted");
      }
      onSuccess();
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
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
      {schoolWide ? (
        <View style={{ gap: 6 }}>
          <Label>Who can see this?</Label>
          <SegmentedControl
            options={AUDIENCE_OPTIONS}
            value={audience}
            onChange={setAudience}
          />
          <Text variant="muted" size="xs">
            {audience === "everyone"
              ? "Everyone: staff, students and parents. Students get a push notification; parents see it if your school shows them announcements."
              : "Staff only: the staff notice board, with read receipts."}
          </Text>
        </View>
      ) : null}
      <Button onPress={submit} loading={loading}>
        {isEdit ? "Save changes" : "Post announcement"}
      </Button>
    </View>
  );
}
