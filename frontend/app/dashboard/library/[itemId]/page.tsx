"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { EyeOff, FileText, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  countsSummary,
  formatBytes,
  parseTags,
  type LibraryItemDetail,
  type LibraryVisibility,
} from "@/lib/library";
import { usePermissions } from "@/providers/PermissionsProvider";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { LibraryImportDialog } from "../_components/LibraryImportDialog";

/**
 * One library item: a read-only preview of a version (outline, pages,
 * activities, rubrics, files), its version history, Import, and for the
 * publisher or a school admin, editing the details and unpublishing.
 */
export default function LibraryItemPage() {
  useSignals();
  const router = useRouter();
  const params = useParams<{ itemId: string }>();
  const itemId = params?.itemId ?? "";
  const { can } = usePermissions();
  const item = useSignal<LibraryItemDetail | null>(null);
  const loading = useSignal(true);
  const version = useSignal<number | null>(null);
  const editing = useSignal(false);
  const saving = useSignal(false);
  const form = useSignal({ title: "", description: "", subject: "", gradeLevel: "", tags: "", visibility: "school" as LibraryVisibility });

  const load = useCallback(() => {
    if (!itemId) return;
    const q = version.value ? `?version=${version.value}` : "";
    api<LibraryItemDetail>(`/library/items/${itemId}${q}`)
      .then((d) => (item.value = d))
      .catch(() => (item.value = null))
      .finally(() => (loading.value = false));
  }, [itemId, version.value, item, loading]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }
  const it = item.value;
  if (!it) {
    return (
      <BackTitleToolbar
        title="Template"
        description="This could not be loaded"
        onBack={() => router.push("/dashboard/library")}
      />
    );
  }
  const p = it.preview;

  function startEditing() {
    if (!it) return;
    form.value = {
      title: it.title,
      description: it.description ?? "",
      subject: it.subject ?? "",
      gradeLevel: it.gradeLevel ?? "",
      tags: it.tags.join(", "),
      visibility: it.visibility,
    };
    editing.value = true;
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    saving.value = true;
    try {
      const f = form.value;
      item.value = await api<LibraryItemDetail>(`/library/items/${itemId}`, {
        method: "PATCH",
        body: {
          title: f.title,
          description: f.description,
          subject: f.subject,
          gradeLevel: f.gradeLevel,
          tags: parseTags(f.tags),
          visibility: f.visibility,
        },
      });
      editing.value = false;
      toast.success("Template updated");
    } catch (err) {
      toast.error(userMessage(err, "Failed to update the template"));
    } finally {
      saving.value = false;
    }
  }

  async function unpublish() {
    if (!confirm("Unpublish this template? Courses that already imported it keep their copy.")) return;
    try {
      await api(`/library/items/${itemId}/unpublish`, { method: "POST" });
      toast.success("Template unpublished");
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to unpublish"));
    }
  }

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={it.title}
        description={[it.subject, it.gradeLevel && `Grade ${it.gradeLevel}`, it.authorName, !it.fromYourSchool && it.schoolName]
          .filter(Boolean)
          .join(" · ") || "Course template"}
        onBack={() => router.push("/dashboard/library")}
        actions={
          <div className="flex flex-wrap gap-2">
            {it.canManage && it.published && (
              <Button variant="outline" onClick={() => void unpublish()}>
                <EyeOff className="mr-2 size-4" aria-hidden="true" />
                Unpublish
              </Button>
            )}
            {it.published && <LibraryImportDialog item={it} />}
          </div>
        }
      />

      {!it.published && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Unpublished: only you and school admins can see it. Publish a new
          version from the course&apos;s settings to list it again.
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">About</CardTitle>
          <CardDescription>
            {it.visibility === "organisation" ? "Shared with every school" : "Shared with your school"} ·
            version {it.latestVersion} · {countsSummary(p.counts)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing.value ? (
            <form onSubmit={saveDetails} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="itemTitle">Title</Label>
                <Input id="itemTitle" required maxLength={200} value={form.value.title} onChange={(e) => (form.value = { ...form.value, title: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="itemDescription">Description</Label>
                <Textarea id="itemDescription" maxLength={4000} value={form.value.description} onChange={(e) => (form.value = { ...form.value, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="itemSubject">Subject</Label>
                <Input id="itemSubject" maxLength={80} value={form.value.subject} onChange={(e) => (form.value = { ...form.value, subject: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="itemGrade">Grade level</Label>
                <Input id="itemGrade" maxLength={40} value={form.value.gradeLevel} onChange={(e) => (form.value = { ...form.value, gradeLevel: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="itemTags">Tags (comma separated)</Label>
                <Input id="itemTags" value={form.value.tags} onChange={(e) => (form.value = { ...form.value, tags: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="itemVisibility">Visible to</Label>
                <NativeSelect id="itemVisibility" className="w-full" value={form.value.visibility} onChange={(e) => (form.value = { ...form.value, visibility: e.target.value as LibraryVisibility })}>
                  <NativeSelectOption value="school">My school</NativeSelectOption>
                  <NativeSelectOption value="organisation" disabled={!can("course-library", "create") && it.visibility !== "organisation"}>
                    Every school in the organisation
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={saving.value}>
                  {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={() => (editing.value = false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              {it.description ? (
                <p className="whitespace-pre-wrap text-sm">{it.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
              {it.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {it.tags.map((t) => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                </div>
              )}
              {it.canManage && (
                <Button size="sm" variant="outline" onClick={startEditing}>
                  Edit details
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="previewVersion">Previewing</Label>
        <NativeSelect
          id="previewVersion"
          value={String(p.version)}
          onChange={(e) => {
            version.value = Number(e.target.value);
          }}
        >
          {it.versions.map((v) => (
            <NativeSelectOption key={v.version} value={String(v.version)}>
              Version {v.version} · {new Date(v.publishedAt).toLocaleDateString()}
              {v.note ? ` · ${v.note}` : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Modules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.modules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No modules: only chosen pages, activities or rubrics.</p>
            ) : (
              p.modules.map((m) => (
                <div key={m.id}>
                  <p className="text-sm font-medium">{m.title}</p>
                  <ul className="mt-1 space-y-0.5">
                    {m.items.map((i, idx) => (
                      <li key={idx} className="text-sm text-muted-foreground" style={{ paddingLeft: `${i.indent}rem` }}>
                        <span className="mr-2 text-xs uppercase tracking-wide">{i.type.replace("_", " ")}</span>
                        {i.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Activities and rubrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.activities.map((a) => (
              <details key={a.id} className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer text-sm">
                  {a.title}{" "}
                  <span className="text-xs text-muted-foreground">
                    {a.kind} · {a.points} pts{a.questionCount ? ` · ${a.questionCount} questions` : ""}
                  </span>
                </summary>
                {a.instructions && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{a.instructions}</p>}
                {a.questions.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                    {a.questions.map((q, i) => (
                      <li key={i}>{q.prompt}</li>
                    ))}
                  </ol>
                )}
              </details>
            ))}
            {p.rubrics.map((r) => (
              <details key={r.id} className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer text-sm">
                  {r.title} <span className="text-xs text-muted-foreground">rubric</span>
                </summary>
                <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                  {r.criteria.map((c, i) => (
                    <li key={i}>{c.title} ({c.points} pts)</li>
                  ))}
                </ul>
              </details>
            ))}
            {p.activities.length + p.rubrics.length === 0 && (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.pages.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              p.pages.map((pg) => (
                <details key={pg.id} className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-sm">{pg.title}</summary>
                  <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">{pg.body}</p>
                </details>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Files</CardTitle>
            <CardDescription>Copied into your own files when you import.</CardDescription>
          </CardHeader>
          <CardContent>
            {p.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-1">
                {p.files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
