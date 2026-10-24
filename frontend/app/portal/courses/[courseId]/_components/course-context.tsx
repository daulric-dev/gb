"use client";

import { createContext, useContext } from "react";
import type { PortalCourseDetail } from "../../../_components/types";

const CourseContext = createContext<PortalCourseDetail | null>(null);

export const CourseProvider = CourseContext.Provider;

/** The course loaded by the course layout. Only use under that layout. */
export function usePortalCourse(): PortalCourseDetail {
  const course = useContext(CourseContext);
  if (!course) throw new Error("usePortalCourse outside the course layout");
  return course;
}
