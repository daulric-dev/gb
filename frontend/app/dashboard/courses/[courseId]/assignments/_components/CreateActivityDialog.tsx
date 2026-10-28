"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ClipboardList, FileText, Loader2, NotebookPen } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  Activity,
  ActivityKind,
  AssignmentGroup,
} from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { MarkdownEditor } from "../../_components/MarkdownEditor";

const KINDS: {
  kind: ActivityKind;
  label: string;
  hint: string;
  icon: typeof FileText;
}[] = [
  {
    kind: "assignment",
    label: "Assignment",
    hint: "Students hand in text or a file",
    icon: FileText,
  },
  {
    kind: "quiz",
    label: "Quiz",
    hint: "Questions, marked automatically",
    icon: ClipboardList,
  },
  {
    kind: "offline",
    label: "Offline",
    hint: "Paper work or a test; you enter marks",
    icon: NotebookPen,
  },
];

const UNGROUPED = "none";

export function CreateActivityDialog({
  open,
  courseId,
  groups,
  defaultGroupId,
  onOpenChangeAction,
}: {
  open: boolean;
  courseId: string;
  groups: AssignmentGroup[];
  defaultGroupId?: string | null;
  onOpenChangeAction: (open: boolean) => void;
}) {
  useSignals();
  const router = useRouter();

  const kind = useSignal<ActivityKind>("assignment");
  const title = useSignal("");
  const instructions = useSignal("");
  const points = useSignal("100");
  const dueAt = useSignal("");
  const groupId = useSignal(defaultGroupId ?? "");
  const allowFile = useSignal(true);
  const allowMultipleFiles = useSignal(false);
  const allowText = useSignal(true);
  const saving = useSignal(false);

  async function create() {
    if (!title.value.trim()) {
      toast.error("Give it a title");
      return;
    }
    const pts = Number(points.value);
    if (!Number.isFinite(pts) || pts < 1) {
      toast.error("Points must be at least 1");
      return;
    }
    if (kind.value === "assignment" && !allowFile.value && !allowText.value) {
      toast.error("Choose how students hand it in");
      return;
    }

    saving.value = true;
    try {
      const created = await api<Activity>(`/courses/${courseId}/activities`, {
        method: "POST",
        body: {
          kind: kind.value,
          title: title.value.trim(),
          instructions: instructions.value.trim() || undefined,
          points: pts,
          dueAt: dueAt.value ? new Date(dueAt.value).toISOString() : undefined,
          assignmentGroupId: groupId.value || undefined,
          allowFile: kind.value === "assignment" ? allowFile.value : false,
          allowMultipleFiles:
            kind.value === "assignment" && allowFile.value
              ? allowMultipleFiles.value
              : false,
          allowText: kind.value === "assignment" ? allowText.value : false,
        },
      });
      toast.success("Created as a draft");
      onOpenChangeAction(false);
      // Straight into editing: a quiz needs questions before it can publish.
      router.push(`/dashboard/courses/${courseId}/assignments/${created.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      saving.value = false;
    }
  }

  const groupItems = [
    { value: UNGROUPED, label: "Ungrouped" },
    ...groups.map((g) => ({
      value: g.id,
      label: g.weight !== null ? `${g.name} (${g.weight}%)` : g.name,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New assignment</DialogTitle>
          <DialogDescription>
            It starts as a draft. Students see nothing until you publish.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => {
              const Icon = k.icon;
              const active = kind.value === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => (kind.value = k.kind)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    active ? "border-primary bg-primary/5" : "hover:bg-muted",
                  )}
                >
                  <Icon
                    className={cn(
                      "mb-1.5 size-4",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="block text-sm font-medium">{k.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {k.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor="activityTitle">Title</Label>
            <Input
              id="activityTitle"
              value={title.value}
              onChange={(e) => (title.value = e.target.value)}
              placeholder={
                kind.value === "quiz"
                  ? "Quiz 1"
                  : kind.value === "offline"
                    ? "Mid-term test"
                    : "Essay"
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Instructions</Label>
            <MarkdownEditor
              value={instructions.value}
              onChangeAction={(v) => (instructions.value = v)}
              rows={4}
              placeholder="What students need to know"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="activityPoints">Points</Label>
              <Input
                id="activityPoints"
                type="number"
                min={1}
                value={points.value}
                onChange={(e) => (points.value = e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="activityDue">Due</Label>
              <Input
                id="activityDue"
                type="datetime-local"
                value={dueAt.value}
                onChange={(e) => (dueAt.value = e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assignment group</Label>
            <Select
              value={groupId.value || UNGROUPED}
              onValueChange={(v) =>
                (groupId.value = v === UNGROUPED ? "" : (v as string))
              }
              items={groupItems}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groupItems.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
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
                  onCheckedChange={(v) => {
                    allowFile.value = v;
                    if (!v) allowMultipleFiles.value = false;
                  }}
                />
              </div>
              {allowFile.value && (
                <div className="flex items-center justify-between pl-4">
                  <Label htmlFor="allowMultipleFiles" className="font-normal">
                    Allow multiple files
                  </Label>
                  <Switch
                    id="allowMultipleFiles"
                    checked={allowMultipleFiles.value}
                    onCheckedChange={(v) => (allowMultipleFiles.value = v)}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={saving.value}
          >
            Cancel
          </Button>
          <Button onClick={create} disabled={saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
