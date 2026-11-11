"use client";

import { CheckCircle2, CircleDashed, Circle } from "lucide-react";
import {
  STATUS_LABEL,
  SOURCE_LABEL,
  calculationSummary,
  formatEvidenceDate,
  levelTone,
  type LevelTone,
  type MasteryResult,
  type MasteryScale,
  type OutcomeProgress,
} from "@/lib/mastery";
import { cn } from "@/lib/utils";
import { NoTranslate } from "@/components/translation/no-translate";

const TONE_CLASS: Record<LevelTone, string> = {
  none: "border-dashed border-border bg-transparent text-muted-foreground",
  low: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  mid: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  high: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  top: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
};

export function toneClass(level: number | null, scale: MasteryScale): string {
  return TONE_CLASS[levelTone(level, scale)];
}

/** A level as a coloured chip with its label (never colour alone). */
export function LevelBadge({
  level,
  label,
  scale,
  className,
}: {
  level: number | null;
  label: string | null;
  scale: MasteryScale;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClass(level, scale),
        className,
      )}
    >
      {label ?? "No evidence"}
    </span>
  );
}

/** Mastered / not yet / needs more evidence, with an icon and text. */
export function StatusText({ result }: { result: MasteryResult }) {
  const Icon = result.mastered ? CheckCircle2 : result.status === "no_evidence" ? CircleDashed : Circle;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className={cn("size-3.5", result.mastered && "text-emerald-700 dark:text-emerald-400")} aria-hidden />
      {STATUS_LABEL[result.status]}
    </span>
  );
}

/** The scale's levels as a legend. */
export function ScaleLegend({ scale }: { scale: MasteryScale }) {
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-1.5" aria-label="Proficiency scale">
        {scale.levels.map((l) => (
          <li key={l.value}>
            <LevelBadge level={l.value} label={`${l.value} ${l.label}`} scale={scale} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{calculationSummary(scale)}</p>
    </div>
  );
}

/**
 * Outcomes with their mastery and evidence timeline (newest first). Used by
 * the teacher's student view, the student portal and the parent portal.
 */
export function OutcomeProgressList({
  outcomes,
  scale,
  headingLevel = 3,
}: {
  outcomes: OutcomeProgress[];
  scale: MasteryScale;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  if (outcomes.length === 0) {
    return <p className="text-sm text-muted-foreground">No outcomes are tracked here yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {outcomes.map((o) => (
        <li key={o.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Heading className="text-sm font-medium">
                <span className="font-mono text-muted-foreground">{o.code}</span> {o.title}
              </Heading>
              {o.setTitle && <p className="text-xs text-muted-foreground">{o.setTitle}</p>}
            </div>
            <div className="flex flex-col items-end gap-1" translate="no">
              <LevelBadge level={o.mastery.level} label={o.mastery.label} scale={scale} />
              <StatusText result={o.mastery} />
            </div>
          </div>
          {o.evidence.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Evidence ({o.evidence.length})
                {o.mastery.score !== null && <> · score {o.mastery.score}</>}
              </summary>
              <ol className="mt-2 space-y-1.5 border-l pl-3" aria-label={`Evidence for ${o.code}, newest first`}>
                {o.evidence.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{e.activityTitle}</p>
                      <p className="text-xs text-muted-foreground" translate="no">
                        {formatEvidenceDate(e.assessedAt)} · {SOURCE_LABEL[e.source]}
                        {e.detail ? `: ${e.detail}` : ""} · {e.percent}%
                      </p>
                    </div>
                    <NoTranslate>
                      <LevelBadge level={e.level} label={e.label} scale={scale} />
                    </NoTranslate>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
