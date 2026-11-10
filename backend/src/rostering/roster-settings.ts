/**
 * A source's settings (roster_source.settings), with defaults. Unknown keys
 * and wrong types are ignored, so a stored value written by an older version
 * still reads.
 */
export interface RosterSettings {
  /** OneRoster org sourcedId -> GradeBook school id; null = ignore that org's records. */
  orgMap: Record<string, string | null>;
  /** Match records without a link by email (accounts and roster emails) and by student number. */
  matchBy: { email: boolean; studentNumber: boolean };
  /** Email rostered students that they can sign in (off: no email to students). */
  notifyStudents: boolean;
  /** Email rostered staff without an account their invite (the existing invite email). */
  sendStaffInvites: boolean;
  /** OAuth2 scope for a OneRoster REST source; null = the OneRoster 1.2 roster-core read-only scope. */
  scope: string | null;
}

export const DEFAULT_SETTINGS: RosterSettings = {
  orgMap: {},
  matchBy: { email: true, studentNumber: true },
  notifyStudents: false,
  sendStaffInvites: true,
  scope: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readSettings(stored: unknown): RosterSettings {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const orgMap: Record<string, string | null> = {};
  if (s.orgMap && typeof s.orgMap === 'object' && !Array.isArray(s.orgMap)) {
    for (const [k, v] of Object.entries(s.orgMap as Record<string, unknown>)) {
      if (v === null) orgMap[k] = null;
      else if (typeof v === 'string' && UUID.test(v)) orgMap[k] = v.toLowerCase();
    }
  }
  const m = s.matchBy && typeof s.matchBy === 'object' ? (s.matchBy as Record<string, unknown>) : {};
  return {
    orgMap,
    matchBy: {
      email: typeof m.email === 'boolean' ? m.email : DEFAULT_SETTINGS.matchBy.email,
      studentNumber: typeof m.studentNumber === 'boolean' ? m.studentNumber : DEFAULT_SETTINGS.matchBy.studentNumber,
    },
    notifyStudents: typeof s.notifyStudents === 'boolean' ? s.notifyStudents : DEFAULT_SETTINGS.notifyStudents,
    sendStaffInvites: typeof s.sendStaffInvites === 'boolean' ? s.sendStaffInvites : DEFAULT_SETTINGS.sendStaffInvites,
    scope: typeof s.scope === 'string' && s.scope.trim() ? s.scope.trim() : null,
  };
}
