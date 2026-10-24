"use client";

import { TopicList } from "@/components/discussions/TopicList";
import { useCourse } from "../_components/course-context";

export default function CourseDiscussionsPage() {
  const { course, base, canManage } = useCourse();
  return (
    <TopicList
      apiBase={`/courses/${course.id}/discussions`}
      linkBase={`${base}/discussions`}
      isStaff
      canManage={canManage}
    />
  );
}
