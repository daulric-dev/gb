import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { DateField, toIsoDate } from "@/components/ui/DateField";
import { Text } from "@/components/ui/Text";
import {
  GRADING_MODEL_OPTIONS,
  type AcademicYear,
  type GradingModel,
} from "./types";

/**
 * Create or edit an academic year. Pass `year` to edit; otherwise a new year
 * is created. Mirrors the web CreateYearForm / EditYearForm.
 */
export function YearForm({
  year,
  onSuccess,
}: {
  year?: AcademicYear;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const editing = !!year;
  const today = toIsoDate(new Date());

  const [name, setName] = useState(year?.name ?? "");
  const [startDate, setStartDate] = useState(year?.start_date ?? today);
  const [endDate, setEndDate] = useState(year?.end_date ?? today);
  const [gradingModel, setGradingModel] = useState<GradingModel>(
    year?.grading_model ?? "weighted_continuous",
  );
  const [examWeight, setExamWeight] = useState(
    String(year?.year_exam_weight ?? 60),
  );
  const [courseworkWeight, setCourseworkWeight] = useState(
    String(year?.year_coursework_weight ?? 40),
  );
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const body = {
      name: name.trim(),
      startDate,
      endDate,
      gradingModel,
      yearExamWeight: Number(examWeight),
      yearCourseworkWeight: Number(courseworkWeight),
    };
    setLoading(true);
    try {
      if (editing) {
        await api(`/academic-years/${year.id}`, { method: "PATCH", body });
        toast.success("Academic year updated");
      } else {
        await api("/academic-years", { method: "POST", body });
        toast.success("Academic year created");
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
        <Label>Name</Label>
        <Input placeholder="2025/2026" value={name} onChangeText={setName} />
      </View>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>Start Date</Label>
          <DateField value={startDate} onChange={setStartDate} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>End Date</Label>
          <DateField value={endDate} onChange={setEndDate} />
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Label>Grading Model</Label>
        <Select<GradingModel>
          value={gradingModel}
          onChange={setGradingModel}
          options={GRADING_MODEL_OPTIONS}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>Exam Weight (%)</Label>
          <Input
            keyboardType="numeric"
            value={examWeight}
            onChangeText={setExamWeight}
          />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>Coursework Weight (%)</Label>
          <Input
            keyboardType="numeric"
            value={courseworkWeight}
            onChangeText={setCourseworkWeight}
          />
        </View>
      </View>
      <Text variant="muted" style={{ fontSize: 12 }}>
        Weights must add up to 100%
      </Text>

      <Button onPress={submit} loading={loading}>
        {editing ? "Save Changes" : "Create Academic Year"}
      </Button>
    </View>
  );
}
