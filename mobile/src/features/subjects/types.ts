/**
 * Local Subject type for the subjects feature. Mirrors the backend
 * `subject.list` shape (snake_case) returned by `GET /subjects`.
 */
export interface Subject {
  id: string;
  school_id: string;
  name: string;
  code: string | null;
  is_graded: boolean;
  sort_order: number;
}
