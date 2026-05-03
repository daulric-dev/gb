export interface SchoolMember {
  id: string;
  role: "admin" | "teacher" | "member";
  created_at: string;
  user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}
