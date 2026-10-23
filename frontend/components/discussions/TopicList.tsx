"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Lock, MessagesSquare, Pin, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  authorName,
  type DiscussionList,
} from "@/lib/courses/discussions";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/app/dashboard/courses/[courseId]/_components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { TopicEditorDialog } from "./TopicEditorDialog";

export function formatWhen(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A course's topics: pinned first, then by latest activity, with reply and
 * unread counts. Shared by the staff course view and the student portal.
 */
export function TopicList({
  apiBase,
  linkBase,
  isStaff,
  canManage,
}: {
  /** `/courses/:id/discussions` or `/portal/me/courses/:id/discussions`. */
  apiBase: string;
  /** Where a topic's page lives: `${linkBase}/${topicId}`. */
  linkBase: string;
  isStaff: boolean;
  /** Teacher or admin: may let students start topics. */
  canManage: boolean;
}) {
  useSignals();
  const router = useRouter();
  const data = useSignal<DiscussionList | null>(null);
  const loading = useSignal(true);
  const editorOpen = useSignal(false);

  const load = useCallback(() => {
    api<DiscussionList>(apiBase)
      .then((d) => (data.value = d))
      .catch(() => toast.error("Failed to load discussions"))
      .finally(() => (loading.value = false));
  }, [apiBase, data, loading]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStudentTopics(on: boolean) {
    try {
      await api(`${apiBase}/settings`, {
        method: "PUT",
        body: { studentsCanCreateTopics: on },
      });
      if (data.value) {
        data.value = { ...data.value, studentsCanCreateTopics: on };
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    }
  }

  const list = data.value;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Discussions"
        description="Questions and conversations for the whole course"
        actions={
          list?.canCreateTopics && (
            <Button onClick={() => (editorOpen.value = true)}>
              <Plus className="mr-2 size-4" />
              New topic
            </Button>
          )
        }
      />

      {canManage && list && (
        <div className="flex items-center gap-2">
          <Switch
            id="studentTopics"
            checked={list.studentsCanCreateTopics}
            onCheckedChange={(v) => void setStudentTopics(v)}
          />
          <Label htmlFor="studentTopics" className="text-sm font-normal">
            Students can start topics
          </Label>
        </div>
      )}

      {loading.value ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !list || list.topics.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessagesSquare />
            </EmptyMedia>
            <EmptyTitle>No discussions yet</EmptyTitle>
            <EmptyDescription>
              {list?.canCreateTopics
                ? "Start a topic to get the class talking."
                : "Topics your teacher starts will show up here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2 animate-fade-in-up-delay-1">
          {list.topics.map((t) => (
            <Link key={t.id} href={`${linkBase}/${t.id}`} className="block">
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {t.isPinned && (
                        <Pin className="size-3.5 text-primary" aria-label="Pinned" />
                      )}
                      <span
                        className={cn(
                          "truncate",
                          t.isRead ? "font-medium" : "font-semibold",
                        )}
                      >
                        {t.title}
                      </span>
                      {t.isLocked && (
                        <Badge variant="outline">
                          <Lock /> Locked
                        </Badge>
                      )}
                      {!t.isPublished && <Badge variant="secondary">Draft</Badge>}
                      {!t.isRead && <Badge>New</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {authorName(t.author)} · {formatWhen(t.createdAt)}
                      {t.lastReplyAt && ` · last reply ${formatWhen(t.lastReplyAt)}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {t.replyCount}{" "}
                      <span className="font-normal text-muted-foreground">
                        {t.replyCount === 1 ? "reply" : "replies"}
                      </span>
                    </p>
                    {t.unreadCount > 0 && (
                      <p className="text-xs font-medium text-primary tabular-nums">
                        {t.unreadCount} unread
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <TopicEditorDialog
        open={editorOpen.value}
        onOpenChangeAction={(v) => (editorOpen.value = v)}
        apiBase={apiBase}
        topic={null}
        isStaff={isStaff}
        onSavedAction={(t) => router.push(`${linkBase}/${t.id}`)}
      />
    </div>
  );
}
