"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { useAuth, useProfile } from "@/providers/AuthProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOptionalCan, usePermissions } from "@/providers/PermissionsProvider";
import { useFeatures } from "@/hooks/use-features";
import { UploadLimitSettings } from "./_components/upload-limit-settings";
import { SchoolLogoSettings } from "./_components/school-logo-settings";
import { SchoolFeatureSettings } from "./_components/school-feature-settings";
import { SchoolParentSettings } from "./_components/school-parent-settings";
import { SchoolTimetableLink } from "./_components/school-timetable-link";
import { SchoolMasteryLink } from "./_components/school-mastery-link";
import { SchoolSimilaritySettings } from "./_components/school-similarity-settings";
import { SchoolAiSettings } from "./_components/school-ai-settings";
import { SchoolSsoSettings } from "./_components/school-sso-settings";
import { SchoolIntegrationSettings } from "./_components/school-integration-settings";
import { SchoolRecordRetentionSettings } from "./_components/school-record-retention-settings";
import { AccountSettings } from "@/components/account/account-settings";
import { PushContentSetting } from "@/components/notifications/push-content-setting";
import { SchoolOwnership } from "@/components/account/school-ownership";
import { useMySchools } from "@/hooks/use-my-schools";
import { managingViaOrganisation } from "@/lib/active-school";
import { userMessage } from "@/lib/errors";

/** Tabs of the settings page; `?tab=` selects one (links from errors and emails). */
const TABS = ["account", "school", "features", "ai", "sign-in", "data"] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsTabs />
    </Suspense>
  );
}

function SettingsTabs() {
  useSignals();

  const router = useRouter();
  const { profile } = useProfile();
  const { refreshSilently } = useAuth();
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
      const message = userMessage(err, "Failed to leave school");
      toast.error(message);
      leaving.value = false;
    }
  }

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const can = useOptionalCan();
  const { isAdmin } = usePermissions();
  const { hasFeature } = useFeatures();

  // Which school tabs have anything in them for this person (each card also
  // hides itself without its permission).
  const manageSchool = can("school", "update");
  const shown: Record<Tab, boolean> = {
    account: true,
    school: manageSchool,
    features: manageSchool,
    ai: manageSchool && hasFeature("ai_assistance"),
    "sign-in": manageSchool && isAdmin,
    data: manageSchool || can("student", "erase"),
  };
  const requested = searchParams?.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && shown[requested] ? requested : "account";

  function selectTab(value: unknown) {
    const next = String(value);
    const params = new URLSearchParams(searchParams?.toString());
    if (next === "account") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Settings"
        description="Manage your account and your school"
      />

      <Tabs value={tab} onValueChange={selectTab}>
        {/* Fills the width like the cards below; scrolls sideways on narrow screens. */}
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="w-full min-w-max">
            <TabsTrigger value="account" className="px-3">Account</TabsTrigger>
            {shown.school && <TabsTrigger className="px-3" value="school">School</TabsTrigger>}
            {shown.features && <TabsTrigger className="px-3" value="features">Features</TabsTrigger>}
            {shown.ai && <TabsTrigger className="px-3" value="ai">AI</TabsTrigger>}
            {shown["sign-in"] && <TabsTrigger className="px-3" value="sign-in">Sign-in &amp; integrations</TabsTrigger>}
            {shown.data && <TabsTrigger className="px-3" value="data">Data &amp; privacy</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="account" className="space-y-6 pt-4">
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
        </TabsContent>

        {shown.school && (
          <TabsContent value="school" className="space-y-6 pt-4">
            <SchoolLogoSettings />
            <UploadLimitSettings />
            <SchoolOwnership
              schoolId={profile.value?.school?.id}
              // Their role in the school may have changed (admin -> teacher).
              onTransferred={() => void refreshSilently()}
            />
          </TabsContent>
        )}

        {shown.features && (
          <TabsContent value="features" className="space-y-6 pt-4">
            <SchoolFeatureSettings />
            <SchoolParentSettings />
            <SchoolTimetableLink />
            <SchoolMasteryLink />
            <SchoolSimilaritySettings />
          </TabsContent>
        )}

        {shown.ai && (
          <TabsContent value="ai" className="space-y-6 pt-4">
            <SchoolAiSettings />
          </TabsContent>
        )}

        {shown["sign-in"] && (
          <TabsContent value="sign-in" className="space-y-6 pt-4">
            <SchoolSsoSettings />
            <SchoolIntegrationSettings />
          </TabsContent>
        )}

        {shown.data && (
          <TabsContent value="data" className="space-y-6 pt-4">
            <SchoolRecordRetentionSettings />
            <PushContentSetting scope="school" />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
