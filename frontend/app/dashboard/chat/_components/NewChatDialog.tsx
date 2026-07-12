"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listMessageableUsers,
  openDirectConversation,
  participantName,
  type ChatParticipant,
} from "@/lib/chat";

function initials(p: ChatParticipant) {
  return (
    `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase() || "?"
  );
}

export function NewChatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useSignals();
  const users = useSignal<ChatParticipant[]>([]);
  const query = useSignal("");
  const loading = useSignal(false);
  const busy = useSignal(false);

  useEffect(() => {
    if (!open) return;
    loading.value = true;
    query.value = "";
    listMessageableUsers()
      .then((u) => (users.value = u))
      .finally(() => (loading.value = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = users.value.filter((u) =>
    participantName(u).toLowerCase().includes(query.value.trim().toLowerCase()),
  );

  async function start(user: ChatParticipant) {
    if (busy.value) return;
    busy.value = true;
    const conv = await openDirectConversation(user.userId);
    busy.value = false;
    if (conv) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Pick someone in your school to start a conversation.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search people…"
          value={query.value}
          onChange={(e) => (query.value = e.target.value)}
        />

        <ScrollArea className="h-72 pr-2">
          {loading.value ? (
            <p className="p-2 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              No one to message.
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((u) => (
                <li key={u.userId}>
                  <button
                    disabled={busy.value}
                    onClick={() => start(u)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <Avatar className="size-8 shrink-0">
                      {u.avatarUrl && (
                        <AvatarImage src={u.avatarUrl} alt="" />
                      )}
                      <AvatarFallback className="text-xs">
                        {initials(u)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{participantName(u)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
