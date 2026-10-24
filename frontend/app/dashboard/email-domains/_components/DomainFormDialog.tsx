"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  EmailDomain,
  EmailDomainAudience,
  EmailDomainStaffRole,
} from "@/lib/email-domains";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLE_ITEMS = [
  { value: "teacher", label: "Teacher" },
  { value: "member", label: "Member" },
];

/**
 * Add a domain (existing = null) or change who it is for (existing set). The
 * domain name itself is fixed once added - remove and re-add to change it.
 */
export function DomainFormDialog({
  open,
  existing,
  onOpenChangeAction,
  onSavedAction,
}: {
  open: boolean;
  existing: EmailDomain | null;
  onOpenChangeAction: (open: boolean) => void;
  onSavedAction: (domain: EmailDomain) => void;
}) {
  useSignals();

  const domain = useSignal("");
  const audience = useSignal<EmailDomainAudience>("student");
  const autoJoin = useSignal(false);
  const staffRole = useSignal<EmailDomainStaffRole>("teacher");
  const saving = useSignal(false);

  // Reset the fields each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    domain.value = existing?.domain ?? "";
    audience.value = existing?.audience ?? "student";
    autoJoin.value = existing?.autoJoin ?? false;
    staffRole.value = existing?.staffRole ?? "teacher";
  }, [open, existing, domain, audience, autoJoin, staffRole]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saving.value = true;
    const staffFields =
      audience.value !== "student"
        ? { autoJoin: autoJoin.value, staffRole: staffRole.value }
        : {};
    try {
      const saved = existing
        ? await api<EmailDomain>(`/schools/email-domains/${existing.id}`, {
            method: "PATCH",
            body: { audience: audience.value, ...staffFields },
          })
        : await api<EmailDomain>("/schools/email-domains", {
            method: "POST",
            body: {
              domain: domain.value.trim(),
              audience: audience.value,
              ...staffFields,
            },
          });
      toast.success(existing ? "Domain updated" : `${saved.domain} added`);
      onSavedAction(saved);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : existing
            ? "Failed to update the domain"
            : "Failed to add the domain",
      );
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existing ? `Edit ${existing.domain}` : "Add email domain"}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? "Change who this domain is for and what happens when they sign in."
              : "You'll publish a DNS record next to prove your school owns it."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {!existing && (
            <div className="space-y-2">
              <Label htmlFor="email-domain">Domain</Label>
              <Input
                id="email-domain"
                placeholder="students.riverside.edu"
                value={domain.value}
                onChange={(e) => (domain.value = e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                e.g. students.riverside.edu - the part after the @ in their
                email address.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Who uses this domain?</Label>
            <RadioGroup
              value={audience.value}
              onValueChange={(v) => (audience.value = v as EmailDomainAudience)}
              className="grid-cols-1 sm:grid-cols-3"
            >
              {(
                [
                  ["student", "Students"],
                  ["staff", "Staff"],
                  ["any", "Students and staff"],
                ] as const
              ).map(([value, label]) => (
                <Label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-primary/5"
                >
                  <RadioGroupItem value={value} />
                  {label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {audience.value === "any" && (
            <p className="text-xs text-muted-foreground">
              Students who sign up join straight away. Anyone signing up as
              staff follows the setting below - leave it off so a student
              can&apos;t make themselves a teacher by choosing staff.
            </p>
          )}

          {audience.value !== "student" && (
            <div className="space-y-4 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="email-domain-autojoin">Join automatically</Label>
                  <p className="text-xs text-muted-foreground">
                    Off: they ask to join and an admin approves them.
                  </p>
                </div>
                <Switch
                  id="email-domain-autojoin"
                  checked={autoJoin.value}
                  onCheckedChange={(v) => (autoJoin.value = v)}
                />
              </div>
              {autoJoin.value && (
                <div className="space-y-2">
                  <Label htmlFor="email-domain-role">Join as</Label>
                  <Select
                    value={staffRole.value}
                    onValueChange={(v) =>
                      (staffRole.value = v as EmailDomainStaffRole)
                    }
                    items={ROLE_ITEMS}
                  >
                    <SelectTrigger id="email-domain-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_ITEMS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChangeAction(false)}
              disabled={saving.value}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {existing ? "Save" : "Add domain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
