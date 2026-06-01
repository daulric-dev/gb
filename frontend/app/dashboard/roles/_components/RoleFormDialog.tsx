"use client";

import { useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import type { SchoolRole } from "./types";

export function RoleFormDialog({
  open,
  role,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** null → create a new role; otherwise edit this role. */
  role: SchoolRole | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  useSignals();
  const name = useSignal("");
  const description = useSignal("");
  const saving = useSignal(false);

  // Sync the form to the dialog's target when it opens. Done in an effect (not
  // during render) so we never write signals while rendering.
  useEffect(() => {
    if (open) {
      name.value = role?.name ?? "";
      description.value = role?.description ?? "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role?.id]);

  async function handleSave() {
    const trimmed = name.value.trim();
    if (!trimmed) {
      toast.error("Role name is required");
      return;
    }
    saving.value = true;
    try {
      const body = {
        name: trimmed,
        description: description.value.trim() || undefined,
      };
      if (role) {
        await api(`/permissions/roles/${role.id}`, { method: "PATCH", body });
        toast.success("Role updated");
      } else {
        await api("/permissions/roles", { method: "POST", body });
        toast.success("Role created");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to save role",
      );
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? "Edit role" : "Create role"}</DialogTitle>
          <DialogDescription>
            {role
              ? "Update this role's name or description."
              : "Add a custom role for your school. You can set its permissions next."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name.value}
              onChange={(e) => (name.value = e.target.value)}
              placeholder="e.g. Librarian"
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              value={description.value}
              onChange={(e) => (description.value = e.target.value)}
              placeholder="What this role is for (optional)"
              maxLength={300}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving.value}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            {role ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
