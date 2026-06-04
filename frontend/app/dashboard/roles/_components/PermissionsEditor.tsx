"use client";

import { useCallback, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import { useSignal, useComputed } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import type { CatalogEntry, SchoolRole } from "./types";

const ACTION_ORDER: CatalogEntry["action"][] = [
  "read",
  "create",
  "update",
  "delete",
];
const ACTION_LABEL: Record<CatalogEntry["action"], string> = {
  read: "View",
  create: "Create",
  update: "Edit",
  delete: "Delete",
};

function prettyResource(resource: string) {
  return resource
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function PermissionsEditor({
  open,
  role,
  catalog,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  role: SchoolRole | null;
  catalog: CatalogEntry[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  useSignals();
  const selected = useSignal<Set<string>>(new Set());
  const loading = useSignal(true);
  const saving = useSignal(false);

  const fetchPermissions = useCallback((roleId: string) => {
    loading.value = true;
    api<string[]>(`/permissions/roles/${roleId}/permissions`)
      .then((keys) => (selected.value = new Set(keys)))
      .catch(() => toast.error("Failed to load role permissions"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    if (open && role) fetchPermissions(role.id);
  }, [open, role, fetchPermissions]);

  // Catalog grouped by resource, preserving catalog order.
  const groups = useComputed(() => {
    const byResource = new Map<string, Map<string, CatalogEntry>>();
    for (const entry of catalog) {
      if (!byResource.has(entry.resource)) byResource.set(entry.resource, new Map());
      byResource.get(entry.resource)!.set(entry.action, entry);
    }
    return [...byResource.entries()];
  });

  function toggle(key: string, on: boolean) {
    const next = new Set(selected.value);
    if (on) next.add(key);
    else next.delete(key);
    selected.value = next;
  }

  async function handleSave() {
    if (!role) return;
    saving.value = true;
    try {
      await api(`/permissions/roles/${role.id}/permissions`, {
        method: "PUT",
        body: { keys: [...selected.value] },
      });
      toast.success(`Permissions updated for ${role.name}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to save permissions",
      );
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>Permissions - {role?.name}</DialogTitle>
          <DialogDescription>
            Choose what this role can do. Changes apply to every member with
            this role.
          </DialogDescription>
        </DialogHeader>

        {loading.value ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <ScrollArea className="min-h-0 pr-1">
            <div className="divide-y rounded-lg border">
              {groups.value.map(([resource, actions]) => (
                <div
                  key={resource}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
                >
                  <span className="text-sm font-medium">
                    {prettyResource(resource)}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {ACTION_ORDER.map((action) => {
                      const entry = actions.get(action);
                      if (!entry) return null;
                      const on = selected.value.has(entry.key);
                      return (
                        <button
                          key={action}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(entry.key, !on)}
                          className={cn(
                            "rounded-full border px-1 py-1 text-xs font-medium transition-colors",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {selected.value.size} permission
            {selected.value.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving.value}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving.value || loading.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save Permissions
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
