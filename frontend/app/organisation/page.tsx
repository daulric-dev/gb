"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  GraduationCap,
  School,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  type OrganisationOverview,
} from "@/lib/organisation";
import { StatCard } from "@/app/dashboard/_components/StatCard";
import { OrgHeader } from "./_components/org-header";
import { SchoolDomains } from "./_components/school-domains";
import { userMessage } from "@/lib/errors";

type Tile = {
  icon: LucideIcon;
  label: string;
  value: (o: OrganisationOverview) => number;
  href?: string;
};

const TILES: Tile[] = [
  { icon: School, label: "Schools", value: (o) => o.schools, href: "/organisation/schools?status=all" },
  { icon: ShieldCheck, label: "Active schools", value: (o) => o.activeSchools, href: "/organisation/schools?status=active" },
  { icon: UsersRound, label: "Staff", value: (o) => o.staff },
  { icon: GraduationCap, label: "Students", value: (o) => o.students },
];

export default function OrganisationOverviewPage() {
  useSignals();
  const overview = useSignal<OrganisationOverview | null>(null);

  useEffect(() => {
    api<OrganisationOverview>("/organisation/overview")
      .then((o) => (overview.value = o))
      .catch((err) => toast.error(userMessage(err, "Failed to load overview")));
  }, [overview]);

  return (
    <div className="space-y-6">
      <OrgHeader
        title="Overview"
        description="Schools and people across your organisation"
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {TILES.map((t) => {
          const card = (
            <StatCard
              icon={t.icon}
              label={t.label}
              value={overview.value ? t.value(overview.value) : ""}
              loading={!overview.value}
            />
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="rounded-xl transition-opacity hover:opacity-80">
              {card}
            </Link>
          ) : (
            <div key={t.label}>{card}</div>
          );
        })}
      </div>
      <SchoolDomains />
    </div>
  );
}
