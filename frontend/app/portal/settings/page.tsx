"use client";

import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { Card } from "@/components/ui/card";
import { SignedInDevices } from "@/components/account/signed-in-devices";

/**
 * Student account settings: who is signed in, and the devices they are signed
 * in on. Narrower than the staff page on purpose: a student's name and school
 * come from the record their school linked, so there is nothing to edit here.
 */
export default function PortalSettingsPage() {
  useSignals();
  const { profile } = useProfile();
  const student = profile.value;
  const name =
    [student?.first_name, student?.last_name].filter(Boolean).join(" ") ||
    "Student";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Your account and devices</p>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Account</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{name}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium break-all">{student?.email ?? "-"}</dd>
          <dt className="text-muted-foreground">School</dt>
          <dd className="font-medium">{student?.school?.name ?? "-"}</dd>
        </dl>
      </Card>

      <SignedInDevices />
    </div>
  );
}
