"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { usePermissions } from "@/providers/PermissionsProvider";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronRight,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Scale,
} from "lucide-react";
import { SchemeEditor } from "./_components/SchemeEditor";
import {
  formatDue,
  STATUS_LABEL,
  type Activity,
  type ActivityKind,
  type Scheme,
} from "./_components/types";

interface Term {
  id: string;
  name: string;
}
interface Subject {
  id: string;
  name: string;
}
interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string | null;
}

export default function ClassActivitiesPage() {
  useSignals();

  const router = useRouter();
  const params = useParams<{ classId: string }>();
  const classId = params?.classId ?? "";
  const { can } = usePermissions();

  const activities = useSignal<Activity[]>([]);
  const terms = useSignal<Term[]>([]);
  const subjects = useSignal<Subject[]>([]);
  const scheme = useSignal<Scheme | null>(null);
  const termId = useSignal("");
  const subjectId = useSignal("");
  const className = useSignal("");
  const loading = useSignal(true);
  const creating = useSignal(false);
  const working = useSignal(false);
  const schemeOpen = useSignal(false);

  // new-activity form
  const kind = useSignal<ActivityKind>("quiz");
  const title = useSignal("");
  const instructions = useSignal("");
  const points = useSignal("100");
  const dueAt = useSignal("");
  const groupId = useSignal("");
  const allowFile = useSignal(true);
  const allowText = useSignal(true);

  const canCreate = can("assessment", "create");

  const loadActivities = useCallback(() => {
    api<Activity[]>(`/activities?classId=${classId}`)
      .then((data) => (activities.value = data))
      .catch(() => (activities.value = []))
      .finally(() => (loading.value = false));
  }, [classId, activities, loading]);

  useEffect(() => {
    if (!classId) return;

    // Terms belong to the class's academic year, and the subjects worth
    // offering are the ones actually taught in this class.
    void Promise.all([
      api<ClassInfo[]>("/classes").catch(() => [] as ClassInfo[]),
      api<Subject[]>(`/classes/${classId}/my-subjects`).catch(
        () => [] as Subject[],
      ),
    ]).then(async ([classes, subjectList]) => {
      subjects.value = subjectList;
      if (subjectList.length && !subjectId.value) {
        subjectId.value = subjectList[0].id;
      }

      const info = classes.find((c) => c.id === classId);
      className.value = info?.name ?? "";
      if (!info?.academicYearId) return;

      const termList = await api<Term[]>(
        `/terms?yearId=${info.academicYearId}`,
      ).catch(() => [] as Term[]);
      terms.value = termList;
      if (termList.length && !termId.value) termId.value = termList[0].id;
    });

    loadActivities();
  }, [
    classId,
    loadActivities,
    terms,
    subjects,
    termId,
    subjectId,
    className,
  ]);

  // The scheme belongs to the class, not the subject: every subject this class
  // takes is weighted the same way.
  const loadScheme = useCallback(() => {
    if (!termId.value || !classId) return;
    api<Scheme>(
      `/grading-groups?termId=${termId.value}&studentGroupId=${classId}`,
    )
      .then((data) => (scheme.value = data))
      .catch(() => (scheme.value = null));
  }, [termId, classId, scheme]);

  useEffect(() => {
    loadScheme();
  }, [termId.value, loadScheme]);

  async function create() {
    if (!title.value.trim()) {
      toast.error("Give it a title");
      return;
    }
    if (kind.value === "assignment" && !allowFile.value && !allowText.value) {
      toast.error("Choose how students hand it in");
      return;
    }

    working.value = true;
    try {
      const created = await api<Activity>("/activities", {
        method: "POST",
        body: {
          classId,
          termId: termId.value,
          subjectId: subjectId.value,
          gradingGroupId: groupId.value || undefined,
          kind: kind.value,
          title: title.value.trim(),
          instructions: instructions.value.trim() || undefined,
          points: Number(points.value),
          dueAt: dueAt.value ? new Date(dueAt.value).toISOString() : undefined,
          allowFile: kind.value === "assignment" ? allowFile.value : false,
          allowText: kind.value === "assignment" ? allowText.value : false,
        },
      });
      creating.value = false;
      title.value = "";
      instructions.value = "";
      toast.success("Created as a draft");
      // Straight into editing: a quiz needs questions before it can publish.
      router.push(`/dashboard/classes/${classId}/activities/${created.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      working.value = false;
    }
  }

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title="Work"
        description="Quizzes and assignments for this class"
        onBack={() => router.push(`/dashboard/classes/${classId}`)}
        actions={
          canCreate ? (
            <Button onClick={() => (creating.value = true)}>
              <Plus className="mr-2 size-4" />
              New
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="min-w-40 flex-1 space-y-1">
            <Label className="text-xs">Term</Label>
            <Select
              value={termId.value}
              onValueChange={(v) => (termId.value = v as string)}
              items={terms.value.map((t) => ({ value: t.id, label: t.name }))}
            >
              <SelectTrigger className="w-full capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {terms.value.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="capitalize">
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-40 flex-1 space-y-1">
            <Label className="text-xs">Subject</Label>
            <Select
              value={subjectId.value}
              onValueChange={(v) => (subjectId.value = v as string)}
              items={subjects.value.map((s) => ({ value: s.id, label: s.name }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjects.value.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            onClick={() => (schemeOpen.value = true)}
            disabled={!termId.value}
          >
            <Scale className="mr-2 size-4" />
            Scheme
            {scheme.value && (
              <Badge variant="secondary" className="ml-2">
                {scheme.value.totalWeight}%
              </Badge>
            )}
          </Button>
        </CardContent>
      </Card>

      {loading.value ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : activities.value.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing set yet. Create a quiz or an assignment to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {activities.value.map((a) => {
            const Icon = a.kind === "quiz" ? ClipboardList : FileText;
            return (
              <Link
                key={a.id}
                href={`/dashboard/classes/${classId}/activities/${a.id}`}
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center gap-3 py-4">
                    <Icon className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.points} points · {formatDue(a.dueAt)}
                      </p>
                    </div>
                    <Badge
                      variant={a.status === "published" ? "default" : "secondary"}
                    >
                      {STATUS_LABEL[a.status]}
                    </Badge>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <SchemeEditor
        open={schemeOpen.value}
        termId={termId.value}
        classId={classId}
        className={className.value}
        canEdit={can("assessment", "update")}
        onOpenChangeAction={(v) => (schemeOpen.value = v)}
        onChangedAction={loadScheme}
      />

      <Dialog
        open={creating.value}
        onOpenChange={(v) => (creating.value = v)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New work</DialogTitle>
            <DialogDescription>
              It starts as a draft. Students see nothing until you publish.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-2">
              {(["quiz", "assignment"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => (kind.value = k)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    kind.value === k
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted"
                  }`}
                >
                  <span className="block text-sm font-medium capitalize">
                    {k}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {k === "quiz"
                      ? "Questions, marked automatically"
                      : "Students hand in work"}
                  </span>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title.value}
                onChange={(e) => (title.value = e.target.value)}
                placeholder={kind.value === "quiz" ? "Quiz 1" : "Essay"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instructions">Instructions</Label>
              <Textarea
                id="instructions"
                rows={3}
                value={instructions.value}
                onChange={(e) => (instructions.value = e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="points">Points</Label>
                <Input
                  id="points"
                  type="number"
                  min={1}
                  value={points.value}
                  onChange={(e) => (points.value = e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="due">Due</Label>
                <Input
                  id="due"
                  type="datetime-local"
                  value={dueAt.value}
                  onChange={(e) => (dueAt.value = e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Counts toward</Label>
              <Select
                value={groupId.value || "none"}
                onValueChange={(v) =>
                  (groupId.value = (v as string) === "none" ? "" : (v as string))
                }
                items={[
                  { value: "none", label: "Not weighted" },
                  ...(scheme.value?.groups ?? []).map((g) => ({
                    value: g.id,
                    label: `${g.name} (${g.weight}%)`,
                  })),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not weighted</SelectItem>
                  {(scheme.value?.groups ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} ({g.weight}%)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind.value === "assignment" && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">How students hand in</p>
                <div className="flex items-center justify-between">
                  <Label htmlFor="allowText" className="font-normal">
                    Text box
                  </Label>
                  <Switch
                    id="allowText"
                    checked={allowText.value}
                    onCheckedChange={(v) => (allowText.value = v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="allowFile" className="font-normal">
                    File upload
                  </Label>
                  <Switch
                    id="allowFile"
                    checked={allowFile.value}
                    onCheckedChange={(v) => (allowFile.value = v)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (creating.value = false)}
              disabled={working.value}
            >
              Cancel
            </Button>
            <Button onClick={create} disabled={working.value}>
              {working.value && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
