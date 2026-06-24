"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Student } from "./types";

export function EditStudentForm({
  student,
  onSuccess,
}: {
  student: Student;
  onSuccess: () => void;
}) {
  useSignals();
  const firstName = useSignal(student.first_name);
  const lastName = useSignal(student.last_name);
  const gender = useSignal<"" | "male" | "female">(student.gender ?? "");
  const dateOfBirth = useSignal(student.date_of_birth ?? "");
  const enrollementDate = useSignal(student.enrollement_date ?? "");
  const isActive = useSignal(student.is_active);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      firstName: firstName.value,
      lastName: lastName.value,
      gender: gender.value,
      dateOfBirth: dateOfBirth.value || undefined,
      enrollementDate: enrollementDate.value || undefined,
      isActive: isActive.value,
    };

    try {
      await api(`/students/${student.id}`, { method: "PATCH", body });
      toast.success("Student updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editFirstName">First Name</Label>
          <Input
            id="editFirstName"
            value={firstName.value}
            onChange={(e) => (firstName.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editLastName">Last Name</Label>
          <Input
            id="editLastName"
            value={lastName.value}
            onChange={(e) => (lastName.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="editGender">Gender</Label>
        <Select
          value={gender.value}
          onValueChange={(v) =>
            (gender.value = v as "" | "male" | "female")
          }
          items={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ]}
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editDob">Date of Birth</Label>
          <Input
            id="editDob"
            type="date"
            value={dateOfBirth.value}
            onChange={(e) => (dateOfBirth.value = e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editEnrollDate">Enrolment Date</Label>
          <Input
            id="editEnrollDate"
            type="date"
            value={enrollementDate.value}
            onChange={(e) => (enrollementDate.value = e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="editActive"
          type="checkbox"
          checked={isActive.value}
          onChange={(e) => (isActive.value = e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="editActive">Active</Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
