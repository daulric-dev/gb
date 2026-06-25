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

  const load = useCallback((membershipId: string) => {
    loading.value = true;
    Promise.all([
      api<CustomRole[]>("/permissions/roles"),
      api<CustomRole[]>(`/permissions/members/${membershipId}/roles`),
    ])
      .then(([all, mine]) => {
        roles.value = all.filter((r) => !r.is_system);
        assigned.value = new Set(mine.map((r) => r.id));
      })
      .catch(() => toast.error("Failed to load roles"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    if (open && member) load(member.id);
  }, [open, member, load]);

  async function toggle(roleId: string, on: boolean) {
    if (!member) return;
    togglingId.value = roleId;
    try {
      if (on) {
        await api(`/permissions/members/${member.id}/roles`, {
          method: "POST",
          body: { roleId },
        });
      } else {
        await api(`/permissions/members/${member.id}/roles/${roleId}`, {
          method: "DELETE",
        });
      }
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
            Assign custom roles. Their permissions stack on top of the member&apos;s
            base role.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
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
                    <p className="text-sm font-medium capitalize">{role.name}</p>
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
