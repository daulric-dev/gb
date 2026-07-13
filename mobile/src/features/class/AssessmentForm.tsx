import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import type { Assessment } from "@/lib/types";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

type AssessmentType = "exam" | "coursework";

/**
 * Create or edit an assessment. Pass `assessment` to edit; otherwise `termId`
 * and `subjectId` are required to create. Mirrors the web Create/Edit forms.
 */
export function AssessmentForm({
  assessment,
  termId,
  subjectId,
  onSuccess,
}: {
  assessment?: Assessment;
  termId?: string;
  subjectId?: string;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const editing = !!assessment;

  const [title, setTitle] = useState(assessment?.title ?? "");
  const [type, setType] = useState<AssessmentType>(
    assessment?.assessment_type ?? "coursework",
  );
  const [maxScore, setMaxScore] = useState(String(assessment?.max_score ?? 100));
  const [weight, setWeight] = useState(String(assessment?.weight ?? 1));
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setLoading(true);
    try {
      if (editing) {
        await api(`/assessments/${assessment.id}`, {
          method: "PATCH",
          body: {
            title: title.trim(),
            assessmentType: type,
            maxScore: Number(maxScore),
            weight: Number(weight),
          },
        });
        toast.success("Assessment updated");
      } else {
        await api("/assessments", {
          method: "POST",
          body: {
            termId,
            subjectId,
            title: title.trim(),
            assessmentType: type,
            maxScore: Number(maxScore),
            weight: Number(weight),
          },
        });
        toast.success("Assessment created");
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
          placeholder="Mid-term Exam"
          value={title}
          onChangeText={setTitle}
        />
      </View>
      <View style={{ gap: 6 }}>
        <Label>Type</Label>
        <Select<AssessmentType>
          value={type}
          onChange={setType}
          options={[
            { value: "exam", label: "Exam" },
            { value: "coursework", label: "Coursework" },
          ]}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>Max Score</Label>
          <Input
            keyboardType="numeric"
            value={maxScore}
            onChangeText={setMaxScore}
          />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>Weight</Label>
          <Input
            keyboardType="numeric"
            value={weight}
            onChangeText={setWeight}
          />
        </View>
      </View>
      <Button onPress={submit} loading={loading}>
        {editing ? "Save Changes" : "Create Assessment"}
      </Button>
    </View>
  );
}
