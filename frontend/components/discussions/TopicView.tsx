"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowLeft,
  EyeOff,
  Loader2,
  Lock,
  MessageSquareReply,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  authorInitials,
  authorName,
  type DiscussionAuthor,
  type DiscussionReply,
  type DiscussionTopic,
} from "@/lib/courses/discussions";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/app/dashboard/courses/[courseId]/_components/MarkdownEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TopicEditorDialog } from "./TopicEditorDialog";
import { formatWhen } from "./TopicList";

function Byline({
  author,
  createdAt,
  editedAt,
  isNew,
}: {
  author: DiscussionAuthor | null;
  createdAt: string;
  editedAt: string | null;
  isNew?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="size-8">
        {author?.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
        <AvatarFallback className="text-xs">{authorInitials(author)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {authorName(author)}
          {author?.isStaff && <Badge variant="secondary">Staff</Badge>}
          {isNew && <Badge>New</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatWhen(createdAt)}
          {editedAt && " · edited"}
        </p>
      </div>
    </div>
  );
}

/** Write / Preview Markdown box with a submit button. */
function Composer({
  initial = "",
  submitLabel,
  placeholder,
  onSubmitAction,
  onCancelAction,
}: {
  initial?: string;
  submitLabel: string;
  placeholder?: string;
  onSubmitAction: (body: string) => Promise<boolean>;
  onCancelAction?: () => void;
}) {
  useSignals();
  const body = useSignal(initial);
  const busy = useSignal(false);

  async function submit() {
    if (!body.value.trim()) return;
    busy.value = true;
    const ok = await onSubmitAction(body.value.trim());
    busy.value = false;
    if (ok) body.value = "";
  }

  return (
    <div className="space-y-2">
      <MarkdownEditor
        value={body.value}
        onChangeAction={(v) => (body.value = v)}
        rows={4}
        placeholder={placeholder}
      />
      <div className="flex justify-end gap-2">
        {onCancelAction && (
          <Button variant="outline" size="sm" onClick={onCancelAction} disabled={busy.value}>
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={submit} disabled={busy.value || !body.value.trim()}>
          {busy.value && <Loader2 className="mr-2 size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * One topic with its threaded replies and a composer. Shared by the staff
 * course view and the student portal; what the caller may do comes from the
 * API (`canEdit`, `canReply`), not from guessing here.
 */
export function TopicView({
  apiBase,
  topicId,
  backHref,
  isStaff,
}: {
  /** `/courses/:id/discussions` or `/portal/me/courses/:id/discussions`. */
  apiBase: string;
  topicId: string;
  backHref: string;
  isStaff: boolean;
}) {
  useSignals();
  const router = useRouter();
  const topic = useSignal<DiscussionTopic | null>(null);
  const loading = useSignal(true);
  const missing = useSignal(false);
  const editorOpen = useSignal(false);
  const replyTo = useSignal<string | null>(null);
  const editingId = useSignal<string | null>(null);

  const path = `${apiBase}/${topicId}`;

  const load = useCallback(async () => {
    try {
      topic.value = await api<DiscussionTopic>(path);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) missing.value = true;
      else toast.error("Failed to load the topic");
    } finally {
      loading.value = false;
    }
  }, [path, topic, loading, missing]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: string, parentId?: string) {
    try {
      await api(`${path}/replies`, { method: "POST", body: { body, parentId } });
      replyTo.value = null;
      await load();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to post");
      return false;
    }
  }

  async function edit(replyId: string, body: string) {
    try {
      await api(`${path}/replies/${replyId}`, { method: "PATCH", body: { body } });
      editingId.value = null;
      await load();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
      return false;
    }
  }

  async function removeReply(replyId: string) {
    if (!window.confirm("Delete this post?")) return;
    try {
      await api(`${path}/replies/${replyId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  async function removeTopic() {
    const t = topic.value;
    if (!t || !window.confirm(`Delete "${t.title}" and all its replies?`)) return;
    try {
      await api(path, { method: "DELETE" });
      toast.success("Topic deleted");
      router.push(backHref);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  if (loading.value) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const t = topic.value;
  if (!t) {
    return (
      <div className="space-y-3">
        <BackLink href={backHref} />
        <p className="text-sm text-muted-foreground">
          {missing.value ? "This topic no longer exists." : "Could not load the topic."}
        </p>
      </div>
    );
  }

  const renderReply = (r: DiscussionReply, nested: boolean) => (
    <div key={r.id} className={cn(nested && "ml-6 border-l pl-4 sm:ml-10")}>
      <div className="space-y-2 py-3">
        {r.isDeleted ? (
          <p className="text-sm italic text-muted-foreground">This post was deleted.</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <Byline
                author={r.author}
                createdAt={r.createdAt}
                editedAt={r.editedAt}
                isNew={r.isNew}
              />
              <div className="flex shrink-0 gap-1">
                {t.canReply && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Reply"
                    onClick={() => {
                      replyTo.value = r.parentId ?? r.id;
                      editingId.value = null;
                    }}
                  >
                    <MessageSquareReply className="size-4" />
                  </Button>
                )}
                {r.canEdit && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit post"
                      onClick={() => {
                        editingId.value = r.id;
                        replyTo.value = null;
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete post"
                      onClick={() => removeReply(r.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            {editingId.value === r.id ? (
              <Composer
                initial={r.body}
                submitLabel="Save"
                onSubmitAction={(body) => edit(r.id, body)}
                onCancelAction={() => (editingId.value = null)}
              />
            ) : (
              <Markdown className="pl-10">{r.body}</Markdown>
            )}
          </>
        )}
      </div>
      {r.replies.map((child) => renderReply(child, true))}
      {!nested && replyTo.value === r.id && (
        <div className="ml-6 border-l pb-3 pl-4 sm:ml-10">
          <Composer
            submitLabel="Reply"
            placeholder={`Reply to ${authorName(r.author)}...`}
            onSubmitAction={(body) => post(body, r.id)}
            onCancelAction={() => (replyTo.value = null)}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <BackLink href={backHref} />

      <Card className="animate-fade-in-up">
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
                {t.isPinned && <Pin className="size-4 text-primary" aria-label="Pinned" />}
                {t.title}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {t.isLocked && (
                  <Badge variant="outline">
                    <Lock /> Locked
                  </Badge>
                )}
                {!t.isPublished && <Badge variant="secondary">Draft</Badge>}
                {t.requireInitialPost && (
                  <Badge variant="outline">
                    <EyeOff /> Post first
                  </Badge>
                )}
              </div>
            </div>
            {t.canEdit && (
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit topic"
                  onClick={() => (editorOpen.value = true)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete topic"
                  onClick={removeTopic}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            )}
          </div>
          <Byline author={t.author} createdAt={t.createdAt} editedAt={t.editedAt} />
          {t.body.trim() && <Markdown>{t.body}</Markdown>}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
        </h3>
        {t.mustPostFirst && (
          <Alert>
            <EyeOff />
            <AlertDescription>
              Post your reply first; you will see your classmates&apos; replies after.
            </AlertDescription>
          </Alert>
        )}
        {t.replies.length > 0 && (
          <Card>
            <CardContent className="divide-y py-0">
              {t.replies.map((r) => renderReply(r, false))}
            </CardContent>
          </Card>
        )}
      </div>

      {t.canReply ? (
        <Composer
          submitLabel="Post reply"
          placeholder="Write a reply..."
          onSubmitAction={(body) => post(body)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t.isLocked ? "This topic is locked." : "This course is read-only."}
        </p>
      )}

      <TopicEditorDialog
        open={editorOpen.value}
        onOpenChangeAction={(v) => (editorOpen.value = v)}
        apiBase={apiBase}
        topic={t}
        isStaff={isStaff}
        onSavedAction={() => void load()}
      />
    </div>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      All discussions
    </Link>
  );
}
