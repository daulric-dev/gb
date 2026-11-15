import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import {
  EMAIL_CHANGE_MAX_ATTEMPTS,
  EMAIL_CHANGE_MAX_SENDS,
  EmailChangeService,
  hashEmailChangeCode,
} from './email-change.service';
import { STEP_UP_KEY } from './step-up.guard';
import { EmailChangeController } from './email-change.controller';

const USER = 'user-1';
const OLD = 'jo@old.example';
const NEW = 'jo@new.example';

describe('EmailChangeService', () => {
  let prisma: MockPrisma;
  let mail: { send: ReturnType<typeof mock>; configured: () => boolean };
  let sessions: { revokeOthers: ReturnType<typeof mock>; revokeAll: ReturnType<typeof mock>; purgeCached: ReturnType<typeof mock> };
  let audit: { record: ReturnType<typeof mock> };
  let sso: Record<string, { label: string } | null>;
  let service: EmailChangeService;
  let row: Record<string, any> | null;

  beforeEach(() => {
    prisma = createMockPrisma();
    mail = { send: mock(async () => undefined), configured: () => true };
    sessions = {
      revokeOthers: mock(async () => 2),
      revokeAll: mock(async () => 1),
      purgeCached: mock(async () => undefined),
    };
    audit = { record: mock(async () => undefined) };
    sso = {};
    const domains = {
      ssoRequirement: async (email: string) => sso[email.split('@')[1]] ?? null,
    };
    service = new EmailChangeService(
      prisma as any,
      createMockCacheService() as any,
      mail as any,
      sessions as any,
      domains as any,
      audit as any,
    );
    row = null;
    prisma.app_user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === USER ? { id: USER, email: OLD, disabled_at: null } : null,
    );
    prisma.email_change.findUnique.mockImplementation(async () => row);
    prisma.email_change.upsert.mockImplementation(async ({ create, update }: any) => {
      row = row ? { ...row, ...update } : { ...create };
      return row;
    });
    prisma.email_change.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (!row || row.attempts >= where.attempts.lt) return { count: 0 };
      row.attempts += data.attempts.increment;
      return { count: 1 };
    });
    prisma.email_change.deleteMany.mockImplementation(async ({ where }: any) => {
      if (row && where.user_id === USER && where.code_hash === row.code_hash) {
        row = null;
        return { count: 1 };
      }
      return { count: 0 };
    });
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  });

  /** The code that went out in the last email. */
  const mailedCode = () => /\d{8}/.exec((mail.send.mock.calls.at(-1) as any)[0].text)![0];

  test('request: the code goes to the NEW address, hashed in storage, mail kind set', async () => {
    const out = await service.request(USER, ' Jo@New.Example ');
    expect(out.email).toBe(NEW);
    const sent = (mail.send.mock.calls[0] as any)[0];
    expect(sent.to).toBe(NEW);
    expect(sent.kind).toBe('email_change_code');
    const code = mailedCode();
    expect(row!.code_hash).toBe(hashEmailChangeCode(USER, NEW, code));
    expect(JSON.stringify(row)).not.toContain(code);
  });

  test('request refuses the same address, a taken one, and SSO domains (either side)', async () => {
    await expect(service.request(USER, OLD)).rejects.toBeInstanceOf(BadRequestException);

    prisma.app_user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === USER ? { id: USER, email: OLD, disabled_at: null } : where.email === NEW ? { id: 'other' } : null,
    );
    await expect(service.request(USER, NEW)).rejects.toBeInstanceOf(ConflictException);
    prisma.app_user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === USER ? { id: USER, email: OLD, disabled_at: null } : null,
    );

    prisma.user_profile.findFirst.mockResolvedValueOnce({ id: 'other-profile' });
    await expect(service.request(USER, NEW)).rejects.toBeInstanceOf(ConflictException);

    sso['new.example'] = { label: 'Google' };
    await expect(service.request(USER, NEW)).rejects.toBeInstanceOf(ForbiddenException);
    sso = { 'old.example': { label: 'Microsoft' } };
    await expect(service.request(USER, NEW)).rejects.toThrow(/manages your sign-in/);
    expect(mail.send).not.toHaveBeenCalled();
  });

  test(`request: at most ${EMAIL_CHANGE_MAX_SENDS} codes an hour`, async () => {
    for (let i = 0; i < EMAIL_CHANGE_MAX_SENDS; i++) await service.request(USER, NEW);
    const err = await service.request(USER, NEW).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  test('confirm: swaps the address, signs out other sessions, audits masked, alerts the OLD address', async () => {
    prisma.session.findUnique.mockResolvedValue({ token_hash: 'h', previous_token_hash: null });
    await service.request(USER, NEW);
    const code = mailedCode();
    const out = await service.confirm(USER, 'sess-1', code);
    expect(out).toEqual({ email: NEW });

    expect(prisma.app_user.update.mock.calls[0][0]).toMatchObject({ where: { id: USER }, data: { email: NEW } });
    expect(prisma.user_profile.update.mock.calls[0][0]).toEqual({ where: { id: USER }, data: { email: NEW } });
    expect(sessions.revokeOthers).toHaveBeenCalledWith(USER, 'sess-1', 'email_changed');
    expect(sessions.purgeCached).toHaveBeenCalledWith([{ token_hash: 'h', previous_token_hash: null }]);

    const [, schoolId, actor, entry] = (audit.record.mock.calls as any[])[0];
    expect(schoolId).toBe('school-1');
    expect(actor).toEqual({ id: USER });
    expect(entry).toMatchObject({ entity: 'account_email', action: 'update' });
    expect(entry.changes.email).toEqual({ before: 'j***@old.example', after: 'j***@new.example' });

    await new Promise((r) => setTimeout(r, 0));
    const alert = (mail.send.mock.calls.at(-1) as any)[0];
    expect(alert.to).toBe(OLD);
    expect(alert.kind).toBe('email_changed_alert');
    expect(alert.text).not.toContain(NEW);
    expect(row).toBeNull();
  });

  test(`confirm: a wrong code takes an attempt; after ${EMAIL_CHANGE_MAX_ATTEMPTS} the code is dead`, async () => {
    await service.request(USER, NEW);
    const code = mailedCode();
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < EMAIL_CHANGE_MAX_ATTEMPTS; i++) {
      await expect(service.confirm(USER, 'sess-1', wrong)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.confirm(USER, 'sess-1', code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.app_user.update).not.toHaveBeenCalled();
  });

  test('confirm: an expired code, or none, is refused', async () => {
    await expect(service.confirm(USER, 'sess-1', '12345678')).rejects.toBeInstanceOf(UnauthorizedException);
    await service.request(USER, NEW);
    const code = mailedCode();
    row!.expires_at = new Date(Date.now() - 1);
    await expect(service.confirm(USER, 'sess-1', code)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  test('confirm re-checks that the address is still free', async () => {
    await service.request(USER, NEW);
    const code = mailedCode();
    prisma.user_profile.findFirst.mockResolvedValueOnce({ id: 'someone-else' });
    await expect(service.confirm(USER, 'sess-1', code)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.app_user.update).not.toHaveBeenCalled();
  });
});

describe('EmailChangeController', () => {
  test('asking for a code needs a recent step-up; confirming does not', () => {
    const proto = EmailChangeController.prototype as any;
    expect(Reflect.getMetadata(STEP_UP_KEY, proto.request)).toBe(true);
    expect(Reflect.getMetadata(STEP_UP_KEY, proto.confirm)).toBeUndefined();
  });
});
