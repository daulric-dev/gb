"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  LayoutDashboard,
  Loader2,
  Pencil,
  Power,
  UserCog,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  errorMessage,
  organisationSchoolApi,
  personLabel,
  schoolTypeLabel,
  type OrganisationSchoolDetail,
} from "@/lib/organisation";
import { ORGANISATION_PATH } from "@/lib/routing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadLimitSettings } from "@/app/dashboard/settings/_components/upload-limit-settings";
import { SchoolLogoSettings } from "@/app/dashboard/settings/_components/school-logo-settings";
import { SchoolFeatureSettings } from "@/app/dashboard/settings/_components/school-feature-settings";
import { SchoolSingleSignOn } from "@/app/dashboard/email-domains/_components/SchoolSingleSignOn";
import { SignOutSessionsButton } from "../../_components/sign-out-sessions";
import { AppointAdminDialog, SchoolFormDialog } from "../_components/school-dialogs";
import { toggleSchoolActive, useOpenSchoolDashboard } from "../_components/school-actions";
import { PendingAdminInvite } from "../_components/pending-invite";

const SCHOOLS_PATH = `${ORGANISATION_PATH}/schools`;

/**
 * One school in the organisation console: its details and admin, and the
 * settings an organisation admin configures without switching into it
 * (upload limit, logo, features, and single sign-on: email domains and
 * each one's provider).
 * Everything else is in the school's own dashboard, one click away.
 */
export default function OrganisationSchoolPage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? "";
  const [school, setSchool] = useState<OrganisationSchoolDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [editOpen, setEditOpen] = useState(false);
  const [appointing, setAppointing] = useState(false);
  const { open: openDashboard, switching } = useOpenSchoolDashboard();

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    api<OrganisationSchoolDetail>(organisationSchoolApi(schoolId))
      .then((data) => {
        if (!cancelled) setSchool(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
          setMissing(true);
        } else {
          toast.error(errorMessage(err, "Failed to load the school"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, reloadKey]);

  const back = (
    <Link
      href={SCHOOLS_PATH}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Schools
    </Link>
  );

  if (missing) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <p className="font-medium">School not found</p>
          <p className="text-sm text-muted-foreground">
            It may have been removed, or the link is wrong.
          </p>
        </Card>
      </div>
    );
  }

  if (!school) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const apiBase = organisationSchoolApi(school.id);
  const opening = switching === school.id;

  return (
    <div className="space-y-6">
      {back}

      <div className="flex animate-fade-in-up flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="truncate text-2xl font-bold sm:text-3xl">{school.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={school.isActive ? "default" : "outline"}>
              {school.isActive ? "Active" : "Inactive"}
            </Badge>
            <span>{schoolTypeLabel(school.schoolType)}</span>
            {school.code && <span className="font-mono">{school.code}</span>}
            <span>
              {school.staffCount} staff · {school.studentCount} students
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Admin:</span>
            {school.admin ? (
              <>
                <span className="truncate">{personLabel(school.admin)}</span>
                <SignOutSessionsButton
                  userId={school.admin.userId}
                  who={school.admin.name || school.admin.email}
                />
              </>
            ) : school.pendingAdminInvite ? (
              <PendingAdminInvite invite={school.pendingAdminInvite} onChanged={reload} />
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 size-4" />
            Edit details
          </Button>
          <Button variant="outline" onClick={() => setAppointing(true)}>
            <UserCog className="mr-1.5 size-4" />
            Appoint admin
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void toggleSchoolActive(school).then((ok) => ok && reload())
            }
          >
            <Power className="mr-1.5 size-4" />
            {school.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      <UploadLimitSettings key={`limit-${school.id}`} apiBase={apiBase} canEdit />
      <SchoolLogoSettings
        key={`logo-${school.id}`}
        apiBase={apiBase}
        canEdit
        logoUrl={school.logoUrl}
      />
      <SchoolFeatureSettings apiBase={apiBase} canEdit />

      <Card id="single-sign-on" className="space-y-4 p-6">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Single sign-on</h2>
          <p className="text-sm text-muted-foreground">
            {school.name}&apos;s own sign-in apps (Google Workspace,
            Microsoft Entra) and its email domains: how people at each one
            sign in - one of those apps or the school&apos;s SAML identity
            provider - and whether single sign-on is required.
          </p>
        </div>
        <SchoolSingleSignOn
          key={`sso-${school.id}`}
          apiBase={apiBase}
          schoolName={school.name}
        />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Everything else</h2>
            <p className="text-sm text-muted-foreground">
              Students, staff, calendar, grade scales and roles are managed in
              the school&apos;s own dashboard. Opening it makes
              this your active school.
            </p>
          </div>
          <Button
            onClick={() => openDashboard(school)}
            disabled={!school.isActive || !!switching}
            title={school.isActive ? undefined : "Activate the school first"}
          >
            {opening ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <LayoutDashboard className="mr-1.5 size-4" />
            )}
            Open school dashboard
          </Button>
        </div>
      </Card>

      <SchoolFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={school}
        onSaved={reload}
      />
      <AppointAdminDialog
        school={appointing ? school : null}
        onClose={() => setAppointing(false)}
        onAppointed={reload}
      />
    </div>
  );
}
