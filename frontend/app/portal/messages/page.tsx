"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft, MessageSquarePlus } from "lucide-react";
import { useProfile } from "@/providers/AuthProvider";
import {
  activeConversationId,
  refreshConversations,
  selectConversation,
} from "@/lib/chat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConversationList } from "@/app/dashboard/chat/_components/ConversationList";
import { MessageThread } from "@/app/dashboard/chat/_components/MessageThread";
import { NewChatDialog } from "@/app/dashboard/chat/_components/NewChatDialog";

/**
 * A student's messages: conversations with their teachers, using the same
 * chat API and components as staff. The API decides who a student may
 * message (their teachers, and staff who messaged them first); the portal
 * layout only renders this page, and runs the chat stream, while the school
 * has student messaging on.
 */
export default function PortalMessagesPage() {
  useSignals();
  const { profile } = useProfile();
  const selfId = profile.value?.id ?? null;
  const newChatOpen = useSignal(false);

  useEffect(() => {
    void refreshConversations();
  }, []);

  const hasActive = activeConversationId.value !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Messages</h1>
          <p className="mt-1 text-muted-foreground">
            Message the teachers of your courses
          </p>
        </div>
        <Button onClick={() => (newChatOpen.value = true)}>
          <MessageSquarePlus className="size-4" />
          New message
        </Button>
      </div>

      <div className="grid h-[calc(100dvh-16rem)] min-h-[28rem] grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-[18rem_1fr]">
        <div
          className={cn(
            "min-h-0 border-r md:block",
            hasActive ? "hidden" : "block",
          )}
        >
          <ConversationList
            selfId={selfId}
            onSelect={(id) => selectConversation(id)}
          />
        </div>
        <div
          className={cn("min-h-0", hasActive ? "block" : "hidden md:block")}
        >
          {hasActive && (
            <div className="border-b p-1 md:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (activeConversationId.value = null)}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
            </div>
          )}
          <div className="h-full">
            <MessageThread selfId={selfId} canSend classLinks={false} />
          </div>
        </div>
      </div>

      <NewChatDialog
        open={newChatOpen.value}
        onOpenChange={(o) => (newChatOpen.value = o)}
        description="Pick one of your teachers to start a conversation."
      />
    </div>
  );
}
