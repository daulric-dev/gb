"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import {
  appointedMessage,
  personLabel,
  SCHOOL_TYPES,
  type AppointedSchool,
  type OrganisationSchool,
} from "@/lib/organisation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { userMessage } from "@/lib/errors";

type SchoolForm = {
  name: string;
  code: string;
  schoolType: string;
  adminEmail: string;
};

const EMPTY_FORM: SchoolForm = {
  name: "",
  code: "",
  schoolType: "secondary",
  adminEmail: "",
};

function formFor(editing: OrganisationSchool | null): SchoolForm {
  return editing
    ? {
        name: editing.name,
        code: editing.code ?? "",
        schoolType: editing.schoolType ?? "",
        adminEmail: "",
      }
    : EMPTY_FORM;
}

/**
 * Add a school (`editing` null) or edit one's details. The form starts fresh
 * each time it opens (the dialog's content unmounts when closed); `onSaved`
 * runs after a successful save.
 */
export function SchoolFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: OrganisationSchool | null;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <SchoolFormBody
          editing={editing}
          saving={saving}
          setSaving={setSaving}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function SchoolFormBody({
  editing,
  saving,
  setSaving,
  onClose,
  onSaved,
}: {
  editing: OrganisationSchool | null;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile, refresh } = useAuth();
  const myEmail = profile.value?.email ?? "";
  const [form, setForm] = useState<SchoolForm>(() => formFor(editing));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("Give the school a name");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const body: Record<string, string> = { name, code: form.code.trim() };
        if (form.schoolType) body.schoolType = form.schoolType;
        await api(`/organisation/schools/${editing.id}`, {
          method: "PATCH",
          body,
        });
        toast.success(`${name} updated`);
      } else {
        const body: Record<string, string> = { name };
        if (form.code.trim()) body.code = form.code.trim();
        if (form.schoolType) body.schoolType = form.schoolType;
        if (form.adminEmail.trim()) body.adminEmail = form.adminEmail.trim();
        const created = await api<AppointedSchool>("/organisation/schools", {
          method: "POST",
          body,
        });
        toast.success(
          body.adminEmail
            ? `${name} added. ${appointedMessage(created, body.adminEmail, "admin")}`
            : `${name} added`,
        );
        // Appointed yourself: the school may now be your active one.
        if (myEmail && body.adminEmail?.toLowerCase() === myEmail.toLowerCase()) {
          await refresh();
        }
      }
      onClose();
      onSaved();
    } catch (err) {
      toast.error(
        userMessage(err, editing ? "Failed to update the school" : "Failed to add the school"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit school" : "Add school"}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Change ${editing.name}'s details.`
                : "Create a school in your organisation. If its admin doesn't have an account yet, we'll invite them."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="school-name">Name</Label>
            <Input
              id="school-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Gradebook Academy"
              required
              autoFocus
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="school-code">Code</Label>
              <Input
                id="school-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="school-type">Type</Label>
              <NativeSelect
                id="school-type"
                value={form.schoolType}
                onChange={(e) => setForm({ ...form, schoolType: e.target.value })}
                className="w-full"
              >
                <NativeSelectOption value="">Not set</NativeSelectOption>
                {SCHOOL_TYPES.map((t) => (
                  <NativeSelectOption key={t.value} value={t.value}>
                    {t.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          {!editing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="school-admin">Admin email</Label>
                {myEmail && form.adminEmail !== myEmail && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setForm({ ...form, adminEmail: myEmail })}
                  >
                    Use my email
                  </Button>
                )}
              </div>
              <Input
                id="school-admin"
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                placeholder="Optional - you can appoint one later"
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editing ? "Save" : "Add school"}
            </Button>
          </DialogFooter>
        </form>
  );
}

/**
 * Appoint the admin of `school` (open while non-null): an existing account
 * straight away, or an invite for an email with no account yet.
 */
export function AppointAdminDialog({
  school,
  onClose,
  onAppointed,
}: {
  school: OrganisationSchool | null;
  onClose: () => void;
  onAppointed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={school !== null} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent>
        {school && (
          <AppointAdminForm
            school={school}
            saving={saving}
            setSaving={setSaving}
            onClose={onClose}
            onAppointed={onAppointed}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppointAdminForm({
  school,
  saving,
  setSaving,
  onClose,
  onAppointed,
}: {
  school: OrganisationSchool;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onClose: () => void;
  onAppointed: () => void;
}) {
  // Fresh each time the dialog opens: its content unmounts when closed.
  const [email, setEmail] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      toast.error("Enter the new admin's email");
      return;
    }
    setSaving(true);
    try {
      const result = await api<AppointedSchool>(`/organisation/schools/${school.id}/admin`, {
        method: "PUT",
        body: { email: value },
      });
      toast.success(appointedMessage(result, value, `admin of ${school.name}`));
      onClose();
      onAppointed();
    } catch (err) {
      toast.error(userMessage(err, "Failed to appoint the admin"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Appoint admin</DialogTitle>
        <DialogDescription>
          Makes this account the admin of {school.name}. If they don&apos;t
          have an account yet, we&apos;ll invite them.
          {school.admin ? ` ${personLabel(school.admin)} becomes a teacher.` : ""}
          {!school.admin && school.pendingAdminInvite
            ? ` This replaces the invite to ${school.pendingAdminInvite.email}.`
            : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="appoint-email">Email</Label>
        <Input
          id="appoint-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@example.com"
          required
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
          Appoint
        </Button>
      </DialogFooter>
    </form>
  );
}
