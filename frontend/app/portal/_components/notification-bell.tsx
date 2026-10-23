"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Bell, FileText, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CourseNotification } from "@/lib/courses/types";
import {
  courseNoticeHref,
  listCourseNotices,
  markAllCourseNoticesRead,
  markCourseNoticesRead,
  refreshCourseNoticeUnread,
  unreadCourseNotices,
} from "@/lib/portal-notifications";

/** How often the badge re-checks while the tab is open. */
const POLL_MS = 60_000;

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * The portal header bell: unread count, and the latest notices about new
 * work and announcements. Opening a notice marks it read.
 */
export function NotificationBell() {
  useSignals();
  const router = useRouter();
  const open = useSignal(false);
  const loading = useSignal(false);
  const items = useSignal<CourseNotification[]>([]);

  useEffect(() => {
    void refreshCourseNoticeUnread();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshCourseNoticeUnread();
    }, POLL_MS);
    const onFocus = () => void refreshCourseNoticeUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function onOpenChange(next: boolean) {
    open.value = next;
    if (!next) return;
    loading.value = true;
    try {
      items.value = await listCourseNotices();
    } catch {
      toast.error("Failed to load notifications");
    } finally {
      loading.value = false;
    }
  }

  async function openNotice(n: CourseNotification) {
    open.value = false;
    if (!n.readAt) {
      items.value = items.value.map((i) =>
        i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i,
      );
      void markCourseNoticesRead([n.id]).catch(() => {});
    }
    router.push(courseNoticeHref(n));
  }

  async function markAll() {
    try {
      await markAllCourseNoticesRead();
      const now = new Date().toISOString();
      items.value = items.value.map((i) => ({ ...i, readAt: i.readAt ?? now }));
    } catch {
      toast.error("Failed to mark notifications read");
    }
  }

  const unread = unreadCourseNotices.value;

  return (
    <Popover open={open.value} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
            }
          />
        }
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={markAll}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto p-1">
          {loading.value && items.value.length === 0 ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.value.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notifications yet. New work and announcements from your
              courses will show up here.
            </p>
          ) : (
            items.value.map((n) => {
              const Icon = n.kind === "announcement" ? Megaphone : FileText;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotice(n)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted",
                    !n.readAt && "bg-primary/5",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "line-clamp-2 text-sm",
                        !n.readAt && "font-medium",
                      )}
                    >
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {n.body}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {n.courseName ? `${n.courseName} · ` : ""}
                      {ago(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
