"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  appointedMessage,
  inviteExpired,
  inviteExpiryLabel,
  listInvites,
  personLabel,
  type AddedAdmin,
  type OrganisationAdmin,
  type OrganisationInvite,
} from "@/lib/organisation";
import { useProfile } from "@/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrgHeader } from "../_components/org-header";
import { SignOutSessionsButton } from "../_components/sign-out-sessions";
import { ResetMfaButton } from "@/components/account/mfa/reset-mfa-button";
import { InviteActions } from "../schools/_components/pending-invite";
import { userMessage } from "@/lib/errors";

export default function OrganisationAdminsPage() {
  useSignals();
  const { profile } = useProfile();
  const rowsSignal = useSignal<OrganisationAdmin[] | null>(null);
  const rows = rowsSignal.value;
  const invitesSignal = useSignal<OrganisationInvite[]>([]);
  const invites = invitesSignal.value;
  const emailSignal = useSignal("");
  const email = emailSignal.value;
  const addingSignal = useSignal(false);
  const adding = addingSignal.value;
  const removingIdSignal = useSignal<string | null>(null);
  const removingId = removingIdSignal.value;

  const load = useCallback(() => {
    api<OrganisationAdmin[]>("/organisation/admins")
      .then((data) => (rowsSignal.value = Array.isArray(data) ? data : []))
      .catch((err) => {
        rowsSignal.value = [];
        toast.error(userMessage(err, "Failed to load administrators"));
      });
    // People invited who have not signed in yet.
    listInvites("organisation_admin")
      .then((data) => (invitesSignal.value = Array.isArray(data) ? data : []))
      .catch(() => (invitesSignal.value = []));
  }, [invitesSignal, rowsSignal]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    addingSignal.value = true;
    try {
      const result = await api<AddedAdmin>("/organisation/admins", {
        method: "POST",
        body: { email: value },
      });
      toast.success(appointedMessage(result, value, "an organisation administrator"));
      emailSignal.value = "";
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to add the administrator"));
    } finally {
      addingSignal.value = false;
    }
  }

  async function remove(admin: OrganisationAdmin) {
    const who = admin.name || admin.email;
    if (!window.confirm(`Remove ${who} as an organisation administrator?`)) return;
    removingIdSignal.value = admin.userId;
    try {
      await api(`/organisation/admins/${encodeURIComponent(admin.userId)}`, {
        method: "DELETE",
      });
      toast.success(`${who} is no longer an administrator`);
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to remove the administrator"));
    } finally {
      removingIdSignal.value = null;
    }
  }

  return (
    <div className="space-y-6">
      <OrgHeader
        title="Administrators"
        description="People who run this organisation: its schools, admins and settings"
      />

      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          value={email}
          onChange={(e) => (emailSignal.value = e.target.value)}
          placeholder="Email (we'll invite them if they don't have an account)"
          aria-label="Administrator email"
          className="flex-1"
          required
        />
        <Button type="submit" disabled={adding}>
          {adding ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 size-4" />
          )}
          Add administrator
        </Button>
      </form>

      <Card>
        <CardContent className="p-0 sm:p-2">
          {rows === null ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No administrators.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const isMe = a.userId === profile.value?.id;
                  return (
                    <TableRow key={a.userId}>
                      <TableCell className="max-w-48 truncate font-medium">
                        {a.name || "—"}
                        {isMe && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                        )}
                        {a.isOwner && (
                          <Badge
                            variant="secondary"
                            className="ml-1.5"
                            title="Owns the organisation; transfer it under Settings"
                          >
                            Owner
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-64 truncate">{a.email}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {a.fromEnv ? (
                          <Badge
                            variant="secondary"
                            title="Listed in the server configuration; remove it there"
                          >
                            Server config
                          </Badge>
                        ) : (
                          new Date(a.createdAt).toLocaleDateString()
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {!isMe && (
                            <SignOutSessionsButton
                              userId={a.userId}
                              who={a.name || a.email}
                            />
                          )}
                          {!isMe && (
                            <ResetMfaButton userId={a.userId} who={a.name || a.email} />
                          )}
                          {!a.fromEnv && !a.isOwner && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => remove(a)}
                              disabled={removingId !== null}
                              title="Remove administrator"
                            >
                              {removingId === a.userId ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4 text-destructive" />
                              )}
                              <span className="sr-only">Remove</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {invites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Pending invites</h2>
          <p className="text-sm text-muted-foreground">
            They become administrators when they first sign in with this email.
          </p>
          <Card>
            <CardContent className="p-0 sm:p-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Invited by</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="max-w-64 truncate font-medium">{inv.email}</TableCell>
                      <TableCell className="max-w-64 truncate">
                        {inv.invitedBy ? personLabel(inv.invitedBy) : "—"}
                      </TableCell>
                      <TableCell
                        className={`whitespace-nowrap ${inviteExpired(inv) ? "text-destructive" : ""}`}
                      >
                        {inviteExpiryLabel(inv)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <InviteActions invite={inv} onChanged={load} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
