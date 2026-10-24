import { useLocalSearchParams } from "expo-router";
import { PageScreen } from "@/features/course/PageScreen";

/** A course page, read by its staff. Editing stays on the web. */
export default function StaffPageScreen() {
  const { courseId, pageId } = useLocalSearchParams<{
    courseId: string;
    pageId: string;
  }>();
  return <PageScreen path={`/courses/${courseId}/pages/${pageId}`} staff />;
}
