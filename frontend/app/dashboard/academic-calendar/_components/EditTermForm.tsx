"use client";

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { termLabel, type Term } from "./types";

interface EditTermFormProps {
  term: Term;
  onSuccess: () => void;
}

export function EditTermForm({ term, onSuccess }: EditTermFormProps) {
  useSignals();
  const name = useSignal(termLabel(term.name));
  const startDate = useSignal(term.start_date);
  const endDate = useSignal(term.end_date);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api(`/terms/${term.id}`, {
        method: "PATCH",
        body: {
          name: name.value.trim(),
          startDate: startDate.value,
          endDate: endDate.value,
        },
      });
      toast.success("Term updated");
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
      <div className="space-y-2">
        <Label htmlFor="editTermName">Name</Label>
        <Input
          id="editTermName"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          maxLength={60}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editStartDate">Start Date</Label>
          <Input
            id="editStartDate"
            type="date"
            value={startDate.value}
            onChange={(e) => (startDate.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editEndDate">End Date</Label>
          <Input
            id="editEndDate"
            type="date"
            value={endDate.value}
            onChange={(e) => (endDate.value = e.target.value)}
            required
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
