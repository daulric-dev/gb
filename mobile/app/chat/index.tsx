import { chatAllowed, withFeature } from "@/components/layout/FeatureGate";
import { ChatListScreen } from "@/features/chat/ChatListScreen";

/** Messages, pushed from More (staff) or from a notification. */
function ChatListRoute() {
  return <ChatListScreen />;
}

export default withFeature(chatAllowed, "Messages", ChatListRoute);
