"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CalendarClock, EyeOff, Paperclip, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import {
  canWithholdNote,
  followUpState,
  formatDay,
  SEVERITY_LABELS,
  type PastoralCategory,
  type NoteFilters,
  type PastoralNote,
} from "@/lib/pastoral";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { NoteDialog } from "./NoteDialog";
import { WithholdDialog } from "./WithholdDialog";
import { useOptionalCan } from "@/providers/PermissionsProvider";

const FOLLOW_UP_TEXT = { overdue: "Overdue", today: "Due today", upcoming: "Follow up" } as const;

/** Filters shared by the timeline and the school list. */
export function NoteFilterBar({
  value,
  onChangeAction,
  categories,
  idPrefix,
}: {
  value: NoteFilters;
  onChangeAction: (next: NoteFilters) => void;
  categories: PastoralCategory[];
  idPrefix: string;
}) {
  const set = (patch: Partial<NoteFilters>) => onChangeAction({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-category`}>Category</Label>
        <NativeSelect id={`${idPrefix}-category`} className="w-full" value={value.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value })}>
          <NativeSelectOption value="">All</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>{c.label}</NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-status`}>Status</Label>
        <NativeSelect id={`${idPrefix}-status`} className="w-full" value={value.status ?? ""} onChange={(e) => set({ status: e.target.value as NoteFilters["status"] })}>
          <NativeSelectOption value="">All</NativeSelectOption>
          <NativeSelectOption value="open">Open</NativeSelectOption>
          <NativeSelectOption value="resolved">Resolved</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-severity`}>Severity</Label>
        <NativeSelect id={`${idPrefix}-severity`} className="w-full" value={value.severity ?? ""} onChange={(e) => set({ severity: e.target.value as NoteFilters["severity"] })}>
          <NativeSelectOption value="">All</NativeSelectOption>
          {Object.entries(SEVERITY_LABELS).map(([v, l]) => (
            <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-from`}>From</Label>
        <Input id={`${idPrefix}-from`} type="date" value={value.from ?? ""} onChange={(e) => set({ from: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-to`}>To</Label>
        <Input id={`${idPrefix}-to`} type="date" value={value.to ?? ""} onChange={(e) => set({ to: e.target.value })} />
      </div>
    </div>
  );
}

/**
 * Notes, newest first: category, severity, follow-up state, body,
 * attachments, and edit / resolve / delete where the caller may.
 */
export function NoteList({
  notes,
  showStudent,
  onChangedAction,
  emptyText,
}: {
  notes: PastoralNote[];
  showStudent?: boolean;
  onChangedAction: () => void;
  emptyText: string;
}) {
  useSignals();
  const editing = useSignal<PastoralNote | null>(null);
  const withholding = useSignal<PastoralNote | null>(null);
  const busy = useSignal<string | null>(null);
  const can = useOptionalCan();

  async function setStatus(n: PastoralNote, status: "open" | "resolved") {
    busy.value = n.id;
    try {
      await api(`/pastoral/notes/${n.id}`, { method: "PATCH", body: { status } });
      toast.success(status === "resolved" ? "Marked resolved" : "Reopened");
      onChangedAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to update the note"));
    } finally {
      busy.value = null;
    }
  }

  async function remove(n: PastoralNote) {
    if (!confirm("Delete this note for good? This cannot be undone.")) return;
    busy.value = n.id;
    try {
      await api(`/pastoral/notes/${n.id}`, { method: "DELETE" });
      toast.success("Note deleted");
      onChangedAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to delete the note"));
    } finally {
      busy.value = null;
    }
  }

  async function openFile(n: PastoralNote, fileId: string, name: string) {
    try {
      await downloadFromUrl(`/pastoral/notes/${n.id}/files/${fileId}`, name);
    } catch (err) {
      toast.error(userMessage(err, "Failed to open the file"));
    }
  }

  if (notes.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <ol className="space-y-3">
        {notes.map((n) => {
          const due = followUpState(n);
          return (
            <li key={n.id}>
              <Card className={n.isSafeguarding ? "border-amber-500/50" : undefined}>
                <CardContent className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{formatDay(n.occurredOn)}</span>
                    {showStudent && (
                      <Link href={`/dashboard/students/${n.studentId}`} className="text-sm hover:underline">
                        {n.studentName ?? "Student"}
                      </Link>
                    )}
                    <Badge variant="outline" className={n.isSafeguarding ? "gap-1 border-amber-500/60" : undefined}>
                      {n.isSafeguarding && <ShieldAlert className="size-3" aria-hidden="true" />}
                      {n.categoryLabel}
                    </Badge>
                    <Badge variant={n.severity === "high" ? "destructive" : "secondary"}>
                      {SEVERITY_LABELS[n.severity]}
                    </Badge>
                    {n.status === "resolved" ? (
                      <Badge variant="secondary">Resolved</Badge>
                    ) : (
                      <Badge>Open</Badge>
                    )}
                    {n.sarWithheld && (
                      <Badge
                        variant="outline"
                        className="gap-1"
                        title={n.sarWithheldReason ? `Reason: ${n.sarWithheldReason}` : undefined}
                      >
                        <EyeOff className="size-3" aria-hidden="true" />
                        Withheld from data requests
                      </Badge>
                    )}
                    {due && (
                      <span className={`inline-flex items-center gap-1 text-xs ${due === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                        <CalendarClock className="size-3" aria-hidden="true" />
                        {FOLLOW_UP_TEXT[due]} {formatDay(n.followUpOn)}
                        {n.assignedToName ? ` · ${n.assignedToName}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  {n.files.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {n.files.map((f) => (
                        <li key={f.id}>
                          <Button size="xs" variant="outline" onClick={() => void openFile(n, f.id, f.name)}>
                            <Paperclip className="size-3" aria-hidden="true" />
                            {f.name}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {n.authorName ? `By ${n.authorName}` : "Author left the school"}
                    </span>
                    {n.canEdit && (
                      <>
                        <Button size="xs" variant="ghost" onClick={() => (editing.value = n)}>Edit</Button>
                        <Button size="xs" variant="ghost" disabled={busy.value === n.id} onClick={() => void setStatus(n, n.status === "open" ? "resolved" : "open")}>
                          {n.status === "open" ? "Mark resolved" : "Reopen"}
                        </Button>
                      </>
                    )}
                    {canWithholdNote(n, can) && (
                      <Button size="xs" variant="ghost" disabled={busy.value === n.id} onClick={() => (withholding.value = n)}>
                        {n.sarWithheld ? "Include in data requests" : "Withhold from data requests"}
                      </Button>
                    )}
                    {n.canDelete && (
                      <Button size="xs" variant="ghost" className="text-destructive" disabled={busy.value === n.id} onClick={() => void remove(n)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
      {withholding.value && (
        <WithholdDialog
          note={withholding.value}
          onOpenChangeAction={(v) => {
            if (!v) withholding.value = null;
          }}
          onSavedAction={() => onChangedAction()}
        />
      )}
      {editing.value && (
        <NoteDialog
          open={!!editing.value}
          onOpenChangeAction={(v) => {
            if (!v) editing.value = null;
          }}
          studentId={editing.value.studentId}
          studentName={editing.value.studentName}
          note={editing.value}
          onSavedAction={() => onChangedAction()}
        />
      )}
    </>
  );
}
