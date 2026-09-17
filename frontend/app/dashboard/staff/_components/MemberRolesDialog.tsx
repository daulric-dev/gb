"use client";

import { useCallback, useEffect } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Loader2 } from "lucide-react";
import type { SchoolMember } from "./types";

interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

function memberName(member: SchoolMember | null) {
  if (!member?.user) return "this member";
  return (
    [member.user.first_name, member.user.last_name].filter(Boolean).join(" ") ||
    "this member"
  );
}

export function MemberRolesDialog({
  open,
  member,
  onOpenChange,
  onRolesChanged,
}: {
  open: boolean;
  member: SchoolMember | null;
  onOpenChange: (open: boolean) => void;
  onRolesChanged?: () => void;
}) {
  useSignals();
  const roles = useSignal<CustomRole[]>([]);
  const assigned = useSignal<Set<string>>(new Set());
  const loading = useSignal(true);
  const togglingId = useSignal<string | null>(null);
  const baseRole = useSignal<SchoolMember["role"]>(member?.role ?? null);
  const baseRoleSaving = useSignal(false);

  const load = useCallback((membershipId: string) => {
    loading.value = true;
    Promise.all([
      api<CustomRole[]>("/permissions/roles"),
      api<CustomRole[]>(`/permissions/members/${membershipId}/roles`),
    ])
      .then(([all, mine]) => {
        roles.value = all.filter((role) => !role.is_system);
        assigned.value = new Set(mine.map((role) => role.id));
      })
      .catch(() => toast.error("Failed to load roles"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    if (open && member) {
      baseRole.value = member.role;
      load(member.id);
    }
  }, [open, member, load]);

  async function saveBaseRole(role: SchoolMember["role"]) {
    if (!member || member.is_owner || role === member.role) return;
    baseRoleSaving.value = true;
    try {
      await api(`/permissions/members/${member.id}/base-role`, {
        method: "PATCH",
        body: { role },
      });
      member.role = role;
      baseRole.value = role;
      toast.success("Default role updated");
      onRolesChanged?.();
    } catch (err) {
      baseRole.value = member.role;
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update role",
      );
    } finally {
      baseRoleSaving.value = false;
    }
  }

  async function toggle(roleId: string, on: boolean) {
    if (!member) return;
    togglingId.value = roleId;
    try {
      await api(
        on
          ? `/permissions/members/${member.id}/roles`
          : `/permissions/members/${member.id}/roles/${roleId}`,
        on ? { method: "POST", body: { roleId } } : { method: "DELETE" },
      );
      const next = new Set(assigned.value);
      if (on) next.add(roleId);
      else next.delete(roleId);
      assigned.value = next;
      onRolesChanged?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update role",
      );
    } finally {
      togglingId.value = null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles - {memberName(member)}</DialogTitle>
          <DialogDescription>
            Manage the built-in role and custom permissions for this member.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="base-role">Default role</Label>
            <Select
              value={baseRole.value ?? "none"}
              onValueChange={(value) => {
                const selectedValue = value as string;
                const role =
                  selectedValue === "none"
                    ? null
                    : (selectedValue as SchoolMember["role"]);
                baseRole.value = role;
                void saveBaseRole(role);
              }}
              disabled={member?.is_owner || baseRoleSaving.value}
              items={[
                { value: "none", label: "No default role" },
                { value: "member", label: "Member" },
                { value: "teacher", label: "Teacher" },
                { value: "admin", label: "Admin" },
              ]}
            >
              <SelectTrigger id="base-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default role</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="teacher">Teacher</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {member?.is_owner && (
              <p className="text-xs text-muted-foreground">
                The school owner cannot be changed.
              </p>
            )}
          </div>

          {loading.value ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)
          ) : roles.value.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No custom roles yet. Create one under Roles &amp; Permissions.
            </p>
          ) : (
            roles.value.map((role) => {
              const isOn = assigned.value.has(role.id);
              const busy = togglingId.value === role.id;
              return (
                <div
                  key={role.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize">
                      {role.name}
                    </p>
                    {role.description && (
                      <p className="truncate text-xs text-muted-foreground">
                        {role.description}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isOn ? "secondary" : "outline"}
                    disabled={busy}
                    onClick={() => toggle(role.id, !isOn)}
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      isOn && <Check className="mr-1.5 size-3.5" />
                    )}
                    {isOn ? "Assigned" : "Assign"}
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
