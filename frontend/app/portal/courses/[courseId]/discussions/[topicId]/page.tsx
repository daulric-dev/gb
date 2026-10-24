"use client";

import { useParams } from "next/navigation";
import { TopicView } from "@/components/discussions/TopicView";
import { usePortalCourse } from "../../_components/course-context";

export default function PortalCourseDiscussionTopicPage() {
  const course = usePortalCourse();
  const { topicId } = useParams<{ topicId: string }>();
  return (
    <TopicView
      apiBase={`/portal/me/courses/${course.id}/discussions`}
      topicId={topicId}
      backHref={`/portal/courses/${course.id}/discussions`}
      isStaff={false}
    />
  );
}
