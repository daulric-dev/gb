"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CircleDollarSign,
  Clock,
  FileText,
  Lock,
  School,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage, formatMoney } from "@/lib/billing";
import type { PlatformOverview } from "@/lib/billing-types";
import { StatCard } from "@/app/dashboard/_components/StatCard";
import { PlatformHeader } from "./_components/platform-header";
import { GenerateInvoicesButton } from "./_components/generate-invoices-button";

type Tile = {
  icon: LucideIcon;
  label: string;
  value: (o: PlatformOverview) => string | number;
  href?: string;
};

const TILES: Tile[] = [
  { icon: School, label: "Schools", value: (o) => o.schools, href: "/platform/schools" },
  { icon: Clock, label: "Trialing", value: (o) => o.trialing, href: "/platform/schools?status=trialing" },
  { icon: ShieldCheck, label: "Active", value: (o) => o.active, href: "/platform/schools?status=active" },
  { icon: AlertTriangle, label: "Past due", value: (o) => o.pastDue, href: "/platform/schools?status=past_due" },
  { icon: Lock, label: "Read-only", value: (o) => o.readOnly, href: "/platform/schools?status=read_only" },
  { icon: CircleDollarSign, label: "MRR", value: (o) => formatMoney(o.mrrCents, o.currency) },
  { icon: FileText, label: "Open invoices", value: (o) => o.openInvoices, href: "/platform/invoices?status=open" },
];

export default function PlatformOverviewPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);

  const load = useCallback(() => {
    api<PlatformOverview>("/platform/overview")
      .then(setOverview)
      .catch((err) => toast.error(errorMessage(err, "Failed to load overview")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PlatformHeader
        title="Overview"
        description="Subscriptions and revenue across every school on the platform"
        action={<GenerateInvoicesButton onDone={load} />}
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {TILES.map((t) => {
          const card = (
            <StatCard
              icon={t.icon}
              label={t.label}
              value={overview ? t.value(overview) : ""}
              loading={!overview}
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
      <p className="text-sm text-muted-foreground">
        MRR is the monthly amount of the subscriptions currently paying, at
        their plan and seat count.
      </p>
    </div>
  );
}
