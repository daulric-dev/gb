"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Trash2, UserRound, KeyRound, Users } from "lucide-react";
import { SearchableSelect } from "./SearchableSelect";
import type { FileItem, FileShare, SharePrincipalType } from "./types";
import type { SchoolMember } from "@/app/dashboard/staff/_components/types";
import type { SchoolRole } from "@/app/dashboard/roles/_components/types";
import type { ClassItem } from "@/app/dashboard/classes/_components/types";

const TYPE_META: Record<
  SharePrincipalType,
  { label: string; icon: typeof UserRound }
> = {
  user: { label: "Person", icon: UserRound },
  role: { label: "Role", icon: KeyRound },
  group: { label: "Class", icon: Users },
};

export function ShareDialog({
  file,
  onClose,
}: {
  file: FileItem | null;
  onClose: () => void;
}) {
  useSignals();
  const shares = useSignal<FileShare[]>([]);
  const members = useSignal<SchoolMember[]>([]);
  const roles = useSignal<SchoolRole[]>([]);
  const classes = useSignal<ClassItem[]>([]);
  const loading = useSignal(true);

  const newType = useSignal<SharePrincipalType>("user");
  const newTarget = useSignal<string>("");
  const newDownload = useSignal(false);
  const busy = useSignal(false);

  const loadShares = useCallback(() => {
    if (!file) return;
    api<FileShare[]>(`/files/${file.id}/shares`)
      .then((data) => (shares.value = data))
      .catch(() => toast.error("Failed to load shares"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  useEffect(() => {
    if (!file) return;
    loading.value = true;
    Promise.all([
      api<SchoolMember[]>("/schools/members").catch(() => []),
      api<SchoolRole[]>("/permissions/roles").catch(() => []),
      api<ClassItem[]>("/classes").catch(() => []),
      api<FileShare[]>(`/files/${file.id}/shares`).catch(() => []),
    ])
      .then(([m, r, c, s]) => {
        members.value = m;
        roles.value = r;
        classes.value = c;
        shares.value = s;
      })
      .finally(() => (loading.value = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  // Options for the target picker, excluding principals already shared.
  function targetOptions(): { value: string; label: string }[] {
    const taken = new Set(
      shares.value
        .filter((s) => s.principal_type === newType.value)
        .map((s) => s.principal_id),
    );
    if (newType.value === "user") {
      return members.value
        .filter((m) => m.user && !taken.has(m.user.id))
        .map((m) => ({
          value: m.user!.id,
          label:
            `${m.user!.first_name ?? ""} ${m.user!.last_name ?? ""}`.trim() ||
            "Unnamed",
        }));
    }
    if (newType.value === "role") {
      return roles.value
        .filter((r) => !taken.has(r.id))
        .map((r) => ({ value: r.id, label: r.name }));
    }
    return classes.value
      .filter((c) => !taken.has(c.id))
      .map((c) => ({ value: c.id, label: c.name }));
  }

  function principalName(share: FileShare): string {
    if (share.principal_type === "user") {
      const m = members.value.find((x) => x.user?.id === share.principal_id);
      return m?.user
        ? `${m.user.first_name ?? ""} ${m.user.last_name ?? ""}`.trim() ||
            "Unnamed"
        : "Unknown person";
    }
    if (share.principal_type === "role") {
      return roles.value.find((x) => x.id === share.principal_id)?.name ?? "Role";
    }
    return classes.value.find((x) => x.id === share.principal_id)?.name ?? "Class";
  }

  async function addShare() {
    if (!file || !newTarget.value) return;
    busy.value = true;
    try {
      await api(`/files/${file.id}/shares`, {
        method: "POST",
        body: {
          shares: [
            {
              principalType: newType.value,
              principalId: newTarget.value,
              canDownload: newDownload.value,
            },
          ],
        },
      });
      toast.success("File shared");
      newTarget.value = "";
      newDownload.value = false;
      loadShares();
    } catch {
      toast.error("Failed to share");
    } finally {
      busy.value = false;
    }
  }

  async function toggleDownload(share: FileShare, value: boolean) {
    if (!file) return;
    try {
      await api(`/files/${file.id}/shares/${share.id}`, {
        method: "PATCH",
        body: { canDownload: value },
      });
      loadShares();
    } catch {
      toast.error("Failed to update share");
    }
  }

  async function revoke(share: FileShare) {
    if (!file) return;
    try {
      await api(`/files/${file.id}/shares/${share.id}`, { method: "DELETE" });
      loadShares();
    } catch {
      toast.error("Failed to revoke share");
    }
  }

  const options = targetOptions();

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">Share “{file?.name}”</DialogTitle>
          <DialogDescription>
            Recipients can view the file. Toggle “Download” to also let them save
            a copy.
          </DialogDescription>
        </DialogHeader>

        {/* Add a recipient */}
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Share with</Label>
              <Select
                value={newType.value}
                onValueChange={(v) => {
                  newType.value = v as SharePrincipalType;
                  newTarget.value = "";
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_META) as SharePrincipalType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{TYPE_META[newType.value].label}</Label>
              <SearchableSelect
                options={options}
                value={newTarget.value}
                onChange={(v) => (newTarget.value = v)}
                placeholder={`Select ${TYPE_META[newType.value].label.toLowerCase()}…`}
                searchPlaceholder={`Search ${TYPE_META[newType.value].label.toLowerCase()}…`}
                emptyText="None available"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                id="new-download"
                checked={newDownload.value}
                onCheckedChange={(v) => (newDownload.value = v)}
              />
              <Label htmlFor="new-download" className="font-normal">
                Allow download
              </Label>
            </div>
            <Button
              size="sm"
              disabled={!newTarget.value || busy.value}
              onClick={addShare}
            >
              Share
            </Button>
          </div>
        </div>

        {/* Existing shares */}
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            Shared with
          </Label>
          {loading.value ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shares.value.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not shared with anyone yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {shares.value.map((share) => {
                const Icon = TYPE_META[share.principal_type].icon;
                return (
                  <li
                    key={share.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">
                      {principalName(share)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={share.can_download}
                        onCheckedChange={(v) => toggleDownload(share, v)}
                        aria-label="Allow download"
                      />
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        Download
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(share)}
                      aria-label="Revoke"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
