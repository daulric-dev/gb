"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useProfile } from "@/providers/AuthProvider";
import { markAnnouncementsRead } from "@/lib/announcements";
import { Plus, Megaphone, Pencil, Trash2 } from "lucide-react";
import type { Announcement } from "./_components/types";
import { AnnouncementForm } from "./_components/AnnouncementForm";
import { ReaderAvatars } from "./_components/ReaderAvatars";

function formatWhen(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function authorName(a: Announcement) {
  const name = `${a.author?.first_name ?? ""} ${a.author?.last_name ?? ""}`.trim();
  return name || "Staff";
}

export default function AnnouncementsPage() {
  useSignals();
  const { can, isAdmin } = usePermissions();
  const { profile } = useProfile();
  const myId = profile.value?.id;

  const announcements = useSignal<Announcement[]>([]);
  const loading = useSignal(true);
  const createOpen = useSignal(false);
  const editing = useSignal<Announcement | null>(null);

  const fetchAnnouncements = useCallback(() => {
    api<Announcement[]>("/announcements")
      .then((data) => (announcements.value = data))
      .catch(() => toast.error("Failed to load announcements"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    fetchAnnouncements();
    // Viewing the board marks everything up to now as read (clears the badge).
    markAnnouncementsRead();
  }, [fetchAnnouncements]);

  const canManage = (a: Announcement) =>
    isAdmin || (!!myId && a.author_user_profile_id === myId);

  const handleDelete = async (a: Announcement) => {
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    try {
      await api(`/announcements/${a.id}`, { method: "DELETE" });
      toast.success("Announcement deleted");
      fetchAnnouncements();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Announcements"
        description="Notices for all staff in your school"
        action={
          can("announcement", "create") ? (
            <Dialog
              open={createOpen.value}
              onOpenChange={(v) => (createOpen.value = v)}
            >
              <DialogTrigger render={<Button />}>
                <Plus className="mr-2 size-4" />
                New Announcement
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Announcement</DialogTitle>
                  <DialogDescription>
                    Post a notice visible to everyone in your school
                  </DialogDescription>
                </DialogHeader>
                <AnnouncementForm
                  onSuccess={() => {
                    createOpen.value = false;
                    fetchAnnouncements();
                  }}
                />
              </DialogContent>
            </Dialog>
          ) : undefined
        }
      />

      {loading.value ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : announcements.value.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Megaphone className="size-8" />
          <p>No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {announcements.value.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-base">{a.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {authorName(a)} · {formatWhen(a.created_at)}
                  </p>
                </div>
                {canManage(a) && (
                  <div className="flex shrink-0 gap-1">
                    {can("announcement", "update") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => (editing.value = a)}
                        aria-label="Edit announcement"
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    {can("announcement", "delete") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        onClick={() => handleDelete(a)}
                        aria-label="Delete announcement"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {a.body && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {a.body}
                  </p>
                )}
                <ReaderAvatars readers={a.readers ?? []} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={editing.value !== null}
        onOpenChange={(open) => {
          if (!open) editing.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Announcement</DialogTitle>
            <DialogDescription>Update this notice</DialogDescription>
          </DialogHeader>
          {editing.value && (
            <AnnouncementForm
              announcement={editing.value}
              onSuccess={() => {
                editing.value = null;
                fetchAnnouncements();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
