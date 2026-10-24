"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AtSign, KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  AUDIENCE_LABEL,
  staffBehaviour,
  type EmailDomain,
} from "@/lib/email-domains";
import { ssoProviderName, type SsoProvider } from "@/lib/sso";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useProfile } from "@/providers/AuthProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { PermissionDenied } from "@/components/dashboard/permission-denied";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DomainFormDialog } from "./_components/DomainFormDialog";
import { VerifyPanel } from "./_components/VerifyPanel";
import { SsoPanel } from "./_components/SsoPanel";

const TITLE = "Email Domains";
const DESCRIPTION = "Let people with a school email address join automatically";

export default function EmailDomainsPage() {
  useSignals();
  // The endpoints sit behind AdminGuard, so this mirrors that.
  const { isAdmin, loading: permissionsLoading } = usePermissions();
  const { profile } = useProfile();
  const schoolName = profile.value?.school?.name ?? "your school";

  const domains = useSignal<EmailDomain[]>([]);
  const loading = useSignal(true);
  const formOpen = useSignal(false);
  const editing = useSignal<EmailDomain | null>(null);
  const verifyOpenId = useSignal<string | null>(null);
  const removing = useSignal<EmailDomain | null>(null);
  const removeBusy = useSignal(false);
  // Sign-in providers this server offers; null while loading.
  const ssoProviders = useSignal<SsoProvider[] | null>(null);

  const fetchDomains = useCallback(() => {
    loading.value = true;
    api<EmailDomain[]>("/schools/email-domains")
      .then((data) => (domains.value = data))
      .catch(() => toast.error("Failed to load email domains"))
      .finally(() => (loading.value = false));
  }, [loading, domains]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchDomains();
    api<SsoProvider[]>("/auth/sso/providers")
      .then((list) => (ssoProviders.value = Array.isArray(list) ? list : []))
      .catch(() => (ssoProviders.value = []));
  }, [isAdmin, fetchDomains, ssoProviders]);

  function upsert(saved: EmailDomain) {
    const exists = domains.value.some((d) => d.id === saved.id);
    domains.value = exists
      ? domains.value.map((d) => (d.id === saved.id ? saved : d))
      : [...domains.value, saved];
  }

  function openAdd() {
    editing.value = null;
    formOpen.value = true;
  }

  function openEdit(d: EmailDomain) {
    editing.value = d;
    formOpen.value = true;
  }

  async function confirmRemove() {
    const target = removing.value;
    if (!target) return;
    removeBusy.value = true;
    try {
      await api(`/schools/email-domains/${target.id}`, { method: "DELETE" });
      domains.value = domains.value.filter((d) => d.id !== target.id);
      toast.success(`${target.domain} removed`);
      removing.value = null;
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to remove the domain",
      );
    } finally {
      removeBusy.value = false;
    }
  }

  if (permissionsLoading.value) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!isAdmin) {
    return (
      <PermissionDenied
        title={TITLE}
        description={DESCRIPTION}
        message="Only school administrators can manage email domains."
      />
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={TITLE}
        description={DESCRIPTION}
        action={
          <Button onClick={openAdd}>
            <Plus className="mr-1.5 size-4" />
            Add domain
          </Button>
        }
      />

      <div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
        <AtSign className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">
            People who sign in with these addresses join {schoolName}{" "}
            automatically.
          </p>
          <p className="text-muted-foreground">
            Student domains add students to your roster. Staff domains can let
            staff in straight away or send you a join request to approve. A
            domain only works once you verify it with a DNS record.
          </p>
        </div>
      </div>

      {loading.value ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : domains.value.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AtSign className="mb-3 size-10 text-muted-foreground/40" />
            <p className="font-medium">No email domains yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your school&apos;s domain, like students.riverside.edu, to get
              started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {domains.value.map((d) => {
            const behaviour = staffBehaviour(d);
            const verifyOpen = !d.verified && verifyOpenId.value === d.id;
            const ssoName = d.ssoProvider
              ? ssoProviderName(
                  ssoProviders.value?.find((p) => p.id === d.ssoProvider),
                  d.ssoProvider,
                )
              : null;
            return (
              <Card key={d.id}>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="truncate font-mono text-sm font-medium">
                        {d.domain}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">
                          {AUDIENCE_LABEL[d.audience]}
                        </Badge>
                        {behaviour && <Badge variant="outline">{behaviour}</Badge>}
                        {ssoName && (
                          <Badge variant="outline">
                            <KeyRound />
                            SSO: {ssoName}
                            {d.ssoRequired && " (required)"}
                          </Badge>
                        )}
                        {d.verified ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                            <ShieldCheck />
                            Verified
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            Pending verification
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!d.verified && (
                        <Button
                          size="sm"
                          variant={verifyOpen ? "secondary" : "outline"}
                          onClick={() =>
                            (verifyOpenId.value = verifyOpen ? null : d.id)
                          }
                        >
                          Verify
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(d)}
                        title="Edit"
                        aria-label={`Edit ${d.domain}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => (removing.value = d)}
                        title="Remove"
                        aria-label={`Remove ${d.domain}`}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {verifyOpen && (
                    <VerifyPanel
                      domain={d}
                      onVerifiedAction={(updated) => {
                        upsert(updated);
                        verifyOpenId.value = null;
                      }}
                    />
                  )}

                  <SsoPanel
                    key={`${d.id}:${d.verified}:${d.ssoProvider}:${d.ssoRequired}:${d.azureTenantId}:${d.samlEntryPoint}:${d.samlIssuer}:${d.samlCertificate}`}
                    domain={d}
                    providers={ssoProviders.value}
                    onSavedAction={upsert}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <DomainFormDialog
        open={formOpen.value}
        existing={editing.value}
        onOpenChangeAction={(o) => (formOpen.value = o)}
        onSavedAction={(saved) => {
          const added = !editing.value;
          upsert(saved);
          formOpen.value = false;
          // A new domain is useless until verified, so lead straight into it.
          if (added && !saved.verified) verifyOpenId.value = saved.id;
        }}
      />

      <AlertDialog
        open={removing.value !== null}
        onOpenChange={(o) => {
          if (!o && !removeBusy.value) removing.value = null;
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing.value?.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              New sign-ins with this domain will no longer join automatically.
              People who already joined stay in the school.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy.value}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmRemove}
              disabled={removeBusy.value}
            >
              {removeBusy.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
