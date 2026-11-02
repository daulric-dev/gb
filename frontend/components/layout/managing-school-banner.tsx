"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useMySchools } from "@/hooks/use-my-schools";
import { activeSchoolOf, schoolLabel } from "@/lib/active-school";
import { ORGANISATION_PATH } from "@/lib/routing";

/**
 * Shown across the dashboard while an organisation admin manages a school
 * they are not a member of, with the way back to the organisation console.
 */
export function ManagingSchoolBanner() {
  useSignals();
  const active = activeSchoolOf(useMySchools());
  if (!active?.viaOrganisation) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/60 px-4 py-2 text-sm md:px-6">
      <Building2 className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        Managing <span className="font-medium">{schoolLabel(active)}</span> as
        organisation administrator
      </span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <Link
        href={`${ORGANISATION_PATH}/schools`}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to organisation
      </Link>
    </div>
  );
}
