"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Copy, KeyRound, Mail, UserRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { useFeatures } from "@/hooks/use-features";
import { usePermissions } from "@/providers/PermissionsProvider";
import {
  personName,
  relationshipText,
  type Relationship,
  type StudentParents,
} from "@/lib/parent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/**
 * Parents linked to a student, with invitations: email a parent an
 * invitation link, or make a one-time code to hand over. Only while the
 * school has the parent portal on; changing needs student:update.
 */
export function ParentLinksCard({ studentId }: { studentId: string }) {
  useSignals();
  const { hasFeature } = useFeatures();
  const { can } = usePermissions();
  const canEdit = can("student", "update");
  const on = hasFeature("parent_portal");

  const data = useSignal<StudentParents | null>(null);
  const email = useSignal("");
  const relationship = useSignal<Relationship | "">("");
  const busy = useSignal(false);
  const code = useSignal<{ code: string; expiresAt: string } | null>(null);
  const base = `/students/${studentId}/parents`;

  const load = useCallback(() => {
    api<StudentParents>(base)
      .then((d) => (data.value = d))
      .catch(() => (data.value = null));
  }, [base, data]);

  useEffect(() => {
    if (on) load();
  }, [on, load]);

  if (!on || !data.value) return null;
  const { links, invites } = data.value;
  const rel = relationship.value || undefined;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.value.trim()) return;
    busy.value = true;
    try {
      await api(`${base}/invites`, {
        method: "POST",
        body: { email: email.value.trim(), relationship: rel },
      });
      toast.success("Invitation sent");
      email.value = "";
      load();
    } catch (err) {
      toast.error(userMessage(err, "The invitation could not be sent"));
    } finally {
      busy.value = false;
    }
  }

  async function makeCode() {
    busy.value = true;
    try {
      code.value = await api<{ code: string; expiresAt: string }>(`${base}/link-codes`, {
        method: "POST",
        body: { relationship: rel },
      });
      load();
    } catch (err) {
      toast.error(userMessage(err, "Could not make a code"));
    } finally {
      busy.value = false;
    }
  }

  async function remove(path: string, done: string) {
    try {
      await api(path, { method: "DELETE" });
      toast.success(done);
      load();
    } catch (err) {
      toast.error(userMessage(err, "That did not work"));
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Parents and guardians</CardTitle>
        <CardDescription>
          Linked parents see this student&apos;s grades, work, attendance and course announcements
          (read-only) in the parent portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {links.length === 0 && invites.length === 0 && (
          <p className="text-sm text-muted-foreground">No parents linked yet.</p>
        )}
        {links.length > 0 && (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1" translate="no">
                  <p className="truncate text-sm font-medium">{personName(l.parent, "Parent")}</p>
                  <p className="truncate text-xs text-muted-foreground">{l.parent.email ?? "No email"}</p>
                </div>
                {relationshipText(l.relationship, l.relationshipLabel) && (
                  <Badge variant="outline">{relationshipText(l.relationship, l.relationshipLabel)}</Badge>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${personName(l.parent, "this parent")}`}
                    data-private-label
                    onClick={() => void remove(`${base}/${l.id}`, "Parent removed")}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {invites.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Waiting to be accepted</p>
            <ul className="space-y-2">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 rounded-md border border-dashed px-3 py-2">
                  {i.kind === "email" ? (
                    <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" translate={i.kind === "email" ? "no" : undefined}>{i.kind === "email" ? i.email : "Link code"}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(i.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Withdraw invitation"
                      onClick={() => void remove(`${base}/invites/${i.id}`, "Invitation withdrawn")}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {code.value && (
          <div role="status" className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">
              Give this code to the parent. It works once and is shown only now.
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="text-lg font-semibold tracking-widest">{code.value.code}</code>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy code"
                onClick={() => void navigator.clipboard?.writeText(code.value!.code)}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {canEdit && (
          <form onSubmit={invite} className="space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="parent-email">Parent&apos;s email</Label>
                <Input
                  id="parent-email"
                  type="email"
                  value={email.value}
                  onChange={(e) => (email.value = e.target.value)}
                  placeholder="parent@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parent-relationship">Relationship</Label>
                <NativeSelect
                  id="parent-relationship"
                  value={relationship.value}
                  onChange={(e) => (relationship.value = e.target.value as Relationship | "")}
                >
                  <NativeSelectOption value="">Not given</NativeSelectOption>
                  <NativeSelectOption value="mother">Mother</NativeSelectOption>
                  <NativeSelectOption value="father">Father</NativeSelectOption>
                  <NativeSelectOption value="guardian">Guardian</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy.value || !email.value.trim()}>
                Send invitation
              </Button>
              <Button type="button" variant="outline" disabled={busy.value} onClick={() => void makeCode()}>
                Make a link code instead
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
