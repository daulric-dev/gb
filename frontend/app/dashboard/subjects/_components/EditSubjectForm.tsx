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
import { type Subject } from "./types";

interface EditSubjectFormProps {
  subject: Subject;
  onSuccess: () => void;
}

export function EditSubjectForm({ subject, onSuccess }: EditSubjectFormProps) {
  useSignals();
  const name = useSignal(subject.name);
  const code = useSignal(subject.code ?? "");
  const isGraded = useSignal(subject.is_graded);
  const sortOrder = useSignal(subject.sort_order);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      code: code.value || null,
      isGraded: isGraded.value,
      sortOrder: sortOrder.value,
    };

    try {
      await api(`/subjects/${subject.id}`, { method: "PATCH", body });
      toast.success("Subject updated");
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
          <Label htmlFor="editName">Subject Name</Label>
          <Input
            id="editName"
            value={name.value}
            onChange={(e) => (name.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editCode">Code</Label>
          <Input
            id="editCode"
            value={code.value}
            onChange={(e) => (code.value = e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editIsGraded">Grading</Label>
          <Select
            value={isGraded.value ? "true" : "false"}
            onValueChange={(v) => (isGraded.value = v === "true")}
            items={[
              { value: "true", label: "Graded" },
              { value: "false", label: "Not Graded (remarks only)" },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Graded</SelectItem>
              <SelectItem value="false">Not Graded (remarks only)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="editSortOrder">Display Order</Label>
          <Input
            id="editSortOrder"
            type="number"
            min={0}
            value={sortOrder.value}
            onChange={(e) => (sortOrder.value = Number(e.target.value))}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
