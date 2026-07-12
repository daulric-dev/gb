// Redis pub/sub channels and realtime event contracts for chat.
//
// Every event destined for a user is published to that user's channel; each
// replica subscribes to the channels of the users currently connected to it
// over SSE. This keeps fan-out O(participants) and needs no sticky sessions.

/** Per-user pub/sub channel. All of a user's realtime events flow through it. */
export function userChannel(userId: string): string {
  return `chat:u:${userId}`;
}

/** Whether multi-participant channels are enabled. DMs are always on. */
export function channelsEnabled(): boolean {
  return process.env.CHAT_CHANNELS_ENABLED === 'true';
}

/** SSE event names pushed to the browser (also the `type` on bus events). */
export const ChatEventType = {
  Message: 'message', // a new (or edited/deleted) message in a conversation
  Conversation: 'conversation', // a conversation was created or bumped
  Read: 'read', // a member advanced their read marker
  MessageAction: 'message_action', // a system-message action changed state
} as const;

export type ChatEventType = (typeof ChatEventType)[keyof typeof ChatEventType];
