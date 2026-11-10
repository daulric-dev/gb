"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Library, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  browseQuery,
  isWholeCourse,
  parseTags,
  type LibraryItem,
  type LibraryItemDetail,
  type LibrarySelection,
  type LibraryVisibility,
} from "@/lib/library";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

interface Part {
  id: string;
  title: string;
}
type PartKind = "moduleIds" | "activityIds" | "pageIds" | "rubricIds";
const PART_LABELS: [PartKind, string][] = [
  ["moduleIds", "Modules (with everything in them)"],
  ["activityIds", "Assignments and quizzes"],
  ["pageIds", "Pages"],
  ["rubricIds", "Rubrics"],
];

/**
 * "Publish to library" on a course's settings: publish the course, or chosen
 * modules, activities, pages and rubrics, as a template for the school or
 * (with the course-library:create permission) every school; and publish new
 * versions of what this course already published. Linked files are copied
 * into the library, so the template never points at your own files.
 */
export function PublishToLibraryCard({ courseId, courseName }: { courseId: string; courseName: string }) {
  useSignals();
  const { can } = usePermissions();
  const mayShareWide = can("course-library", "create");
  const published = useSignal<LibraryItem[]>([]);
  const open = useSignal(false);
  const republishing = useSignal<LibraryItem | null>(null);
  const saving = useSignal(false);
  const whole = useSignal(true);
  const parts = useSignal<Record<PartKind, Part[]>>({ moduleIds: [], activityIds: [], pageIds: [], rubricIds: [] });
  const chosen = useSignal<Record<PartKind, Set<string>>>({
    moduleIds: new Set(), activityIds: new Set(), pageIds: new Set(), rubricIds: new Set(),
  });
  const form = useSignal({ title: courseName, description: "", subject: "", gradeLevel: "", tags: "", visibility: "school" as LibraryVisibility, note: "" });

  const loadPublished = useCallback(() => {
    api<LibraryItem[]>(`/library/items${browseQuery({ scope: "mine", sourceCourseId: courseId })}`)
      .then((d) => (published.value = d))
      .catch(() => (published.value = []));
  }, [courseId, published]);

  useEffect(() => {
    loadPublished();
  }, [loadPublished]);

  useEffect(() => {
    if (!open.value) return;
    const list = (path: string) =>
      api<Part[]>(path).then((rows) => rows.map((r) => ({ id: r.id, title: r.title }))).catch(() => [] as Part[]);
    void Promise.all([
      list(`/courses/${courseId}/modules`),
      list(`/courses/${courseId}/activities`),
      list(`/courses/${courseId}/pages`),
      list(`/courses/${courseId}/rubrics`),
    ]).then(([moduleIds, activityIds, pageIds, rubricIds]) => {
      parts.value = { moduleIds, activityIds, pageIds, rubricIds };
    });
  }, [open.value, courseId, parts]);

  function startNew() {
    republishing.value = null;
    whole.value = true;
    chosen.value = { moduleIds: new Set(), activityIds: new Set(), pageIds: new Set(), rubricIds: new Set() };
    form.value = { title: courseName, description: "", subject: "", gradeLevel: "", tags: "", visibility: "school", note: "" };
    open.value = true;
  }

  async function startRepublish(item: LibraryItem) {
    republishing.value = item;
    form.value = { ...form.value, note: "" };
    try {
      const detail = await api<LibraryItemDetail>(`/library/items/${item.id}`);
      const sel = detail.preview.selection;
      whole.value = isWholeCourse(sel);
      chosen.value = {
        moduleIds: new Set(sel?.moduleIds ?? []),
        activityIds: new Set(sel?.activityIds ?? []),
        pageIds: new Set(sel?.pageIds ?? []),
        rubricIds: new Set(sel?.rubricIds ?? []),
      };
    } catch {
      whole.value = true;
    }
    open.value = true;
  }

  function toggle(kind: PartKind, id: string) {
    const next = new Set(chosen.value[kind]);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    chosen.value = { ...chosen.value, [kind]: next };
  }

  function selection(): LibrarySelection | undefined {
    if (whole.value) return undefined;
    return {
      moduleIds: [...chosen.value.moduleIds],
      activityIds: [...chosen.value.activityIds],
      pageIds: [...chosen.value.pageIds],
      rubricIds: [...chosen.value.rubricIds],
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sel = selection();
    if (sel && isWholeCourse(sel)) {
      toast.error("Choose at least one part to publish, or publish the whole course");
      return;
    }
    saving.value = true;
    try {
      const f = form.value;
      if (republishing.value) {
        const d = await api<LibraryItemDetail>(`/library/items/${republishing.value.id}/versions`, {
          method: "POST",
          body: { selection: sel ?? {}, note: f.note || undefined },
        });
        toast.success(`Published version ${d.latestVersion}`);
      } else {
        await api<LibraryItemDetail>("/library/items", {
          method: "POST",
          body: {
            sourceCourseId: courseId,
            title: f.title,
            description: f.description || undefined,
            subject: f.subject || undefined,
            gradeLevel: f.gradeLevel || undefined,
            tags: parseTags(f.tags),
            visibility: f.visibility,
            selection: sel,
          },
        });
        toast.success("Published to the library");
      }
      open.value = false;
      loadPublished();
    } catch (err) {
      toast.error(userMessage(err, "Failed to publish"));
    } finally {
      saving.value = false;
    }
  }

  const set = (patch: Partial<typeof form.value>) => (form.value = { ...form.value, ...patch });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Library className="size-4" aria-hidden="true" />
          Course library
        </CardTitle>
        <CardDescription>
          Share this course, or parts of it, as a template colleagues can
          import. Each publish is a new version; courses that imported an
          earlier one keep their copy. No students, work or marks are ever
          included, and linked files are copied, never shared.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {published.value.length > 0 && (
          <ul className="divide-y rounded-md border">
            {published.value.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <Link href={`/dashboard/library/${item.id}`} className="flex-1 font-medium hover:underline">
                  {item.title}
                </Link>
                <span className="text-xs text-muted-foreground">v{item.latestVersion}</span>
                {!item.published && <Badge variant="secondary">Unpublished</Badge>}
                <Button size="sm" variant="outline" onClick={() => void startRepublish(item)}>
                  Publish new version
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" onClick={startNew}>
          Publish to library
        </Button>
      </CardContent>

      <Dialog open={open.value} onOpenChange={(v) => (open.value = v)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {republishing.value ? `New version of ${republishing.value.title}` : "Publish to library"}
              </DialogTitle>
              <DialogDescription>
                Activities are imported as drafts. Files linked in modules are
                copied into the library now, so later changes to them are not
                picked up until you publish again.
              </DialogDescription>
            </DialogHeader>

            {republishing.value ? (
              <div className="space-y-1.5">
                <Label htmlFor="pubNote">What changed (optional)</Label>
                <Input id="pubNote" maxLength={500} value={form.value.note} onChange={(e) => set({ note: e.target.value })} />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pubTitle">Title</Label>
                  <Input id="pubTitle" required maxLength={200} value={form.value.title} onChange={(e) => set({ title: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pubDescription">Description</Label>
                  <Textarea id="pubDescription" maxLength={4000} value={form.value.description} onChange={(e) => set({ description: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pubSubject">Subject</Label>
                  <Input id="pubSubject" maxLength={80} value={form.value.subject} onChange={(e) => set({ subject: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pubGrade">Grade level</Label>
                  <Input id="pubGrade" maxLength={40} value={form.value.gradeLevel} onChange={(e) => set({ gradeLevel: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pubTags">Tags (comma separated)</Label>
                  <Input id="pubTags" value={form.value.tags} onChange={(e) => set({ tags: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pubVisibility">Visible to</Label>
                  <NativeSelect id="pubVisibility" className="w-full" value={form.value.visibility} onChange={(e) => set({ visibility: e.target.value as LibraryVisibility })}>
                    <NativeSelectOption value="school">My school</NativeSelectOption>
                    {mayShareWide && (
                      <NativeSelectOption value="organisation">Every school in the organisation</NativeSelectOption>
                    )}
                  </NativeSelect>
                </div>
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What to publish</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="pubWhat" checked={whole.value} onChange={() => (whole.value = true)} />
                The whole course
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="pubWhat" checked={!whole.value} onChange={() => (whole.value = false)} />
                Chosen parts (and what they need, such as a quiz&apos;s rubric)
              </label>
              {!whole.value && (
                <div className="space-y-3 rounded-md border p-3">
                  {PART_LABELS.map(([kind, label]) =>
                    parts.value[kind].length === 0 ? null : (
                      <div key={kind} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{label}</p>
                        {parts.value[kind].map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={chosen.value[kind].has(p.id)} onCheckedChange={() => toggle(kind, p.id)} />
                            <span className="truncate">{p.title}</span>
                          </label>
                        ))}
                      </div>
                    ),
                  )}
                </div>
              )}
            </fieldset>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => (open.value = false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving.value}>
                {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                Publish
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
