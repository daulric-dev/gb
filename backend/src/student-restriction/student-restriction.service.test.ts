import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { StudentRestrictionService } from './student-restriction.service';

const STAFF = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';

describe('StudentRestrictionService', () => {
  test('responses name who set the flags', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === STAFF ? { school_id: 'school-1', first_name: 'Ada', last_name: 'Lovelace' } : null,
    );
    prisma.student.findFirst.mockResolvedValue({ id: STUDENT });
    prisma.student_restriction.findUnique.mockResolvedValue({
      no_ai: true,
      no_similarity: false,
      exclude_from_analytics: false,
      set_by: STAFF,
      set_at: new Date('2026-11-01T00:00:00Z'),
    });
    const svc = new StudentRestrictionService(prisma as any, {} as any);
    const out = await svc.get(STAFF, STUDENT);
    expect(out).toMatchObject({ noAi: true, setBy: STAFF, setByName: 'Ada Lovelace' });

    prisma.student_restriction.findUnique.mockResolvedValue(null);
    expect((await svc.get(STAFF, STUDENT)).setByName).toBeNull();
  });

  test('setting no_ai deletes the AI grading drafts of the student\'s work at once', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    prisma.student.findFirst.mockResolvedValue({ id: STUDENT });
    prisma.student_restriction.findUnique.mockResolvedValue(null);
    prisma.student_restriction.upsert.mockResolvedValue({ no_ai: true, no_similarity: false, exclude_from_analytics: false, set_by: STAFF, set_at: new Date() });
    const svc = new StudentRestrictionService(prisma as any, { record: async () => {} } as any);
    await svc.update(STAFF, STUDENT, { noAi: true });
    expect(prisma.ai_grading_draft.deleteMany.mock.calls[0][0]).toEqual({ where: { student_id: STUDENT } });
    await svc.update(STAFF, STUDENT, { noSimilarity: true });
    expect(prisma.ai_grading_draft.deleteMany).toHaveBeenCalledTimes(1);
  });
});
