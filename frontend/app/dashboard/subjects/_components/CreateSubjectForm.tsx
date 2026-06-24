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

interface CreateSubjectFormProps {
  onSuccess: () => void;
}

export function CreateSubjectForm({ onSuccess }: CreateSubjectFormProps) {
  useSignals();
  const name = useSignal("");
  const code = useSignal("");
  const isGraded = useSignal(true);
  const sortOrder = useSignal(0);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      isGraded: isGraded.value,
      sortOrder: sortOrder.value,
    };
    if (code.value) body.code = code.value;

    try {
      await api("/subjects", { method: "POST", body });
      toast.success("Subject created");
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
          <Label htmlFor="name">Subject Name</Label>
          <Input
            id="name"
            placeholder="Mathematics"
            value={name.value}
            onChange={(e) => (name.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            placeholder="MATH"
            value={code.value}
            onChange={(e) => (code.value = e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="isGraded">Grading</Label>
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
          <Label htmlFor="sortOrder">Display Order</Label>
          <Input
            id="sortOrder"
            type="number"
            min={0}
            value={sortOrder.value}
            onChange={(e) => (sortOrder.value = Number(e.target.value))}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Create Subject"}
      </Button>
    </form>
  );
}
