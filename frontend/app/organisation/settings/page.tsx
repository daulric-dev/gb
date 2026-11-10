"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { type Organisation, type OrganisationAdmin } from "@/lib/organisation";
import {
  canTransferOrganisation,
  organisationTransferTargets,
  ownerLabel,
  transferOrganisationOwnership,
} from "@/lib/ownership";
import { useAuth, useProfile } from "@/providers/AuthProvider";
import { TransferOwnershipCard } from "@/components/account/transfer-ownership-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgHeader } from "../_components/org-header";
import { userMessage } from "@/lib/errors";

export default function OrganisationSettingsPage() {
  useSignals();
  const { refresh } = useAuth();
  const { profile } = useProfile();
  const adminsSignal = useSignal<OrganisationAdmin[]>([]);
  const orgSignal = useSignal<Organisation | null>(null);
  const org = orgSignal.value;
  const nameSignal = useSignal("");
  const name = nameSignal.value;
  const savingSignal = useSignal(false);
  const saving = savingSignal.value;

  useEffect(() => {
    api<Organisation>("/organisation")
      .then((data) => {
        orgSignal.value = data;
        nameSignal.value = data?.name ?? "";
      })
      .catch((err) => toast.error(userMessage(err, "Failed to load the organisation")));
    api<OrganisationAdmin[]>("/organisation/admins")
      .then((data) => (adminsSignal.value = Array.isArray(data) ? data : []))
      .catch(() => (adminsSignal.value = []));
  }, [adminsSignal, nameSignal, orgSignal]);

  const admins = adminsSignal.value;
  const owner = admins.find((a) => a.isOwner) ?? null;
  const ownerId = org?.ownerId ?? owner?.userId ?? null;

  async function transferTo(userId: string) {
    const result = await transferOrganisationOwnership(userId);
    toast.success(`${result.owner.name || result.owner.email} now owns the organisation`);
    if (org) orgSignal.value = { ...org, ownerId: result.ownerId };
    adminsSignal.value = admins.map((a) => ({ ...a, isOwner: a.userId === result.ownerId }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) {
      toast.error("The organisation needs a name");
      return;
    }
    savingSignal.value = true;
    try {
      const updated = await api<Organisation>("/organisation", {
        method: "PATCH",
        body: { name: value },
      });
      orgSignal.value = updated && typeof updated === "object" ? updated : { ...org!, name: value };
      toast.success("Organisation renamed");
      // The name shows in the app chrome, which reads it from the profile.
      void refresh();
    } catch (err) {
      toast.error(userMessage(err, "Failed to rename the organisation"));
    } finally {
      savingSignal.value = false;
    }
  }

  return (
    <div className="space-y-6">
      <OrgHeader title="Settings" description="Your organisation's details" />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Organisation name</CardTitle>
          <CardDescription>
            Shown to everyone on this install, alongside their school&apos;s name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!org ? (
            <Skeleton className="h-9" />
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => (nameSignal.value = e.target.value)}
                  required
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Set up {new Date(org.createdAt).toLocaleDateString()}
                </p>
                <Button type="submit" disabled={saving || name.trim() === org.name}>
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {org && (
        <div className="max-w-xl">
          <TransferOwnershipCard
            title="Ownership"
            description={
              <>
                The owner set up this organisation or was handed it. Only the
                owner can hand it on, and must do so before deleting their
                account. They stay an administrator afterwards.
              </>
            }
            ownerLabel={owner ? ownerLabel(owner) : null}
            candidates={organisationTransferTargets(admins, ownerId).map((a) => ({
              userId: a.userId,
              label: ownerLabel(a),
            }))}
            canTransfer={canTransferOrganisation(
              ownerId,
              profile.value?.id,
              !!profile.value?.is_org_admin,
            )}
            emptyHint="There is no other administrator to hand it to. Add one under Administrators first."
            confirmText={(c) =>
              `Make ${c.label} the owner of ${org.name}? Only they will be able to transfer it after this. You will need to confirm it's you.`
            }
            onTransfer={transferTo}
          />
        </div>
      )}
    </div>
  );
}
