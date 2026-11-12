import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { createMockPrisma } from '@/test/prisma-mock';
import { NotificationSettingsService } from './notification-settings.service';

function build() {
  const prisma = createMockPrisma();
  const audit = { record: mock(async () => undefined) };
  return { prisma, audit, service: new NotificationSettingsService(prisma as any, audit as any) };
}

describe('NotificationSettingsService', () => {
  test('preferences: merges a patch into the stored off lists', async () => {
    const { prisma, service } = build();
    prisma.notification_preference_opt_out.findMany.mockResolvedValue([
      { channel: 'push', category: 'chat' },
    ]);
    const out = await service.updatePreferences('u1', { push: { chat: true, grades: false }, email: { attendance: false } });
    expect(prisma.notification_preference_opt_out.deleteMany.mock.calls[0][0]).toEqual({ where: { user_profile_id: 'u1' } });
    expect(prisma.notification_preference_opt_out.createMany.mock.calls[0][0].data).toEqual([
      { user_profile_id: 'u1', channel: 'push', category: 'grades' },
      { user_profile_id: 'u1', channel: 'email', category: 'attendance' },
    ]);
    expect(out.push.grades).toBe(false);
    expect(out.push.chat).toBe(true);
    expect(out.email.attendance).toBe(false);
    expect(out.categories.map((c) => c.key)).toContain('attendance');
  });

  test('school push content: saved and audited', async () => {
    const { prisma, audit, service } = build();
    prisma.school.findUnique.mockResolvedValue({ push_content: null });
    await service.setSchoolPushContent('s1', 'full', 'admin');
    expect(prisma.school.update.mock.calls[0][0]).toEqual({ where: { id: 's1' }, data: { push_content: 'full' } });
    const [, schoolId, actor, entry] = (audit.record.mock.calls as any[])[0];
    expect(schoolId).toBe('s1');
    expect(actor).toEqual({ id: 'admin' });
    expect(entry.changes).toEqual({ push_content: { before: null, after: 'full' } });
  });

  test('organisation push content: saved and audited at organisation scope; bad values refused', async () => {
    const { prisma, audit, service } = build();
    prisma.organisation.findFirst.mockResolvedValue({ id: 'org', push_content: 'full' });
    await service.setOrganisationPushContent('generic', 'owner');
    expect(prisma.organisation.update.mock.calls[0][0].data).toEqual({ push_content: 'generic' });
    expect((audit.record.mock.calls as any[])[0][1]).toBeNull();
    await expect(service.setOrganisationPushContent('loud' as any, 'owner')).rejects.toBeInstanceOf(BadRequestException);
  });
});
