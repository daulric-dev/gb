"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, apiUpload, ApiError } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { AvatarCropDialog } from "@/components/dashboard/avatar-crop-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Camera, Loader2, Trash2 } from "lucide-react";
import type { Profile } from "./_components/types";

export default function SettingsPage() {
  useSignals();

  const router = useRouter();
  const profile = useSignal<Profile | null>(null);
  const loading = useSignal(true);
  const saving = useSignal(false);
  const leaving = useSignal(false);
  const deleting = useSignal(false);
  const deleteOpen = useSignal(false);
  const confirmText = useSignal("");

  const firstName = useSignal("");
  const lastName = useSignal("");

  const avatarUrl = useSignal<string | null>(null);
  const cropSrc = useSignal<string | null>(null);
  const cropOpen = useSignal(false);
  const uploading = useSignal(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = useCallback(() => {
    loading.value = true;
    api<Profile>("/auth/me")
      .then((data) => {
        profile.value = data;
        firstName.value = data.first_name || "";
        lastName.value = data.last_name || "";
        avatarUrl.value = data.avatar_url || null;
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.value.trim() || !lastName.value.trim()) {
      toast.error("First and last name are required");
      return;
    }
    saving.value = true;
    try {
      const updated = await api<Profile>("/auth/profile", {
        method: "PATCH",
        body: {
          firstName: firstName.value.trim(),
          lastName: lastName.value.trim(),
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

  async function handleLeaveSchool() {
    if (!window.confirm("Are you sure you want to leave this school?")) return;
    leaving.value = true;
    try {
      await api("/schools/leave", { method: "POST" });
      toast.success("You have left the school.");
      window.location.href = "/schools";
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to leave school";
      toast.error(message);
      leaving.value = false;
    }
  }

  async function handleDeleteAccount() {
    deleting.value = true;
    try {
      await api("/auth/account", { method: "DELETE" });
      toast.success("Account deleted");
      router.push("/login");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to delete account";
      toast.error(message);
      deleting.value = false;
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Only JPEG, PNG, and WebP images are allowed");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      cropSrc.value = reader.result as string;
      cropOpen.value = true;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleCropConfirm(blob: Blob) {
    uploading.value = true;
    try {
      const formData = new FormData();
      formData.append("file", blob, "avatar.jpg");
      const result = await apiUpload<{ avatar_url: string }>("/auth/avatar", formData);
      avatarUrl.value = result.avatar_url;
      toast.success("Profile picture updated");
      cropOpen.value = false;
      cropSrc.value = null;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to upload image";
      toast.error(message);
    } finally {
      uploading.value = false;
    }
  }

  function getInitials() {
    const f = firstName.value?.[0] || profile.value?.first_name?.[0] || "";
    const l = lastName.value?.[0] || profile.value?.last_name?.[0] || "";
    return `${f}${l}`.toUpperCase() || "?";
  }

  const hasChanges =
    profile.value &&
    (firstName.value.trim() !== (profile.value.first_name || "") ||
      lastName.value.trim() !== (profile.value.last_name || ""));

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
        <h2 className="text-lg font-semibold">Profile Picture</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Click to upload or change your profile picture.
        </p>

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar size="lg" className="size-20">
              {avatarUrl.value && (
                <AvatarImage src={avatarUrl.value} alt="Profile picture" />
              )}
              <AvatarFallback className="text-lg">{getInitials()}</AvatarFallback>
            </Avatar>
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-5 text-white" />
            </span>
          </button>
          <div className="space-y-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Change Picture
            </Button>
            <p className="text-xs text-muted-foreground">
              JPG, PNG or WebP. Max 5MB.
            </p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />

        <AvatarCropDialog
          imageSrc={cropSrc.value}
          open={cropOpen.value}
          onOpenChange={(v) => (cropOpen.value = v)}
          onConfirm={handleCropConfirm}
          uploading={uploading.value}
        />
      </Card>

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
            <Label>School</Label>
            <div className="flex items-center gap-3">
              <Input
                value={profile.value?.school?.name || "No school"}
                disabled
                className="opacity-60"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => router.push("/schools")}
              >
                Change
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0"
                disabled={leaving.value}
                onClick={handleLeaveSchool}
              >
                {leaving.value ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : null}
                Leave
              </Button>
            </div>
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
