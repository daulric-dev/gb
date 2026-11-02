import { describe, expect, test } from 'bun:test';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ChatAccessGuard } from './chat-access.guard';
import { ChatController } from './chat.controller';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

function context(method: string, userId = 'u1') {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId }, params: {} }) }),
    getHandler: () => (ChatController.prototype as any)[method],
    getClass: () => ChatController,
  } as unknown as ExecutionContext;
}

function setup(opts: {
  accountType: 'staff' | 'student';
  studentMessaging?: boolean;
  staffRole?: string | null;
}) {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({
    account_type: opts.accountType,
    is_active: true,
    school_id: 'school-1',
  });
  prisma.organisation.findFirst.mockResolvedValue({
    features: { student_messaging: !!opts.studentMessaging },
  });
  prisma.school.findUnique.mockResolvedValue({ disabled_features: [] });
  prisma.school_management.findUnique.mockResolvedValue(
    opts.staffRole ? { role: opts.staffRole, school_management_role: [] } : null,
  );
  prisma.school_management.findFirst.mockResolvedValue(
    opts.staffRole ? { role: opts.staffRole, school_management_role: [] } : null,
  );
  const cache = createMockCacheService();
  const features = new FeatureService(prisma as any, cache as any);
  return new ChatAccessGuard(new Reflector(), cache as any, prisma as any, features);
}

describe('ChatAccessGuard', () => {
  test('staff go through the chat:* permission check', async () => {
    const outsider = setup({ accountType: 'staff', staffRole: null });
    const err = await expectRejection(outsider.canActivate(context('listConversations')));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err).not.toBeInstanceOf(FeatureDisabledException);

    const admin = setup({ accountType: 'staff', staffRole: 'admin' });
    expect(await admin.canActivate(context('listConversations'))).toBe(true);
  });

  test('students get 403 FEATURE_DISABLED while student messaging is off', async () => {
    const guard = setup({ accountType: 'student' });
    const err: any = await expectRejection(guard.canActivate(context('listConversations', 'stu')));
    expect(err).toBeInstanceOf(FeatureDisabledException);
    expect(err.getResponse()).toMatchObject({
      code: 'FEATURE_DISABLED',
      feature: 'student_messaging',
    });
  });

  test('students pass DM routes when it is on, without chat permissions', async () => {
    const guard = setup({ accountType: 'student', studentMessaging: true });
    for (const route of [
      'listConversations',
      'createConversation',
      'listMessages',
      'sendMessage',
      'markRead',
      'users',
      'stream',
      'unreadCount',
    ]) {
      expect(await guard.canActivate(context(route, 'stu'))).toBe(true);
    }
  });

  test('students never create channels', async () => {
    const guard = setup({ accountType: 'student', studentMessaging: true });
    const err = await expectRejection(guard.canActivate(context('createChannel', 'stu')));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as Error).message).toBe('Channels are for staff');
  });
});
