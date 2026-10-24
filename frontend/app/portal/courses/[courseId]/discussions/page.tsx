"use client";

import { TopicList } from "@/components/discussions/TopicList";
import { usePortalCourse } from "../_components/course-context";

export default function PortalCourseDiscussionsPage() {
  const course = usePortalCourse();
  return (
    <TopicList
      apiBase={`/portal/me/courses/${course.id}/discussions`}
      linkBase={`/portal/courses/${course.id}/discussions`}
      isStaff={false}
      canManage={false}
    />
  );
}
