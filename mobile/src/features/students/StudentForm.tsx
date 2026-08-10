import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import type { Student } from "@/lib/types";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { DateField } from "@/components/ui/DateField";
import { Text } from "@/components/ui/Text";

type Gender = "male" | "female";

/** Create or edit a student. Pass `student` to edit. Mirrors the web forms. */
export function StudentForm({
  student,
  onSuccess,
}: {
  student?: Student;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const editing = !!student;

  const [firstName, setFirstName] = useState(student?.first_name ?? "");
  const [lastName, setLastName] = useState(student?.last_name ?? "");
  const [gender, setGender] = useState<Gender>(
    (student?.gender as Gender) ?? "male",
  );
  const [dob, setDob] = useState(student?.date_of_birth ?? "");
  const [enrolled, setEnrolled] = useState(student?.enrollement_date ?? "");
  const [isActive, setIsActive] = useState(student?.is_active ?? true);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    const body: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gender,
      dateOfBirth: dob || undefined,
      enrollementDate: enrolled || undefined,
    };
    if (editing) body.isActive = isActive;

    setLoading(true);
    try {
      if (editing) {
        await api(`/students/${student.id}`, { method: "PATCH", body });
        toast.success("Student updated");
      } else {
        await api("/students", { method: "POST", body });
        toast.success("Student created");
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
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>First Name</Label>
          <Input placeholder="James" value={firstName} onChangeText={setFirstName} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>Last Name</Label>
          <Input placeholder="Thompson" value={lastName} onChangeText={setLastName} />
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Label>Gender</Label>
        <Select<Gender>
          value={gender}
          onChange={setGender}
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ]}
        />
      </View>
      <View style={{ gap: 6 }}>
        <Label>Date of Birth</Label>
        <DateField
          value={dob}
          onChange={setDob}
          maximumDate={new Date()}
          clearable
          placeholder="Optional"
        />
      </View>
      <View style={{ gap: 6 }}>
        <Label>Enrolment Date</Label>
        <DateField
          value={enrolled}
          onChange={setEnrolled}
          clearable
          placeholder="Optional"
        />
      </View>
      {editing ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text weight="500">Active</Text>
          <Switch value={isActive} onValueChange={setIsActive} />
        </View>
      ) : null}
      <Button onPress={submit} loading={loading}>
        {editing ? "Save Changes" : "Add Student"}
      </Button>
    </View>
  );
}
