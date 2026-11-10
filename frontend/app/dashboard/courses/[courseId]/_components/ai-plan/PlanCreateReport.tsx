"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleMinus } from "lucide-react";
import type { PlanCreateResult } from "@/lib/ai";
import { ITEM_KIND_LABEL } from "@/lib/ai-course-plan";

const STATUS_TEXT = {
  created: "Created",
  existing: "Already there",
  failed: "Not created",
  not_added: "Created, not in the module",
  skipped: "Skipped",
} as const;

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <CircleMinus className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  return ok ? (
    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
  ) : (
    <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
  );
}

/**
 * What "Create selected" did: every module, item, assignment group and
 * outcome with its status (failures with the reason), links to what was
 * created, and for quizzes a link that opens "Draft questions with AI".
 */
export function PlanCreateReport({ result, base }: { result: PlanCreateResult; base: string }) {
  const href = (kind: string, id: string) =>
    kind === "page" ? `${base}/pages/${id}` : kind === "quiz" ? `${base}/assignments/${id}?aiDraft=1` : `${base}/assignments/${id}`;

  return (
    <section aria-label="What was created" className="space-y-4" aria-live="polite">
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {result.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {(result.groups.length > 0 || result.outcomes.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.groups.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Assignment groups</h4>
              <ul className="space-y-1 text-sm">
                {result.groups.map((g) => (
                  <li key={g.name} className="flex items-start gap-2">
                    <StatusIcon ok={g.status !== "failed"} />
                    <span>
                      {g.name} · {STATUS_TEXT[g.status]}
                      {g.error && <span className="text-destructive"> ({g.error})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.outcomes.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Outcomes</h4>
              <ul className="space-y-1 text-sm">
                {result.outcomes.map((o) => (
                  <li key={o.code} className="flex items-start gap-2">
                    <StatusIcon ok={o.status !== "failed"} />
                    <span>
                      <span className="font-mono text-xs">{o.code}</span> {o.title} · {STATUS_TEXT[o.status]}
                      {o.error && <span className="text-destructive"> ({o.error})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <ol className="space-y-3">
        {result.modules.map((m, i) => (
          <li key={`${m.title}-${i}`} className="rounded-md border p-3">
            <p className="flex items-start gap-2 text-sm font-medium">
              <StatusIcon ok={m.status !== "failed"} />
              <span>
                {m.title} · {STATUS_TEXT[m.status]}
                {m.error && <span className="font-normal text-destructive"> ({m.error})</span>}
              </span>
            </p>
            <ul className="mt-2 space-y-1 pl-6 text-sm">
              {m.items.map((it, j) => (
                <li key={`${it.title}-${j}`} className="flex items-start gap-2">
                  <StatusIcon ok={it.status === "skipped" ? null : it.status === "created" && !it.error} />
                  <span>
                    {ITEM_KIND_LABEL[it.kind]}:{" "}
                    {it.id ? (
                      <Link className="underline underline-offset-2" href={href(it.kind, it.id)}>
                        {it.title}
                      </Link>
                    ) : (
                      it.title
                    )}{" "}
                    · {STATUS_TEXT[it.status]}
                    {it.dueAt && ` · due ${new Date(it.dueAt).toLocaleDateString()}`}
                    {it.aligned.length > 0 && ` · aligned to ${it.aligned.join(", ")}`}
                    {it.error && <span className="text-destructive"> ({it.error})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {result.draftQuestions && result.quizzes.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium">Draft questions for your quizzes</h4>
          <p className="mb-2 text-sm text-muted-foreground">
            Each link opens the quiz builder with &quot;Draft questions with AI&quot; ready, using the quiz&apos;s topic. Every question is added
            only when you accept it.
          </p>
          <ul className="space-y-1 text-sm">
            {result.quizzes.map((q) => (
              <li key={q.activityId}>
                <Link className="underline underline-offset-2" href={`${base}/assignments/${q.activityId}?aiDraft=1`}>
                  {q.title}
                </Link>
                {q.questionCount ? ` (${q.questionCount} questions planned)` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
