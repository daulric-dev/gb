import { useLocalSearchParams } from "expo-router";
import { TopicScreen } from "@/features/discussions/TopicScreen";

/** One discussion topic, as a student takes part in it. */
export default function StudentTopicScreen() {
  const { courseId, topicId } = useLocalSearchParams<{
    courseId: string;
    topicId: string;
  }>();
  return (
    <TopicScreen
      apiBase={`/portal/me/courses/${courseId}/discussions`}
      topicId={topicId}
      isStaff={false}
    />
  );
}
