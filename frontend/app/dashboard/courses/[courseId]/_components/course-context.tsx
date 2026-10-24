"use client";

import { createContext, useContext } from "react";
import type { Course } from "@/lib/courses/types";

export interface CourseContextValue {
  course: Course;
  /** `/dashboard/courses/:id`, for building tab links. */
  base: string;
  /** Teacher or admin: may edit content, settings and people. */
  canManage: boolean;
  /** Re-fetch the course (after a settings or status change). */
  reload: () => Promise<void>;
}

export const CourseContext = createContext<CourseContextValue | null>(null);

/** The course the surrounding `[courseId]` layout loaded. */
export function useCourse(): CourseContextValue {
  const ctx = useContext(CourseContext);
  if (!ctx) {
    throw new Error("useCourse must be used inside the course layout");
  }
  return ctx;
}
