"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, ShieldAlert } from "lucide-react";
import { api, apiQuery } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  emptyNoteForm,
  noteFormOf,
  noteRequest,
  SEVERITY_LABELS,
  type NoteForm,
  type PastoralCategory,
  type PastoralNote,
  type PastoralSeverity,
} from "@/lib/pastoral";
import type { FileItem } from "@/app/dashboard/files/_components/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Write or edit a pastoral note. Safeguarding categories only appear for
 * staff with the safeguarding permission (the server enforces it too); a
 * follow-up can go to staff who could read the note; attachments are your
 * own files.
 */
export function NoteDialog({
  open,
  onOpenChangeAction,
  studentId,
  studentName,
  note,
  onSavedAction,
}: {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  studentId: string;
  studentName?: string | null;
  /** Editing this note; a new note when absent. */
  note?: PastoralNote | null;
  onSavedAction: (note: PastoralNote) => void;
}) {
  useSignals();
  const form = useSignal<NoteForm>(emptyNoteForm());
  const categories = useSignal<PastoralCategory[]>([]);
  const assignees = useSignal<{ id: string; name: string }[]>([]);
  const files = useSignal<FileItem[]>([]);
  const saving = useSignal(false);

  useEffect(() => {
    if (!open) return;
    form.value = note ? noteFormOf(note) : emptyNoteForm();
    api<PastoralCategory[]>("/pastoral/categories")
      .then((c) => (categories.value = c))
      .catch(() => (categories.value = []));
    apiQuery<FileItem[]>("/files", { filter: "own" })
      .then((f) => (files.value = f.filter((x) => x.status === "ready")))
      .catch(() => (files.value = []));
  }, [open, note, form, categories, files]);

  const category = categories.value.find((c) => c.id === form.value.categoryId);
  const safeguarding = category?.isSafeguarding ?? note?.isSafeguarding ?? false;

  useEffect(() => {
    if (!open) return;
    api<{ id: string; name: string }[]>(`/pastoral/assignees?safeguarding=${safeguarding}`)
      .then((a) => (assignees.value = a))
      .catch(() => (assignees.value = []));
  }, [open, safeguarding, assignees]);

  const set = (patch: Partial<NoteForm>) => (form.value = { ...form.value, ...patch });

  function toggleFile(id: string) {
    const ids = form.value.fileIds.includes(id)
      ? form.value.fileIds.filter((f) => f !== id)
      : [...form.value.fileIds, id];
    set({ fileIds: ids });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const checked = noteRequest(form.value, !!note);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    saving.value = true;
    try {
      const saved = note
        ? await api<PastoralNote>(`/pastoral/notes/${note.id}`, { method: "PATCH", body: checked.body })
        : await api<PastoralNote>(`/pastoral/students/${studentId}/notes`, { method: "POST", body: checked.body });
      toast.success(note ? "Note updated" : "Note added");
      onSavedAction(saved);
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the note"));
    } finally {
      saving.value = false;
    }
  }

  // Attachments already on the note stay listed even if they are a colleague's.
  const fileChoices = [
    ...(note?.files ?? []).map((f) => ({ id: f.id, name: f.name })),
    ...files.value.filter((f) => !note?.files.some((n) => n.id === f.id)).map((f) => ({ id: f.id, name: f.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{note ? "Edit note" : "Add a note"}</DialogTitle>
            <DialogDescription>
              {studentName ? `About ${studentName}. ` : ""}
              Private to staff with the pastoral permissions. Never shown to the
              student or their parents.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="noteCategory">Category</Label>
              <NativeSelect id="noteCategory" className="w-full" required value={form.value.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <NativeSelectOption value="">Choose…</NativeSelectOption>
                {categories.value.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.label}
                    {c.isSafeguarding ? " (restricted)" : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noteSeverity">Severity</Label>
              <NativeSelect id="noteSeverity" className="w-full" value={form.value.severity} onChange={(e) => set({ severity: e.target.value as PastoralSeverity })}>
                {Object.entries(SEVERITY_LABELS).map(([v, l]) => (
                  <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noteDate">Date</Label>
              <Input id="noteDate" type="date" required value={form.value.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noteFollowUp">Follow up by (optional)</Label>
              <Input id="noteFollowUp" type="date" value={form.value.followUpOn} onChange={(e) => set({ followUpOn: e.target.value })} />
            </div>
          </div>

          {safeguarding && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Safeguarding notes are only visible to staff with the safeguarding
              permission, and every time one is opened it is recorded in the
              audit log.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="noteBody">Note</Label>
            <Textarea id="noteBody" required rows={6} maxLength={20000} value={form.value.body} onChange={(e) => set({ body: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="noteAssignee">Assigned to (optional)</Label>
            <NativeSelect id="noteAssignee" className="w-full" value={form.value.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>
              <NativeSelectOption value="">Nobody</NativeSelectOption>
              {assignees.value.map((a) => (
                <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {fileChoices.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Attachments from your files</legend>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                {fileChoices.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.value.fileIds.includes(f.id)} onCheckedChange={() => toggleFile(f.id)} />
                    <span className="truncate">{f.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {note ? "Save" : "Add note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
