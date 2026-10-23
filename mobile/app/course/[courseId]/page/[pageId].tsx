import { useLocalSearchParams } from "expo-router";
import { PageScreen } from "@/features/course/PageScreen";

/** A course page, as a student reads it. */
export default function StudentPageScreen() {
  const { courseId, pageId } = useLocalSearchParams<{
    courseId: string;
    pageId: string;
  }>();
  return <PageScreen path={`/portal/me/courses/${courseId}/pages/${pageId}`} />;
}
