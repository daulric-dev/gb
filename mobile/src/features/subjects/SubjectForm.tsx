import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import type { Subject } from "./types";

/**
 * Create or edit a subject. Pass `subject` to edit; otherwise a new subject is
 * created and appended at `nextSortOrder`. Mirrors the web Create/Edit forms
 * (name, code, graded flag); ordering is managed separately via reorder arrows.
 */
export function SubjectForm({
  subject,
  nextSortOrder = 0,
  onSuccess,
}: {
  subject?: Subject;
  nextSortOrder?: number;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const editing = !!subject;

  const [name, setName] = useState(subject?.name ?? "");
  const [code, setCode] = useState(subject?.code ?? "");
  const [isGraded, setIsGraded] = useState(subject?.is_graded ?? true);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Subject name is required");
      return;
    }
    setLoading(true);
    try {
      if (editing) {
        await api(`/subjects/${subject.id}`, {
          method: "PATCH",
          body: {
            name: name.trim(),
            code: code.trim() || null,
            isGraded,
            sortOrder: subject.sort_order,
          },
        });
        toast.success("Subject updated");
      } else {
        const body: Record<string, unknown> = {
          name: name.trim(),
          isGraded,
          sortOrder: nextSortOrder,
        };
        if (code.trim()) body.code = code.trim();
        await api("/subjects", { method: "POST", body });
        toast.success("Subject created");
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
        <Label>Subject Name</Label>
        <Input
          placeholder="Mathematics"
          value={name}
          onChangeText={setName}
          maxLength={100}
        />
      </View>
      <View style={{ gap: 6 }}>
        <Label>Code</Label>
        <Input
          placeholder="MATH"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          maxLength={20}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Label>Graded</Label>
          <Text variant="muted">
            {isGraded ? "Graded" : "Not graded (remarks only)"}
          </Text>
        </View>
        <Switch value={isGraded} onValueChange={setIsGraded} />
      </View>
      <Button onPress={submit} loading={loading}>
        {editing ? "Save Changes" : "Create Subject"}
      </Button>
    </View>
  );
}
