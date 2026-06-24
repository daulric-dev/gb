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

export function CreateStudentForm({ onSuccess }: { onSuccess: () => void }) {
  useSignals();
  const firstName = useSignal("");
  const lastName = useSignal("");
  const gender = useSignal<"male" | "female">("male");
  const dateOfBirth = useSignal("");
  const enrollementDate = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      firstName: firstName.value,
      lastName: lastName.value,
      gender: gender.value,
    };
    if (dateOfBirth.value) body.dateOfBirth = dateOfBirth.value;
    if (enrollementDate.value) body.enrollementDate = enrollementDate.value;

    try {
      await api("/students", { method: "POST", body });
      toast.success("Student created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name</Label>
          <Input
            id="firstName"
            placeholder="James"
            value={firstName.value}
            onChange={(e) => (firstName.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            placeholder="Thompson"
            value={lastName.value}
            onChange={(e) => (lastName.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gender">Gender</Label>
        <Select
          value={gender.value}
          onValueChange={(v) => (gender.value = v as "male" | "female")}
          items={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ]}
          required
        >
          <SelectTrigger id="gender" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="dob">Date of Birth</Label>
          <Input
            id="dob"
            type="date"
            value={dateOfBirth.value}
            onChange={(e) => (dateOfBirth.value = e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enrollDate">Enrolment Date</Label>
          <Input
            id="enrollDate"
            type="date"
            value={enrollementDate.value}
            onChange={(e) => (enrollementDate.value = e.target.value)}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Add Student"}
      </Button>
    </form>
  );
}
