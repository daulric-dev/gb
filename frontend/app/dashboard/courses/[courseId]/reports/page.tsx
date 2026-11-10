"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CheckCheck, FileBadge, Loader2, Lock, Save } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { formatPercent, personName } from "@/lib/courses/format";
import {
  changedComments,
  deadlineState,
  draftErrors,
  initialDrafts,
  markAllReady,
  REPORT_COMMENT_MAX,
  termLabel,
  type CommentDraft,
  type CourseReportComments,
} from "@/lib/report-cards";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";

/**
 * Report comments for one course and term: one row per student with their
 * final grade for the term, a comment and a "ready" tick. Changes are kept
 * locally and saved together.
 */
export default function CourseReportCommentsPage() {
  useSignals();
  const { course } = useCourse();

  const data = useSignal<CourseReportComments | null>(null);
  const drafts = useSignal<Record<string, CommentDraft>>({});
  const termId = useSignal<string | null>(null);
  const loading = useSignal(true);
  const saving = useSignal(false);

  async function load(term?: string | null) {
    loading.value = true;
    try {
      const q = term ? `?termId=${encodeURIComponent(term)}` : "";
      const out = await api<CourseReportComments>(`/courses/${course.id}/report-comments${q}`);
      data.value = out;
      drafts.value = initialDrafts(out.students);
      termId.value = out.term?.id ?? null;
    } catch (err) {
      toast.error(userMessage(err, "Failed to load report comments"));
    } finally {
      loading.value = false;
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  const d = data.value;
  const changes = d ? changedComments(d.students, drafts.value) : [];
  const errors = draftErrors(changes);

  async function save() {
    if (!d?.term || changes.length === 0) return;
    if (Object.keys(errors).length) {
      toast.error("Fix the highlighted comments first");
      return;
    }
    saving.value = true;
    try {
      const out = await api<CourseReportComments>(`/courses/${course.id}/report-comments`, {
        method: "PUT",
        body: { termId: d.term.id, comments: changes },
      });
      data.value = out;
      drafts.value = initialDrafts(out.students);
      toast.success(`Saved ${changes.length} comment${changes.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(userMessage(err, "Could not save the comments"));
    } finally {
      saving.value = false;
    }
  }

  function edit(studentId: string, patch: Partial<CommentDraft>) {
    drafts.value = { ...drafts.value, [studentId]: { ...drafts.value[studentId], ...patch } };
  }

  const deadline = d ? deadlineState(d.deadline) : "none";
  const header = (
    <SectionHeader
      title="Report comments"
      description={
        d?.term
          ? `${termLabel(d.term)} · write a comment for each student and tick it ready`
          : "Comments for each student's term report"
      }
      actions={
        d?.canEdit ? (
          <>
            <Button
              variant="outline"
              onClick={() => (drafts.value = markAllReady(drafts.value))}
              disabled={saving.value}
            >
              <CheckCheck className="mr-2 size-4" />
              Mark written ready
            </Button>
            <Button onClick={save} disabled={saving.value || changes.length === 0}>
              {saving.value ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              Save{changes.length ? ` (${changes.length})` : ""}
            </Button>
          </>
        ) : undefined
      }
    />
  );

  if (loading.value && !d) {
    return (
      <div className="space-y-5">
        {header}
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!d || !d.term) {
    return (
      <div className="space-y-5">
        {header}
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileBadge />
            </EmptyMedia>
            <EmptyTitle>No report term</EmptyTitle>
            <EmptyDescription>
              Set the course&apos;s academic year or term in its settings to write report comments.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const ready = d.students.filter((s) => drafts.value[s.studentId]?.status === "ready").length;

  return (
    <div className="space-y-4">
      {header}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {d.terms.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Term</span>
            <NativeSelect
              size="sm"
              value={termId.value ?? ""}
              onChange={(e) => {
                if (changes.length && !window.confirm("Discard unsaved comments?")) return;
                void load(e.target.value);
              }}
            >
              {d.terms.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {termLabel(t)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
        {d.deadline && (
          <Badge
            variant={deadline === "passed" ? "destructive" : deadline === "soon" ? "secondary" : "outline"}
          >
            {deadline === "passed" ? "Deadline passed" : "Due"}{" "}
            {new Date(d.deadline).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </Badge>
        )}
        {d.publishedAt && (
          <Badge variant="secondary">
            <Lock className="mr-1 size-3" />
            Published; ask an admin to unpublish to change comments
          </Badge>
        )}
        <span className="ml-auto text-muted-foreground" aria-live="polite">
          {ready} of {d.students.length} ready
        </span>
      </div>

      {d.students.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No students enrolled</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Student</th>
                <th scope="col" className="w-28 px-3 py-2 text-right font-semibold">Term grade</th>
                <th scope="col" className="px-3 py-2 font-semibold">Comment</th>
                <th scope="col" className="w-20 px-3 py-2 text-center font-semibold">Ready</th>
              </tr>
            </thead>
            <tbody>
              {d.students.map((s) => {
                const draft = drafts.value[s.studentId];
                const err = errors[s.studentId];
                const name = personName(s);
                return (
                  <tr key={s.studentId} className="border-t align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">{name}</th>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPercent(s.percent)}
                      {s.letter && (
                        <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                          {s.letter}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Textarea
                        aria-label={`Comment for ${name}`}
                        aria-invalid={!!err || undefined}
                        value={draft?.body ?? ""}
                        maxLength={REPORT_COMMENT_MAX}
                        disabled={!d.canEdit}
                        rows={2}
                        className={cn("min-h-16", err && "border-destructive")}
                        onChange={(e) => edit(s.studentId, { body: e.target.value })}
                      />
                      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Checkbox
                        aria-label={`${name}'s comment is ready`}
                        checked={draft?.status === "ready"}
                        disabled={!d.canEdit}
                        onCheckedChange={(v) => edit(s.studentId, { status: v ? "ready" : "draft" })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
