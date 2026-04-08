export function v1Profile(raw: any) {
  return {
    id: raw.id,
    email: raw.email,
    first_name: raw.first_name ?? null,
    last_name: raw.last_name ?? null,
    role: raw.role ?? null,
    school: raw.school ?? null,
  };
}

export function v1Session(raw: any) {
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_in: raw.expires_in,
    expires_at: raw.expires_at,
  };
}

export function v1VerifyOtp(session: any, user: any, profile: any) {
  const hasOnboarded = !!(profile?.first_name && profile?.school_id);
  return {
    session: v1Session(session),
    user: {
      id: user.id,
      email: user.email,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      role: profile?.role ?? null,
      school: profile?.school ?? null,
      is_onboarded: hasOnboarded,
    },
  };
}

export function v1Message(message: string) {
  return { message };
}
