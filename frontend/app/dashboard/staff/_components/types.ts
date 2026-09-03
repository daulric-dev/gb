export type BaseRole = "admin" | "teacher" | "member";
export type StaffSectionRole = BaseRole | "custom";

export interface SchoolMember {
  id: string;
  role: BaseRole | null;
  is_owner?: boolean;
  created_at: string;
  user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
  roles: { id: string; name: string }[];
}

export interface JoinRequest {
  id: string;
  status: string;
  message: string | null;
  requested_at: string;
  user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
  school: { id: string; name: string } | null;
}
