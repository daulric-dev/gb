import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { EmailCodeService, hashCode } from './email-code.service';
import { SESSION_COOKIE, SessionService } from './session.service';

function emailCodes() {
  const prisma = createMockPrisma();
  const sent: { to: string; text: string }[] = [];
  const mail = { send: mock(async (m: any) => void sent.push(m)) };
  const service = new EmailCodeService(prisma as any, mail as any);
  return { prisma, sent, service };
}

const liveRow = (email: string, code: string, extra: Record<string, unknown> = {}) => ({
  id: 'code-1',
  email,
  code_hash: hashCode(email, code),
  expires_at: new Date(Date.now() + 60_000),
  attempts: 0,
  consumed_at: null,
  ...extra,
});

describe('EmailCodeService', () => {
  test('sends an 8-digit code and retires the previous one', async () => {
    const { prisma, sent, service } = emailCodes();
    await service.send('  Jo@School.EDU ');
    expect(sent[0].to).toBe('jo@school.edu');
    const code = /(\d{8})/.exec(sent[0].text)![1];
    const created = prisma.email_code.create.mock.calls[0][0].data;
    expect(created.code_hash).toBe(hashCode('jo@school.edu', code));
    expect(prisma.email_code.updateMany.mock.calls[0][0].where).toEqual({
      email: 'jo@school.edu',
      consumed_at: null,
    });
  });

  test('refuses after five sends in the window', async () => {
    const { prisma, service } = emailCodes();
    prisma.email_code.count.mockResolvedValue(5);
    await expect(service.send('jo@school.edu')).rejects.toThrow('Too many codes');
  });

  test('a right code is used once', async () => {
    const { prisma, service } = emailCodes();
    prisma.email_code.findFirst.mockResolvedValue(liveRow('jo@school.edu', '12345678'));
    prisma.email_code.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.verify('JO@school.edu', '12345678')).toBe('jo@school.edu');
    prisma.email_code.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.verify('jo@school.edu', '12345678')).rejects.toThrow('Invalid');
  });

  test('a wrong code counts an attempt', async () => {
    const { prisma, service } = emailCodes();
    prisma.email_code.findFirst.mockResolvedValue(liveRow('jo@school.edu', '12345678'));
    await expect(service.verify('jo@school.edu', '00000000')).rejects.toThrow('Invalid');
    expect(prisma.email_code.update.mock.calls[0][0].data).toEqual({ attempts: { increment: 1 } });
  });

  test('expired codes and exhausted attempts are refused without checking', async () => {
    for (const extra of [{ expires_at: new Date(Date.now() - 1) }, { attempts: 5 }]) {
      const { prisma, service } = emailCodes();
      prisma.email_code.findFirst.mockResolvedValue(liveRow('jo@school.edu', '12345678', extra));
      await expect(service.verify('jo@school.edu', '12345678')).rejects.toThrow('Invalid');
      expect(prisma.email_code.updateMany).not.toHaveBeenCalled();
    }
  });
});

function sessions() {
  const prisma = createMockPrisma();
  const cache = createMockCacheService();
  const service = new SessionService(prisma as any, cache as any);
  const cookies: Record<string, unknown> = {};
  const reply = {
    setCookie: mock((name: string, value: string) => void (cookies[name] = value)),
    clearCookie: mock((name: string) => void (cookies[name] = null)),
  };
  return { prisma, cache, service, reply, cookies };
}

const sessionRow = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  expires_at: new Date(Date.now() + 86_400_000),
  revoked_at: null,
  last_seen_at: new Date(),
  app_user: { id: 'u1', email: 'jo@school.edu', disabled_at: null },
  ...extra,
});

describe('SessionService', () => {
  test('create stores only a hash of the cookie token', async () => {
    const { prisma, service, reply, cookies } = sessions();
    const req = { headers: { 'user-agent': 'test' }, ip: '1.2.3.4' } as any;
    const token = await service.create(reply as any, req, 'u1', 'email-code');
    expect(cookies[SESSION_COOKIE]).toBe(token);
    const stored = prisma.session.create.mock.calls[0][0].data;
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.method).toBe('email-code');
  });

  test('resolve returns the user and caches it', async () => {
    const { prisma, service } = sessions();
    prisma.session.findUnique.mockResolvedValue(sessionRow());
    const req = { cookies: { [SESSION_COOKIE]: 'tok' } } as any;
    expect(await service.resolve(req)).toMatchObject({ userId: 'u1', email: 'jo@school.edu' });
    await service.resolve(req);
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
  });

  test('revoked, expired and disabled sessions resolve to null and clear the cookie', async () => {
    for (const extra of [
      { revoked_at: new Date() },
      { expires_at: new Date(Date.now() - 1) },
      { app_user: { id: 'u1', email: 'x', disabled_at: new Date() } },
    ]) {
      const { prisma, service, reply } = sessions();
      prisma.session.findUnique.mockResolvedValue(sessionRow(extra));
      const req = { cookies: { [SESSION_COOKIE]: 'tok' } } as any;
      expect(await service.resolve(req, reply as any)).toBeNull();
      expect(reply.clearCookie).toHaveBeenCalled();
    }
  });

  test('an idle day extends the session', async () => {
    const { prisma, service, reply } = sessions();
    prisma.session.findUnique.mockResolvedValue(
      sessionRow({ last_seen_at: new Date(Date.now() - 2 * 86_400_000) }),
    );
    await service.resolve({ cookies: { [SESSION_COOKIE]: 'tok' } } as any, reply as any);
    expect(prisma.session.update).toHaveBeenCalled();
    expect(reply.setCookie).toHaveBeenCalled();
  });

  test('no cookie, no lookup', async () => {
    const { prisma, service } = sessions();
    expect(await service.resolve({ cookies: {} } as any)).toBeNull();
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });
});
