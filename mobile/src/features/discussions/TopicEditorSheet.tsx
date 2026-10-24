import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { TextArea } from "@/components/ui/TextArea";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { errorMessage, type DiscussionTopic } from "@/lib/course";

/**
 * Start a topic, or edit one (pass `topic`). Staff also set the moderation
 * flags; a student gets the course defaults.
 */
export function TopicEditorSheet({
  open,
  apiBase,
  isStaff,
  topic,
  onClose,
  onSaved,
}: {
  open: boolean;
  apiBase: string;
  isStaff: boolean;
  topic?: DiscussionTopic | null;
  onClose: () => void;
  onSaved: (topicId: string | null) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setPinned] = useState(false);
  const [isLocked, setLocked] = useState(false);
  const [isPublished, setPublished] = useState(true);
  const [postFirst, setPostFirst] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(topic?.title ?? "");
    setBody(topic?.body ?? "");
    setPinned(topic?.isPinned ?? false);
    setLocked(topic?.isLocked ?? false);
    setPublished(topic?.isPublished ?? true);
    setPostFirst(topic?.requireInitialPost ?? false);
  }, [open, topic]);

  async function save() {
    if (!title.trim()) {
      toast.error("Give the topic a title");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      body: body.trim(),
      ...(isStaff
        ? { isPinned, isLocked, isPublished, requireInitialPost: postFirst }
        : {}),
    };
    try {
      if (topic) {
        await api(`${apiBase}/${topic.id}`, { method: "PATCH", body: payload });
        toast.success("Topic updated");
        onSaved(topic.id);
      } else {
        const created = await api<{ id?: string }>(apiBase, {
          method: "POST",
          body: payload,
        });
        toast.success("Topic posted");
        onSaved(created?.id ?? null);
      }
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save the topic"));
    } finally {
      setSaving(false);
    }
  }

  const flags: [string, boolean, (v: boolean) => void][] = [
    ["Published", isPublished, setPublished],
    ["Pinned", isPinned, setPinned],
    ["Locked (no new replies)", isLocked, setLocked],
    ["Students post before seeing replies", postFirst, setPostFirst],
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={topic ? "Edit topic" : "New topic"}
    >
      <View style={{ gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Label>Title</Label>
          <Input value={title} onChangeText={setTitle} maxLength={200} />
        </View>
        <View style={{ gap: 6 }}>
          <Label>Message</Label>
          <TextArea
            value={body}
            onChangeText={setBody}
            numberOfLines={6}
            maxLength={20000}
            placeholder="Markdown works here"
          />
        </View>
        {isStaff &&
          flags.map(([label, value, set]) => (
            <View key={label} style={styles.flag}>
              <Text style={{ flex: 1 }}>{label}</Text>
              <Switch value={value} onValueChange={set} />
            </View>
          ))}
        <Button onPress={save} loading={saving}>
          {topic ? "Save changes" : "Post topic"}
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flag: { flexDirection: "row", alignItems: "center", gap: 12 },
});
