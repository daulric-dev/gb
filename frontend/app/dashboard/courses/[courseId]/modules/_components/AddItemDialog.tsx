"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ClipboardList,
  FileText,
  Heading,
  Link2,
  Loader2,
  MessagesSquare,
  Paperclip,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  Activity,
  CoursePage,
  CoursePageSummary,
  ModuleItemType,
} from "@/lib/courses/types";
import { ACTIVITY_KIND_LABEL } from "@/lib/courses/format";
import type {
  DiscussionList,
  DiscussionTopicSummary,
} from "@/lib/courses/discussions";
import type { FileItem } from "@/app/dashboard/files/_components/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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

const TYPES: { type: ModuleItemType; label: string; icon: typeof FileText }[] = [
  { type: "page", label: "Page", icon: FileText },
  { type: "activity", label: "Assignment", icon: ClipboardList },
  { type: "file", label: "File", icon: Paperclip },
  { type: "discussion", label: "Discussion", icon: MessagesSquare },
  { type: "link", label: "Link", icon: Link2 },
  { type: "header", label: "Text header", icon: Heading },
];

const NEW_PAGE = "__new__";

export function AddItemDialog({
  open,
  courseId,
  moduleId,
  moduleTitle,
  onOpenChangeAction,
  onAddedAction,
}: {
  open: boolean;
  courseId: string;
  moduleId: string | null;
  moduleTitle: string;
  onOpenChangeAction: (open: boolean) => void;
  onAddedAction: () => void;
}) {
  useSignals();
  const type = useSignal<ModuleItemType>("page");
  const pages = useSignal<CoursePageSummary[]>([]);
  const activities = useSignal<Activity[]>([]);
  const files = useSignal<FileItem[]>([]);
  const topics = useSignal<DiscussionTopicSummary[]>([]);
  const loading = useSignal(true);
  const target = useSignal("");
  const title = useSignal("");
  const url = useSignal("");
  const saving = useSignal(false);

  useEffect(() => {
    if (!open) return;
    type.value = "page";
    target.value = "";
    title.value = "";
    url.value = "";
    loading.value = true;
    void Promise.all([
      api<CoursePageSummary[]>(`/courses/${courseId}/pages`).catch(
        () => [] as CoursePageSummary[],
      ),
      api<Activity[]>(`/courses/${courseId}/activities`).catch(
        () => [] as Activity[],
      ),
      api<FileItem[]>("/files?filter=all").catch(() => [] as FileItem[]),
      api<DiscussionList>(`/courses/${courseId}/discussions`)
        .then((d) => d.topics)
        .catch(() => [] as DiscussionTopicSummary[]),
    ]).then(([p, a, f, d]) => {
      pages.value = p;
      activities.value = a;
      files.value = f.filter((x) => x.status === "ready");
      topics.value = d;
      loading.value = false;
    });
  }, [open, courseId, type, target, title, url, loading, pages, activities, files, topics]);

  function pick(next: ModuleItemType) {
    type.value = next;
    target.value = "";
  }

  async function add() {
    if (!moduleId) return;
    const t = type.value;
    const body: Record<string, unknown> = { itemType: t };

    if (t === "page") {
      if (!target.value) return toast.error("Choose a page");
      if (target.value === NEW_PAGE) {
        if (!title.value.trim()) return toast.error("Give the new page a title");
      } else {
        body.pageId = target.value;
      }
    } else if (t === "activity") {
      if (!target.value) return toast.error("Choose an assignment");
      body.activityId = target.value;
    } else if (t === "file") {
      if (!target.value) return toast.error("Choose a file");
      body.fileId = target.value;
    } else if (t === "discussion") {
      if (!target.value) return toast.error("Choose a discussion topic");
      body.discussionTopicId = target.value;
    } else if (t === "link") {
      let parsed: URL;
      try {
        parsed = new URL(url.value.trim());
      } catch {
        return toast.error("Enter a full web address, starting with https://");
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return toast.error("Only web links can be added");
      }
      body.url = parsed.toString();
      body.title = title.value.trim() || parsed.hostname;
    } else if (t === "header") {
      if (!title.value.trim()) return toast.error("Write the header text");
      body.title = title.value.trim();
    }
    if (t !== "link" && t !== "header" && title.value.trim() && target.value !== NEW_PAGE) {
      body.title = title.value.trim();
    }

    saving.value = true;
    try {
      if (t === "page" && target.value === NEW_PAGE) {
        const page = await api<CoursePage>(`/courses/${courseId}/pages`, {
          method: "POST",
          body: { title: title.value.trim(), body: "" },
        });
        body.pageId = page.id;
      }
      await api(`/courses/${courseId}/modules/${moduleId}/items`, {
        method: "POST",
        body,
      });
      toast.success("Added to the module");
      onOpenChangeAction(false);
      onAddedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      saving.value = false;
    }
  }

  const options: { value: string; label: string }[] =
    type.value === "page"
      ? [
          { value: NEW_PAGE, label: "+ New page" },
          ...pages.value.map((p) => ({ value: p.id, label: p.title })),
        ]
      : type.value === "activity"
        ? activities.value.map((a) => ({
            value: a.id,
            label: `${a.title} (${ACTIVITY_KIND_LABEL[a.kind]})`,
          }))
        : type.value === "file"
          ? files.value.map((f) => ({ value: f.id, label: f.name }))
          : type.value === "discussion"
            ? topics.value.map((d) => ({
                value: d.id,
                label: d.isPublished ? d.title : `${d.title} (draft)`,
              }))
            : [];

  const needsTarget = ["page", "activity", "file", "discussion"].includes(
    type.value,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to {moduleTitle}</DialogTitle>
          <DialogDescription>
            New items start unpublished, like the module itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {TYPES.map((t) => {
              const Icon = t.icon;
              const active = type.value === t.type;
              return (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => pick(t.type)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/5 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="size-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {needsTarget &&
            (loading.value ? (
              <Skeleton className="h-8 w-full" />
            ) : options.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                {type.value === "activity"
                  ? "No assignments yet. Create one on the Assignments tab."
                  : type.value === "discussion"
                    ? "No discussion topics yet. Start one on the Discussions tab."
                    : "No files yet. Upload one in Files first."}
              </p>
            ) : (
              <div className="space-y-2">
                <Label>
                  {type.value === "page"
                    ? "Page"
                    : type.value === "activity"
                      ? "Assignment"
                      : type.value === "discussion"
                        ? "Discussion topic"
                        : "File"}
                </Label>
                <Select
                  value={target.value || null}
                  onValueChange={(v) => (target.value = (v as string) ?? "")}
                  items={options}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}

          {type.value === "link" && (
            <div className="space-y-2">
              <Label htmlFor="itemUrl">Web address</Label>
              <Input
                id="itemUrl"
                type="url"
                placeholder="https://"
                value={url.value}
                onChange={(e) => (url.value = e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="itemTitle">
              {type.value === "header"
                ? "Header text"
                : target.value === NEW_PAGE
                  ? "New page title"
                  : "Title (optional)"}
            </Label>
            <Input
              id="itemTitle"
              placeholder={
                type.value === "header"
                  ? "Week 1"
                  : type.value === "link"
                    ? "Defaults to the site name"
                    : target.value === NEW_PAGE
                      ? "Reading notes"
                      : "Defaults to the item's own name"
              }
              value={title.value}
              onChange={(e) => (title.value = e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={saving.value}
          >
            Cancel
          </Button>
          <Button onClick={add} disabled={saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Add item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
