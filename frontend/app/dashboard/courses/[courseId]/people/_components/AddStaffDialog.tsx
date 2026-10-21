"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Check, Loader2, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { SchoolMember } from "@/app/dashboard/staff/_components/types";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function memberName(m: SchoolMember) {
  return (
    `${m.user?.first_name ?? ""} ${m.user?.last_name ?? ""}`.trim() || "Unnamed"
  );
}

export function AddStaffDialog({
  open,
  courseId,
  existing,
  onOpenChangeAction,
  onAddedAction,
}: {
  open: boolean;
  courseId: string;
  /** user profile ids already on the course staff */
  existing: string[];
  onOpenChangeAction: (open: boolean) => void;
  onAddedAction: () => void;
}) {
  useSignals();
  const members = useSignal<SchoolMember[]>([]);
  const loading = useSignal(true);
  const search = useSignal("");
  const selected = useSignal<string | null>(null);
  const role = useSignal<"teacher" | "ta">("teacher");
  const saving = useSignal(false);

  useEffect(() => {
    if (!open) return;
    selected.value = null;
    search.value = "";
    loading.value = true;
    api<SchoolMember[]>("/schools/members")
      .then((data) => (members.value = data))
      .catch(() => toast.error("Failed to load staff"))
      .finally(() => (loading.value = false));
  }, [open, members, loading, search, selected]);

  const taken = new Set(existing);
  const q = search.value.trim().toLowerCase();
  const candidates = members.value
    .filter((m) => m.user && !taken.has(m.user.id))
    .filter((m) => !q || memberName(m).toLowerCase().includes(q))
    .sort((a, b) => memberName(a).localeCompare(memberName(b)));

  async function add() {
    if (!selected.value) return;
    saving.value = true;
    try {
      await api(`/courses/${courseId}/staff`, {
        method: "POST",
        body: { userProfileId: selected.value, role: role.value },
      });
      toast.success(role.value === "ta" ? "TA added" : "Teacher added");
      onOpenChangeAction(false);
      onAddedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
          <DialogDescription>
            Teachers run the course. TAs can see everything, mark and post
            announcements, but cannot change settings or people.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["teacher", "ta"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => (role.value = r)}
                aria-pressed={role.value === r}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  role.value === r
                    ? "border-primary bg-primary/5 font-medium"
                    : "hover:bg-muted",
                )}
              >
                {r === "teacher" ? "Teacher" : "Teaching assistant"}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="staffSearch" className="sr-only">
              Search staff
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="staffSearch"
                placeholder="Search staff"
                className="pl-8"
                value={search.value}
                onChange={(e) => (search.value = e.target.value)}
              />
            </div>
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1">
            {loading.value ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No one else to add.
              </p>
            ) : (
              candidates.map((m) => {
                const id = m.user!.id;
                const active = selected.value === id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => (selected.value = id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      active ? "bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <Avatar className="size-7">
                      {m.user?.avatar_url && (
                        <AvatarImage src={m.user.avatar_url} alt="" />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {(m.user?.first_name?.[0] ?? "") +
                          (m.user?.last_name?.[0] ?? "") || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate">{memberName(m)}</span>
                    {m.role && (
                      <span className="text-xs capitalize text-muted-foreground">
                        {m.role}
                      </span>
                    )}
                    {active && <Check className="size-4 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={saving.value}
          >
            Cancel
          </Button>
          <Button onClick={add} disabled={!selected.value || saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
