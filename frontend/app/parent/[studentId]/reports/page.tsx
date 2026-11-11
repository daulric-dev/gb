"use client";

import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Download, FileBadge, Loader2 } from "lucide-react";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import { formatPercent } from "@/lib/courses/format";
import { termLabel, type PublishedReport, type Transcript } from "@/lib/report-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useChildData } from "../../_components/use-child-data";
import { Loading, Notice } from "../../_components/ui";

/** The child's published term reports (PDF downloads) and transcript. */
export default function ParentReportsPage() {
  useSignals();
  const { studentId } = useParams<{ studentId: string }>();
  const base = `/parent/children/${studentId}`;
  const reports = useChildData<PublishedReport[]>(`${base}/reports`);
  const transcript = useChildData<Transcript>(reports.error.value ? null : `${base}/transcript`);
  const downloading = useSignal<string | null>(null);

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

  if (reports.loading.value) return <Loading />;
  if (reports.error.value) return <Notice>{reports.error.value}</Notice>;
  const list = reports.data.value ?? [];
  const terms = transcript.data.value?.terms ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        {terms.length > 0 && (
          <Button
            variant="outline"
            disabled={downloading.value !== null}
            onClick={() => download("transcript", `${base}/transcript.pdf`, "transcript.pdf")}
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

      {list.length === 0 ? (
        <Notice>No reports yet. The school publishes a report at the end of each term.</Notice>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => (
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
                      onClick={() => download(r.id, `${base}/reports/${r.id}/file`, `${r.termName}-report.pdf`)}
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

      {terms.length > 0 && (
        <section className="space-y-3" aria-labelledby="transcript-heading">
          <h2 id="transcript-heading" className="text-lg font-semibold">Transcript</h2>
          {terms.map((t) => (
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
