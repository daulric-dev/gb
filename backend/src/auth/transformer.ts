import type { Tables } from '@/types/database.types';

type UserProfile = Tables<'user_profile'>;

export interface ProfileResponse {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: UserProfile['role'];
  avatar_url: string | null;
  school: any | null;
}

export interface SessionResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
}

export interface VerifyOtpResponse {
  session: SessionResponse;
  user: ProfileResponse & { is_onboarded: boolean };
}

export interface MessageResponse {
  message: string;
}

export function v1Profile(raw: any): ProfileResponse {
  return {
    id: raw.id,
    email: raw.email,
    first_name: raw.first_name ?? null,
    last_name: raw.last_name ?? null,
    role: raw.role ?? null,
    avatar_url: raw.avatar_url ?? null,
    school: raw.school ?? null,
  };
}

export function v1Session(raw: any): SessionResponse {
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_in: raw.expires_in,
    expires_at: raw.expires_at,
  };
}

export function v1VerifyOtp(
  session: any,
  user: any,
  profile: any,
): VerifyOtpResponse {
  const hasOnboarded = !!(profile?.first_name && profile?.school_id);
  return {
    session: v1Session(session),
    user: {
      id: user.id,
      email: user.email,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      role: profile?.role ?? null,
      avatar_url: profile?.avatar_url ?? null,
      school: profile?.school ?? null,
      is_onboarded: hasOnboarded,
    },
  };
}

export function v1Message(message: string): MessageResponse {
  return { message };
}
