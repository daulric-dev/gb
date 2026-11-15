"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Download, FileBadge, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import { formatPercent } from "@/lib/courses/format";
import { termLabel, type PublishedReport, type Transcript } from "@/lib/report-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "../_components/portal-ui";

/** The student's published term reports (PDF downloads) and transcript. */
export default function PortalReportsPage() {
  useSignals();
  const reports = useSignal<PublishedReport[] | null>(null);
  const transcript = useSignal<Transcript | null>(null);
  const downloading = useSignal<string | null>(null);

  useEffect(() => {
    api<PublishedReport[]>("/portal/me/reports")
      .then((list) => (reports.value = list))
      .catch((err) => {
        reports.value = [];
        toast.error(userMessage(err, "Failed to load your reports"));
      });
    api<Transcript>("/portal/me/transcript")
      .then((t) => (transcript.value = t))
      .catch(() => (transcript.value = null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download(key: string, path: string, fallback: string) {
    downloading.value = key;
    try {
      await downloadFromUrl(path, fallback);
    } catch (err) {
      toast.error(userMessage(err, "Could not download the report"));
    } finally {
      downloading.value = null;
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="mt-1 text-muted-foreground">Your term reports and transcript</p>
        </div>
        {transcript.value && transcript.value.terms.length > 0 && (
          <Button
            variant="outline"
            disabled={downloading.value !== null}
            onClick={() => download("transcript", "/portal/me/transcript.pdf", "transcript.pdf")}
          >
            {downloading.value === "transcript" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            Transcript (PDF)
          </Button>
        )}
      </div>

      {reports.value === null ? (
        <Skeleton className="h-40 w-full" />
      ) : reports.value.length === 0 ? (
        <EmptyState
          icon={FileBadge}
          title="No reports yet"
          description="Your school will publish a report at the end of each term."
        />
      ) : (
        <ul className="space-y-3">
          {reports.value.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 py-4">
                  <FileBadge className="size-5 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{termLabel({ name: r.termName, yearName: r.yearName })}</p>
                    <p className="text-sm text-muted-foreground">
                      Published {new Date(r.publishedAt).toLocaleDateString()}
                    </p>
                  </div>
                  {r.status === "ready" ? (
                    <Button
                      variant="outline"
                      disabled={downloading.value !== null}
                      aria-label={`Download ${r.termName} report`}
                      onClick={() => download(r.id, `/portal/me/reports/${r.id}/file`, `${r.termName}-report.pdf`)}
                    >
                      {downloading.value === r.id ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 size-4" />
                      )}
                      Download
                    </Button>
                  ) : (
                    <Badge variant="outline">Being prepared</Badge>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {transcript.value && transcript.value.terms.length > 0 && (
        <section className="space-y-3" aria-labelledby="transcript-heading">
          <h2 id="transcript-heading" className="text-xl font-semibold">Transcript</h2>
          {transcript.value.terms.map((t) => (
            <div key={`${t.yearName}-${t.termName}`} className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="bg-muted px-3 py-2 text-left font-semibold">
                  {termLabel({ name: t.termName, yearName: t.yearName })}
                </caption>
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 font-medium">Course</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Grade</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Letter</th>
                  </tr>
                </thead>
                <tbody>
                  {t.courses.map((c) => (
                    <tr key={c.name + (c.code ?? "")} className="border-t">
                      <th scope="row" className="px-3 py-1.5 text-left font-normal">{c.name}</th>
                      <td className="px-3 py-1.5 text-right tabular-nums" translate="no">{formatPercent(c.percent)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold" translate="no">{c.letter ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
