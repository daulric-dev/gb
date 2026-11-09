"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Globe, Plus } from "lucide-react";
import { isFeatureDisabledError } from "@/lib/features";
import { userMessage } from "@/lib/errors";
import { downloadFromUrl } from "@/lib/download";
import { ORGANISATION_PATH } from "@/lib/routing";
import {
  listSources,
  ROSTERING_API,
  STATUS_LABELS,
  TEMPLATE_KINDS,
  type RosterSource,
} from "@/lib/rostering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgHeader } from "../_components/org-header";
import { AddSourceDialog } from "./_components/add-source-dialog";

/** Rostering sources: CSV uploads or OneRoster endpoints, with their last sync. */
export default function RosteringPage() {
  const [sources, setSources] = useState<RosterSource[] | null>(null);
  const [off, setOff] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(() => {
    listSources()
      .then((s) => (setSources(s), setOff(false)))
      .catch((err) => {
        if (isFeatureDisabledError(err)) setOff(true);
        else toast.error(userMessage(err, "Failed to load rostering sources"));
      });
  }, []);
  useEffect(load, [load]);

  async function template(kind: string) {
    try {
      await downloadFromUrl(`${ROSTERING_API}/templates/${kind}`, `gradebook-${kind}.csv`);
    } catch (err) {
      toast.error(userMessage(err, "Failed to download the template"));
    }
  }

  const header = (
    <OrgHeader
      title="Rostering"
      description="Import or sync students, staff, classes and enrolments from your SIS"
      action={
        !off && (
          <Button onClick={() => (setFormKey((k) => k + 1), setAdding(true))}>
            <Plus className="mr-1.5 size-4" />
            Add source
          </Button>
        )
      }
    />
  );

  if (off) {
    return (
      <div className="space-y-6">
        {header}
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Rostering is turned off. Switch on &ldquo;Rostering sync (OneRoster, CSV)&rdquo; under Features
          to use it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section aria-labelledby="sources-heading" className="space-y-3">
        <h2 id="sources-heading" className="text-lg font-semibold">
          Sources
        </h2>
        {!sources ? (
          <Skeleton className="h-32 w-full" />
        ) : sources.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No sources yet. Add a CSV source to upload a OneRoster bundle or the templates below, or
            connect a OneRoster 1.2 endpoint.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {sources.map((s) => (
              <li key={s.id}>
                <Link
                  href={`${ORGANISATION_PATH}/rostering/${s.id}`}
                  className="block rounded-xl border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {s.kind === "csv" ? (
                          <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
                        ) : (
                          <Globe className="size-4 shrink-0" aria-hidden />
                        )}
                        <span className="truncate">{s.name}</span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {s.kind === "csv" ? "CSV upload" : "OneRoster 1.2 endpoint"}
                        {s.schedule === "daily" && " · daily"}
                        {s.autoApply && " · auto-apply"}
                      </p>
                    </div>
                    {s.lastRun && (
                      <Badge variant={s.lastRun.status === "failed" ? "destructive" : "secondary"}>
                        {STATUS_LABELS[s.lastRun.status]}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {s.lastRun
                      ? `Last sync ${new Date(s.lastRun.createdAt).toLocaleString()}`
                      : "Never synced"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>CSV templates</CardTitle>
          <CardDescription>
            Without a OneRoster export, fill in these templates (one row per record) and upload
            them to a CSV source. Leave the school column blank to use the school you map
            &ldquo;Default school&rdquo; to.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {TEMPLATE_KINDS.map((t) => (
            <Button key={t.kind} variant="outline" size="sm" onClick={() => void template(t.kind)}>
              <Download className="mr-1.5 size-4" />
              {t.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <AddSourceDialog
        key={formKey}
        open={adding}
        onOpenChangeAction={setAdding}
        onCreatedAction={(s) => {
          setAdding(false);
          setSources((list) => [...(list ?? []), s]);
        }}
      />
    </div>
  );
}
