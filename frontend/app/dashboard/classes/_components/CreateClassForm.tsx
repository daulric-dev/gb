"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AcademicYear } from "./types";

export function CreateClassForm({ onSuccess }: { onSuccess: () => void }) {
  useSignals();
  const name = useSignal("");
  const academicYearId = useSignal("");
  const academicYears = useSignal<AcademicYear[]>([]);
  const loading = useSignal(false);
  const yearsLoading = useSignal(true);

  useEffect(() => {
    api<(AcademicYear & { is_active?: boolean })[]>("/academic-years")
      .then((data) => {
        const active = data.filter((y) => y.is_active);
        academicYears.value = active;
        if (active.length > 0) {
          academicYearId.value = active[0].id;
        }
      })
      .catch(() => toast.error("Failed to load academic years"))
      .finally(() => (yearsLoading.value = false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api("/classes", {
        method: "POST",
        body: { name: name.value, academicYearId: academicYearId.value },
      });
      toast.success("Class created");
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
      <div className="space-y-2">
        <Label htmlFor="className">Class Name</Label>
        <Input
          id="className"
          placeholder="Class 3A"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="academicYear">Academic Year</Label>
        {yearsLoading.value ? (
          <Skeleton className="h-9 w-full" />
        ) : academicYears.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No academic years found. Create one first.
          </p>
        ) : (
          <Select
            value={academicYearId.value}
            onValueChange={(v) => (academicYearId.value = v as string)}
            items={academicYears.value.map((y) => ({
              value: y.id,
              label: y.name,
            }))}
            required
          >
            <SelectTrigger id="academicYear" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {academicYears.value.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading.value || academicYears.value.length === 0}
      >
        {loading.value ? "Creating..." : "Create Class"}
      </Button>
    </form>
  );
}
