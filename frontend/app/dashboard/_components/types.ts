import type { CourseRole, CourseStatus } from "@/lib/courses/types";

/** GET /dashboard/summary */
export interface DashboardSummary {
  schoolId: string;
  /** Holds course:update - sees every course and the school overview. */
  isAdmin: boolean;
  activeYear: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
  } | null;
  /** Courses the caller teaches or assists in, archived ones left out. */
  myCourses: DashboardCourse[];
  awaitingMarking: number;
  /** Admins only. */
  school: SchoolOverview | null;
}

export interface DashboardCourse {
  id: string;
  name: string;
  code: string | null;
  status: CourseStatus;
  role: CourseRole;
  studentCount: number;
  /** Submissions handed in and not yet marked. */
  awaitingMarking: number;
}

export interface RecentActivityEntry {
  type: "course_created" | "activity_published" | "announcement";
  id: string;
  title: string;
  courseId: string | null;
  courseName: string | null;
  at: string;
}

export interface SchoolOverview {
  courses: { total: number; draft: number; published: number; archived: number };
  students: { total: number; active: number };
  staff: { total: number; admins: number; teachers: number; members: number };
  recentActivity: RecentActivityEntry[];
}
