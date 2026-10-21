import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { DateField, toIsoDate } from "@/components/ui/DateField";
import { Text } from "@/components/ui/Text";
import { termLabel, type Term } from "./types";

/**
 * Create or edit a term. Pass `term` to edit; otherwise supply
 * `academicYearId` (and `existingNames` to warn about duplicates).
 * Mirrors the web CreateTermForm / EditTermForm.
 */
export function TermForm({
  term,
  academicYearId,
  existingNames = [],
  onSuccess,
}: {
  term?: Term;
  academicYearId?: string;
  existingNames?: string[];
  onSuccess: () => void;
}) {
  const toast = useToast();
  const editing = !!term;
  const today = toIsoDate(new Date());

  const [name, setName] = useState(
    term ? termLabel(term.name) : `Term ${existingNames.length + 1}`,
  );
  const [startDate, setStartDate] = useState(term?.start_date ?? today);
  const [endDate, setEndDate] = useState(term?.end_date ?? today);
  const [examWeight, setExamWeight] = useState(String(term?.exam_weight ?? 60));
  const [courseworkWeight, setCourseworkWeight] = useState(
    String(term?.coursework_weight ?? 40),
  );
  const [isMinistryReporting, setIsMinistryReporting] = useState(
    term?.is_ministry_reporting ?? false,
  );
  const [loading, setLoading] = useState(false);

  const trimmed = name.trim();
  const duplicate =
    !editing &&
    existingNames.some(
      (n) => termLabel(n).toLowerCase() === trimmed.toLowerCase(),
    );

  const submit = async () => {
    if (!trimmed) {
      toast.error("Give the term a name");
      return;
    }
    setLoading(true);
    try {
      if (editing) {
        await api(`/terms/${term.id}`, {
          method: "PATCH",
          body: {
            ...(trimmed !== termLabel(term.name) ? { name: trimmed } : {}),
            startDate,
            endDate,
            examWeight: Number(examWeight),
            courseworkWeight: Number(courseworkWeight),
            isMinistryReporting,
          },
        });
        toast.success("Term updated");
      } else {
        await api("/terms", {
          method: "POST",
          body: {
            academicYearId,
            name: trimmed,
            startDate,
            endDate,
            examWeight: Number(examWeight),
            courseworkWeight: Number(courseworkWeight),
            isMinistryReporting,
          },
        });
        toast.success("Term created");
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
        <Label>Term</Label>
        <Input
          value={name}
          onChangeText={setName}
          placeholder="e.g. Term 1, Fall, Semester 2"
          maxLength={60}
        />
        {duplicate && (
          <Text variant="muted" style={{ fontSize: 12 }}>
            This year already has a term with that name.
          </Text>
        )}
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

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Label>Ministry Reporting Term</Label>
        <Switch
          value={isMinistryReporting}
          onValueChange={setIsMinistryReporting}
        />
      </View>

      <Button onPress={submit} loading={loading} disabled={!trimmed}>
        {editing ? "Save Changes" : "Create Term"}
      </Button>
    </View>
  );
}
