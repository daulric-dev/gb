"use client";

import { useEffect } from "react";
import { useProfile } from "@/providers/AuthProvider";
import { connectChat, disconnectChat } from "@/lib/chat";

/**
 * Opens the chat realtime stream for the signed-in user and tears it down on
 * unmount. Renders nothing — it exists so the Messages unread badge and any
 * open thread stay live across the whole dashboard, not just the chat page.
 */
export function ChatProvider() {
  const { profile } = useProfile();
  const userId = profile.value?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    connectChat(userId);
    return () => disconnectChat();
  }, [userId]);

  return null;
}
