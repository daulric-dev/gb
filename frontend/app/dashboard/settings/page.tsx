"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, ApiError } from "@/lib/api";
import { useProfile } from "@/providers/AuthProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { UploadLimitSettings } from "./_components/upload-limit-settings";
import { SchoolLogoSettings } from "./_components/school-logo-settings";
import { SchoolFeatureSettings } from "./_components/school-feature-settings";
import { SchoolSsoSettings } from "./_components/school-sso-settings";
import { AccountSettings } from "@/components/account/account-settings";
import { useMySchools } from "@/hooks/use-my-schools";
import { managingViaOrganisation } from "@/lib/active-school";

export default function SettingsPage() {
  useSignals();

  const router = useRouter();
  const { profile } = useProfile();
  const leaving = useSignal(false);
  // An organisation admin managing the school is not a member: nothing to leave.
  const viaOrganisation = managingViaOrganisation(useMySchools());

  async function handleLeaveSchool() {
    if (!window.confirm("Are you sure you want to leave this school?")) return;
    leaving.value = true;
    try {
      await api("/schools/leave", { method: "POST" });
      toast.success("You have left the school.");
      router.push("/schools")
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to leave school";
      toast.error(message);
      leaving.value = false;
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Settings"
        description="Manage your account and preferences"
      />

      <UploadLimitSettings />

      <SchoolLogoSettings />

      <SchoolFeatureSettings />

      <SchoolSsoSettings />

      <AccountSettings
        profileExtra={
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
              {!viaOrganisation && (
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
              )}
            </div>
          </div>
        }
      />
    </div>
  );
}
