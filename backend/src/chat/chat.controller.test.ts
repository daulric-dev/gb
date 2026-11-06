import { describe, test, expect, mock } from 'bun:test';
import { ChatController } from './chat.controller';

const SCHOOL = 'school-1';

function build(audience: Set<string> | null) {
  const chat = { presenceAudience: mock(async () => audience) };
  const presence = {
    onlineUserIds: mock(
      async (_school: string, aud: ReadonlySet<string> | null = null) => {
        const ids = ['teacher-1', 'teacher-2', 'student-2'];
        return aud ? ids.filter((id) => aud.has(id)) : ids;
      },
    ),
  };
  const prisma = {
    user_profile: {
      findUnique: mock(async () => ({ school_id: SCHOOL })),
    },
  };
  const controller = new ChatController(
    chat as any,
    {} as any,
    presence as any,
    prisma as any,
  );
  return { controller, chat, presence };
}

describe('ChatController.presenceList', () => {
  test('staff see everyone online in their school', async () => {
    const { controller, presence } = build(null);
    const res = await controller.presenceList({ user: { id: 'staff-1' } });
    expect(res.online).toEqual(['teacher-1', 'teacher-2', 'student-2']);
    expect(presence.onlineUserIds).toHaveBeenCalledWith(SCHOOL, null);
  });

  test('a student sees only the staff they may message', async () => {
    const { controller, chat } = build(new Set(['teacher-1']));
    const res = await controller.presenceList({ user: { id: 'student-1' } });
    expect(res.online).toEqual(['teacher-1']);
    expect(chat.presenceAudience).toHaveBeenCalledWith('student-1');
  });

  test('a student with no teachers sees no one', async () => {
    const { controller } = build(new Set());
    const res = await controller.presenceList({ user: { id: 'student-1' } });
    expect(res.online).toEqual([]);
  });
});
