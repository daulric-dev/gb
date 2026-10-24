import { useLocalSearchParams } from "expo-router";
import { TopicScreen } from "@/features/discussions/TopicScreen";

/** One discussion topic, for staff to take part in and moderate. */
export default function StaffTopicScreen() {
  const { courseId, topicId } = useLocalSearchParams<{
    courseId: string;
    topicId: string;
  }>();
  return (
    <TopicScreen
      apiBase={`/courses/${courseId}/discussions`}
      topicId={topicId}
      isStaff
    />
  );
}
