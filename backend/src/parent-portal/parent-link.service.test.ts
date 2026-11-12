import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ParentLinkService } from './parent-link.service';
import { hashInviteToken, hashLinkCode } from './parent-token';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const future = () => new Date(Date.now() + 86_400_000);

function invite(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    student_id: STUDENT,
    school_id: 'school-1',
    kind: 'email',
    email: 'mum@example.com',
    relationship: 'mother',
    relationship_label: null,
    expires_at: future(),
    used_at: null,
    revoked_at: null,
    created_by: 'staff-1',
    ...over,
  };
}

describe('ParentLinkService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let mail: { send: ReturnType<typeof mock> };
  let service: ParentLinkService;
  let org: Record<string, boolean>;

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    (cache as any).incr = mock(async () => 1);
    (cache as any).deleteByPrefix = mock(async () => undefined);
    mail = { send: mock(async () => undefined) };
    org = { parent_portal: true };
    prisma.organisation.findFirst.mockImplementation(async () => ({ features: org }));
    prisma.school.findUnique.mockResolvedValue({ disabled_feature_rows: [] });
    const features = new FeatureService(prisma as any, createMockCacheService() as any);
    service = new ParentLinkService(prisma as any, cache as any, mail as any, features);
  });

  describe('staff', () => {
    beforeEach(() => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
      prisma.student.findFirst.mockImplementation(async ({ where }: any) =>
        where.id === STUDENT && where.school_id === 'school-1'
          ? { id: STUDENT, first_name: 'Ada', last_name: 'L', school: { name: 'Riverside' } }
          : null,
      );
      prisma.parent_invite.create.mockResolvedValue({ id: 'inv-1' });
    });

    test('invite stores only a hash of the token and emails the link', async () => {
      const res = await service.invite('staff-1', STUDENT, { email: ' Mum@Example.com ' });
      expect(res).toMatchObject({ kind: 'email', email: 'mum@example.com' });
      expect(JSON.stringify(res)).not.toContain('token');

      const data = prisma.parent_invite.create.mock.calls[0][0].data;
      expect(data.email).toBe('mum@example.com');
      expect(data.school_id).toBe('school-1');
      const sent = mail.send.mock.calls[0][0] as any;
      expect(sent.to).toBe('mum@example.com');
      const token = decodeURIComponent(/token=([^\s"&]+)/.exec(sent.text)![1]);
      expect(data.token_hash).toBe(hashInviteToken(token));
      expect(data.token_hash).not.toContain(token);
      expect(data.expires_at.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    });

    test('a student in another school is a 404', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-2' });
      const err = await expectRejection(service.invite('staff-1', STUDENT, { email: 'a@b.co' }));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(mail.send).not.toHaveBeenCalled();
    });

    test('an email that fails to send withdraws the invitation', async () => {
      mail.send.mockImplementation(async () => {
        throw new Error('smtp down');
      });
      const err = await expectRejection(service.invite('staff-1', STUDENT, { email: 'a@b.co' }));
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.parent_invite.update.mock.calls[0][0].data.revoked_at).toBeInstanceOf(Date);
    });

    test('link codes are returned once and stored hashed', async () => {
      const res = await service.createLinkCode('staff-1', STUDENT, {});
      expect(res.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      const data = prisma.parent_invite.create.mock.calls[0][0].data;
      expect(data.kind).toBe('code');
      expect(data.token_hash).toBe(hashLinkCode(res.code));
    });

    test('removing a link is scoped to the student', async () => {
      prisma.parent_student_link.findFirst.mockResolvedValue(null);
      const err = await expectRejection(service.removeLink('staff-1', STUDENT, 'link-x'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(prisma.parent_student_link.findFirst.mock.calls[0][0].where).toEqual({
        id: 'link-x',
        student_id: STUDENT,
      });
    });
  });

  describe('accepting', () => {
    const user = { id: 'u-parent', email: 'mum@example.com' };
    const student = {
      id: STUDENT,
      first_name: 'Ada',
      last_name: 'L',
      is_active: true,
      school_id: 'school-1',
      date_of_birth: null,
      school: { name: 'Riverside', parent_settings: {} },
    };

    beforeEach(() => {
      prisma.parent_invite.findUnique.mockResolvedValue(invite());
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.user_profile.findUnique.mockResolvedValue({
        account_type: 'staff',
        school_id: null,
        first_name: null,
        is_active: true,
      });
      prisma.parent_invite.updateMany.mockResolvedValue({ count: 1 });
      prisma.parent_student_link.create.mockResolvedValue({ id: 'link-1' });
    });

    test('a blank account becomes a parent linked to the child', async () => {
      const res = await service.accept(user, { token: 't'.repeat(43), firstName: 'Mary' });
      expect(res.studentId).toBe(STUDENT);
      expect(prisma.parent_invite.findUnique.mock.calls[0][0].where).toEqual({
        token_hash: hashInviteToken('t'.repeat(43)),
      });
      const claim = prisma.parent_invite.updateMany.mock.calls[0][0];
      expect(claim.where).toMatchObject({ id: 'inv-1', used_at: null, revoked_at: null });
      expect(prisma.user_profile.update.mock.calls[0][0].data).toMatchObject({
        account_type: 'parent',
        role: null,
        school_id: null,
        first_name: 'Mary',
      });
      expect(prisma.parent_student_link.create.mock.calls[0][0].data).toMatchObject({
        user_profile_id: 'u-parent',
        student_id: STUDENT,
        relationship: 'mother',
      });
    });

    test('single use: a used invitation is 410', async () => {
      prisma.parent_invite.findUnique.mockResolvedValue(invite({ used_at: new Date() }));
      const err: any = await expectRejection(service.accept(user, { token: 't'.repeat(43), firstName: 'M' }));
      expect(err).toBeInstanceOf(GoneException);
      expect(err.getResponse().code).toBe('INVITE_INVALID');
      expect(prisma.parent_student_link.create).not.toHaveBeenCalled();
    });

    test('single use: losing the claim race is 410 and links nothing', async () => {
      prisma.parent_invite.updateMany.mockResolvedValue({ count: 0 });
      const err = await expectRejection(service.accept(user, { token: 't'.repeat(43), firstName: 'M' }));
      expect(err).toBeInstanceOf(GoneException);
      expect(prisma.parent_student_link.create).not.toHaveBeenCalled();
    });

    test('expired and revoked invitations are 410', async () => {
      for (const over of [{ expires_at: new Date(Date.now() - 1000) }, { revoked_at: new Date() }]) {
        prisma.parent_invite.findUnique.mockResolvedValue(invite(over));
        const err = await expectRejection(service.accept(user, { token: 't'.repeat(43), firstName: 'M' }));
        expect(err).toBeInstanceOf(GoneException);
      }
    });

    test('an unknown token is 410', async () => {
      prisma.parent_invite.findUnique.mockResolvedValue(null);
      const err = await expectRejection(service.accept(user, { token: 'x'.repeat(43) }));
      expect(err).toBeInstanceOf(GoneException);
    });

    test('the signed-in address must be the invited one', async () => {
      const err = await expectRejection(
        service.accept({ id: 'u2', email: 'someone@else.com' }, { token: 't'.repeat(43) }),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.parent_invite.updateMany).not.toHaveBeenCalled();
    });

    test('refused with 403 FEATURE_DISABLED while the school has the portal off', async () => {
      org = { parent_portal: false };
      const err = await expectRejection(service.accept(user, { token: 't'.repeat(43), firstName: 'M' }));
      expect(err).toBeInstanceOf(FeatureDisabledException);
      expect(prisma.parent_invite.updateMany).not.toHaveBeenCalled();
    });

    test('student accounts and staff with a school are not eligible', async () => {
      for (const profile of [
        { account_type: 'student', school_id: 'school-1', first_name: 'A', is_active: true },
        { account_type: 'staff', school_id: 'school-1', first_name: 'A', is_active: true },
      ]) {
        prisma.user_profile.findUnique.mockResolvedValue(profile);
        const err: any = await expectRejection(service.accept(user, { token: 't'.repeat(43) }));
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse().code).toBe('ACCOUNT_NOT_ELIGIBLE');
      }
      expect(prisma.parent_invite.updateMany).not.toHaveBeenCalled();
    });

    test('a staff membership without an active school still blocks', async () => {
      prisma.school_management.count.mockResolvedValue(1);
      const err = await expectRejection(service.accept(user, { token: 't'.repeat(43), firstName: 'M' }));
      expect(err).toBeInstanceOf(ConflictException);
    });
  });

  describe('redeeming a code', () => {
    test('a wrong code counts against the account', async () => {
      prisma.parent_invite.findUnique.mockResolvedValue(null);
      const err = await expectRejection(service.redeemCode({ id: 'u1' }, { code: 'abcde-fghjk' }));
      expect(err).toBeInstanceOf(NotFoundException);
      expect((cache as any).incr).toHaveBeenCalled();
      expect(prisma.parent_invite.findUnique.mock.calls[0][0].where.token_hash).toBe(
        hashLinkCode('ABCDEFGHJK'),
      );
    });

    test('after too many wrong codes every attempt is refused', async () => {
      await cache.set('parent-link:failed-code:u1', 10, 60);
      const err: any = await expectRejection(service.redeemCode({ id: 'u1' }, { code: 'ABCDE-FGHJK' }));
      expect(err.getStatus()).toBe(429);
      expect(prisma.parent_invite.findUnique).not.toHaveBeenCalled();
    });

    test('an email invitation cannot be redeemed as a code', async () => {
      prisma.parent_invite.findUnique.mockResolvedValue(invite());
      const err = await expectRejection(service.redeemCode({ id: 'u1' }, { code: 'ABCDE-FGHJK' }));
      expect(err).toBeInstanceOf(NotFoundException);
    });
  });
});
