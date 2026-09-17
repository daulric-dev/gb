"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Star } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { useProfile } from "@/providers/AuthProvider";
import { ScaleForm } from "./_components/ScaleForm";
import type { GradeScaleDetail, GradeScaleSummary } from "./_components/types";

const TYPE_LABEL: Record<string, string> = {
  letter: "Letter (A–F)",
  gpa: "GPA",
  pass_fail: "Pass / Fail",
};

export default function GradeScalesPage() {
  useSignals();
  const { profile, loading: profileLoading } = useProfile();

  const scales = useSignal<GradeScaleSummary[]>([]);
  const loading = useSignal(true);
  const editing = useSignal<GradeScaleDetail | null>(null);
  const creating = useSignal(false);
  const settingDefault = useSignal<string | null>(null);

  const fetchScales = useCallback(() => {
    loading.value = true;
    api<GradeScaleSummary[]>("/grade-scales")
      .then((data) => (scales.value = data))
      .catch(() => toast.error("Failed to load grade scales"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    fetchScales();
  }, [fetchScales]);

  const startEdit = async (id: string) => {
    try {
      const detail = await api<GradeScaleDetail>(`/grade-scales/${id}`);
      editing.value = detail;
    } catch {
      toast.error("Failed to load scale");
    }
  };

  const setAsDefault = async (id: string) => {
    settingDefault.value = id;
    try {
      await api(`/grade-scales/${id}/set-default`, { method: "POST" });
      toast.success("Default scale updated");
      fetchScales();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to set default";
      toast.error(msg);
    } finally {
      settingDefault.value = null;
    }
  };

  const remove = async (s: GradeScaleSummary) => {
    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
    try {
      await api(`/grade-scales/${s.id}`, { method: "DELETE" });
      toast.success("Scale deleted");
      fetchScales();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete scale";
      toast.error(msg);
    }
  };

  if (profileLoading.value) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (profile.value?.role !== "admin") {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Grade Scales"
          description="Configure how numeric grades are displayed in your school"
        />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Only school administrators can manage grade scales.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Grade Scales"
        description="Configure how numeric grades are displayed in your school"
        action={
          <Button onClick={() => (creating.value = true)}>
            <Plus className="mr-2 size-4" />
            New scale
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Scales</CardTitle>
          <CardDescription>
            One scale can be marked as default. Without a default, grades show
            as numeric scores only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading.value ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : scales.value.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No grade scales yet. Click &quot;New scale&quot; to create one.
            </div>
          ) : (
            <div className="rounded-md border divide-y">
              {scales.value.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {s.isDefault && (
                        <Badge className="text-xs">Default</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {TYPE_LABEL[s.scaleType] ?? s.scaleType}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!s.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={settingDefault.value === s.id}
                        onClick={() => setAsDefault(s.id)}
                        title="Set as default"
                      >
                        <Star className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(s.id)}
                      title="Edit"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(s)}
                      title="Delete"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={creating.value}
        onOpenChange={(o) => (creating.value = o)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New grade scale</DialogTitle>
            <DialogDescription>
              Define the bands that map numeric percentages to a display value.
            </DialogDescription>
          </DialogHeader>
          {creating.value && (
            <ScaleForm
              existing={null}
              onSaved={() => {
                creating.value = false;
                fetchScales();
              }}
              onCancel={() => (creating.value = false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editing.value !== null}
        onOpenChange={(o) => {
          if (!o) editing.value = null;
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {editing.value?.name}</DialogTitle>
            <DialogDescription>
              Update the name, default flag, or bands of this scale.
            </DialogDescription>
          </DialogHeader>
          {editing.value && (
            <ScaleForm
              existing={editing.value}
              onSaved={() => {
                editing.value = null;
                fetchScales();
              }}
              onCancel={() => (editing.value = null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
