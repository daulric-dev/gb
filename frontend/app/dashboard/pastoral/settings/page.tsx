"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { KIND_LABELS, type PastoralCategory, type PastoralKind } from "@/lib/pastoral";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";

/**
 * School admins (school:update): the note categories (which are restricted
 * to safeguarding staff) and how long resolved notes are kept.
 */
export default function PastoralSettingsPage() {
  useSignals();
  const router = useRouter();
  const categories = useSignal<PastoralCategory[]>([]);
  const retention = useSignal("");
  const newLabel = useSignal("");
  const newKind = useSignal<PastoralKind>("other");
  const saving = useSignal(false);

  const load = useCallback(() => {
    api<PastoralCategory[]>("/pastoral/categories?archived=true")
      .then((c) => (categories.value = c))
      .catch((err) => toast.error(userMessage(err, "Failed to load categories")));
    api<{ retentionDays: number | null }>("/pastoral/settings")
      .then((s) => (retention.value = s.retentionDays ? String(s.retentionDays) : ""))
      .catch(() => undefined);
  }, [categories, retention]);

  useEffect(() => load(), [load]);

  async function saveRetention(e: React.FormEvent) {
    e.preventDefault();
    const days = retention.value.trim() ? Number(retention.value) : null;
    if (days !== null && (!Number.isInteger(days) || days < 30)) {
      toast.error("Enter a whole number of days, at least 30, or leave it empty");
      return;
    }
    saving.value = true;
    try {
      await api("/pastoral/settings", { method: "PATCH", body: { retentionDays: days } });
      toast.success("Retention saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
    } finally {
      saving.value = false;
    }
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.value.trim()) return;
    try {
      categories.value = await api<PastoralCategory[]>("/pastoral/categories", {
        method: "POST",
        body: { label: newLabel.value.trim(), kind: newKind.value },
      });
      newLabel.value = "";
    } catch (err) {
      toast.error(userMessage(err, "Failed to add the category"));
    }
  }

  async function update(c: PastoralCategory, patch: Record<string, unknown>) {
    try {
      categories.value = await api<PastoralCategory[]>(`/pastoral/categories/${c.id}`, {
        method: "PATCH",
        body: patch,
      });
    } catch (err) {
      toast.error(userMessage(err, "Failed to update the category"));
    }
  }

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title="Pastoral settings"
        description="Categories and how long notes are kept"
        onBack={() => router.push("/dashboard/pastoral")}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Categories</CardTitle>
          <CardDescription>
            Notes in a restricted category need the safeguarding permission to
            see, write or change, and every read is audit-logged. Archived
            categories keep their notes but take no new ones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y rounded-md border">
            {categories.value.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground">{KIND_LABELS[c.kind]}</span>
                {c.archived && <Badge variant="secondary">Archived</Badge>}
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={c.isSafeguarding}
                    disabled={c.kind === "safeguarding"}
                    onCheckedChange={(v) => void update(c, { isSafeguarding: v })}
                  />
                  Restricted
                </label>
                <Button size="xs" variant="ghost" onClick={() => void update(c, { archived: !c.archived })}>
                  {c.archived ? "Restore" : "Archive"}
                </Button>
              </li>
            ))}
          </ul>
          <form onSubmit={addCategory} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="newCategory">New category</Label>
              <Input id="newCategory" maxLength={60} value={newLabel.value} onChange={(e) => (newLabel.value = e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newCategoryKind">Type</Label>
              <NativeSelect id="newCategoryKind" value={newKind.value} onChange={(e) => (newKind.value = e.target.value as PastoralKind)}>
                {Object.entries(KIND_LABELS).map(([k, l]) => (
                  <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline">Add</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention</CardTitle>
          <CardDescription>
            Resolved notes are erased this many days after they were resolved.
            Leave empty to keep notes until the student is removed from the
            school. Every erasure is recorded in the erasure log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveRetention} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="retentionDays">Days after resolving</Label>
              <Input id="retentionDays" inputMode="numeric" className="w-40" value={retention.value} onChange={(e) => (retention.value = e.target.value)} />
            </div>
            <Button type="submit" disabled={saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
