import { ChatListScreen } from "@/features/chat/ChatListScreen";
import { withFeature } from "@/components/layout/FeatureGate";

/** The student's Messages tab: the shared chat list, without a back button. */
function PortalMessagesTab() {
  return <ChatListScreen asTab />;
}

export default withFeature("student_messaging", "Messages", PortalMessagesTab);
