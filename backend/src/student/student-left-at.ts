/**
 * `student.left_at` starts a school's leaver retention clock
 * (src/retention/school-retention.service.ts), so every write that sets
 * `student.is_active` must keep it in step. The rule (the same as the
 * PostgreSQL trigger `student_set_left_at`, which remains as a backstop
 * where the hardening step installed it):
 *
 * - active (true or null): `left_at` is null;
 * - becoming inactive (a new inactive student, or active -> inactive):
 *   `left_at` is now;
 * - staying inactive: the original `left_at` is kept (now if it was lost).
 *
 * Use `withLeftAt` on the data of every `student.create`/`update`/
 * `updateMany` that sets `is_active`, with the row as it was before the
 * write (null for a create). A repository test (student-left-at.test.ts)
 * fails if a student write sets `is_active` without it.
 */

export interface StudentActiveState {
  is_active: boolean | null;
  left_at: Date | null;
}

/** `left_at` after a write that leaves `is_active` as `nextActive`. */
export function leftAtFor(
  before: StudentActiveState | null,
  nextActive: boolean | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (nextActive !== false) return null;
  if (!before || before.is_active !== false) return now;
  return before.left_at ?? now;
}

/**
 * `data` with `left_at` set to match its `is_active`. Data that does not
 * set `is_active` is returned unchanged (`left_at` is never written on its
 * own: it only follows `is_active`).
 */
export function withLeftAt<T extends object>(
  data: T,
  before: StudentActiveState | null,
  now: Date = new Date(),
): T & { left_at?: Date | null } {
  const next = (data as { is_active?: unknown }).is_active;
  if (next === undefined) return data;
  if (next !== null && typeof next !== 'boolean') {
    // An update operator ({ set: ... }) would hide the new value.
    throw new Error('withLeftAt needs is_active as a plain boolean or null');
  }
  return { ...data, left_at: leftAtFor(before, next, now) };
}
