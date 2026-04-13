"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, ApiError } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Trash2 } from "lucide-react";

interface Profile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  school: { id: string; name: string } | null;
}

interface School {
  id: string;
  name: string;
  parish: string | null;
  school_type: string | null;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function SettingsPage() {
  useSignals();

  const router = useRouter();
  const profile = useSignal<Profile | null>(null);
  const loading = useSignal(true);
  const saving = useSignal(false);
  const deleting = useSignal(false);
  const deleteOpen = useSignal(false);
  const confirmText = useSignal("");

  const firstName = useSignal("");
  const lastName = useSignal("");
  const schoolId = useSignal("");
  const schools = useSignal<School[]>([]);

  const fetchProfile = useCallback(() => {
    loading.value = true;
    api<Profile>("/auth/me")
      .then((data) => {
        profile.value = data;
        firstName.value = data.first_name || "";
        lastName.value = data.last_name || "";
        schoolId.value = data.school?.id || "";
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    fetchProfile();
    api<School[]>("/schools")
      .then((data) => (schools.value = data))
      .catch(() => {});
  }, [fetchProfile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.value.trim() || !lastName.value.trim()) {
      toast.error("First and last name are required");
      return;
    }
    if (!schoolId.value) {
      toast.error("Please select a school");
      return;
    }
    saving.value = true;
    try {
      const updated = await api<Profile>("/auth/profile", {
        method: "PATCH",
        body: {
          firstName: firstName.value.trim(),
          lastName: lastName.value.trim(),
          schoolId: schoolId.value,
        },
      });
      profile.value = updated;
      toast.success("Profile updated");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to update profile";
      toast.error(message);
    } finally {
      saving.value = false;
    }
  }

  async function handleDeleteAccount() {
    deleting.value = true;
    try {
      await api("/auth/account", { method: "DELETE" });
      clearTokens();
      toast.success("Account deleted");
      router.push("/login");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to delete account";
      toast.error(message);
      deleting.value = false;
    }
  }

  const hasChanges =
    profile.value &&
    (firstName.value.trim() !== (profile.value.first_name || "") ||
      lastName.value.trim() !== (profile.value.last_name || "") ||
      schoolId.value !== (profile.value.school?.id || ""));

  if (loading.value) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Settings"
          description="Manage your account and preferences"
        />
        <Card className="p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Settings"
        description="Manage your account and preferences"
      />

      <Card className="p-6">
        <h2 className="text-lg font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Update your personal information.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName.value}
                onChange={(e) =>
                  (firstName.value = (e.target as HTMLInputElement).value)
                }
                placeholder="Enter your first name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName.value}
                onChange={(e) =>
                  (lastName.value = (e.target as HTMLInputElement).value)
                }
                placeholder="Enter your last name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={profile.value?.email || ""}
              disabled
              className="opacity-60"
            />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed as it is used for authentication.
            </p>
          </div>

          {profile.value?.role && (
            <div className="space-y-2">
              <Label>Role</Label>
              <Input
                value={profile.value.role}
                disabled
                className="capitalize opacity-60"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="school">School</Label>
            <select
              id="school"
              className={selectClass}
              value={schoolId.value}
              onChange={(e) => (schoolId.value = e.target.value)}
            >
              <option value="">Select a school</option>
              {schools.value.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving.value || !hasChanges}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      <Separator />

      <Card className="border-destructive/50 p-6">
        <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          Permanently delete your account and all associated data. This action
          cannot be undone.
        </p>

        <Dialog
          open={deleteOpen.value}
          onOpenChange={(open) => {
            deleteOpen.value = open;
            if (!open) confirmText.value = "";
          }}
        >
          <DialogTrigger
            render={
              <Button variant="destructive">
                <Trash2 className="mr-2 size-4" />
                Delete Account
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Account</DialogTitle>
              <DialogDescription>
                This will permanently delete your account, profile, and remove
                you from all schools. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <Label htmlFor="confirm">
                Type <strong>DELETE</strong> to confirm
              </Label>
              <Input
                id="confirm"
                value={confirmText.value}
                onChange={(e) =>
                  (confirmText.value = (e.target as HTMLInputElement).value)
                }
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>

            <DialogFooter>
              <Button
                variant="destructive"
                disabled={confirmText.value !== "DELETE" || deleting.value}
                onClick={handleDeleteAccount}
              >
                {deleting.value && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Permanently Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}
