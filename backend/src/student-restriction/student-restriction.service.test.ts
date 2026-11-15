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
});
