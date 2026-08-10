/** Section-local types for the Staff feature (mirrors the web shapes). */

export type MemberRole = "admin" | "teacher" | "member";

export interface SchoolMember {
  id: string;
  role: MemberRole;
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

export interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export function memberName(user: SchoolMember["user"]): string {
  if (!user) return "Unknown user";
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unnamed"
  );
}

export function requestName(request: JoinRequest): string {
  return (
    [request.user?.first_name, request.user?.last_name]
      .filter(Boolean)
      .join(" ") ||
    request.user?.email ||
    "Unknown user"
  );
}
