"use client";

import { useParams } from "next/navigation";
import { TopicView } from "@/components/discussions/TopicView";
import { useCourse } from "../../_components/course-context";

export default function CourseDiscussionTopicPage() {
  const { course, base } = useCourse();
  const { topicId } = useParams<{ topicId: string }>();
  return (
    <TopicView
      apiBase={`/courses/${course.id}/discussions`}
      topicId={topicId}
      backHref={`${base}/discussions`}
      isStaff
    />
  );
}
