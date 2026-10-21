import { afterEach, describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { createMockCacheService, createRoutingSupabase } from '@/test/mocks';
import { EmailDomainService } from './email-domain.service';

const SCHOOL = 'school-1';
const ADMIN = 'admin-1';

const unverified = {
  id: 'dom-1',
  school_id: SCHOOL,
  domain: 'riverside.edu',
  audience: 'staff',
  auto_join: false,
  staff_role: 'teacher',
  verification_token: 'tok',
  verified_at: null,
  created_at: '2026-10-21T00:00:00Z',
};

function build(tables: Record<string, any>, rpc: Record<string, any> = {}) {
  const supabase = createRoutingSupabase({ tables, rpc, userSchoolId: SCHOOL });
  const cache = createMockCacheService();
  const registry = { get: (id: string) => (id === 'google' ? { id } : undefined) };
  const service = new EmailDomainService(supabase as any, cache as any, registry as any);
  return { service, supabase, cache };
}

const originalResolve = dns.resolveTxt;
afterEach(() => {
  (dns as any).resolveTxt = originalResolve;
  delete process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS;
});

describe('EmailDomainService.add', () => {
  test('refuses public mail providers and junk', async () => {
    const { service } = build({});
    await expect(
      service.add(ADMIN, { domain: 'gmail.com', audience: 'student' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.add(ADMIN, { domain: 'not a domain', audience: 'student' }),
    ).rejects.toThrow('Enter a domain');
  });

  test('a domain another school verified is a conflict', async () => {
    const { service } = build({
      'public.school_email_domain': { data: { school_id: 'other-school' }, error: null },
    });
    await expect(
      service.add(ADMIN, { domain: 'riverside.edu', audience: 'staff' }),
    ).rejects.toThrow(ConflictException);
  });

  test('student domains join automatically by default; staff ones ask', async () => {
    const inserted: any[] = [];
    const { service } = build({
      'public.school_email_domain': (call: any) => {
        if (call.op === 'insert') {
          inserted.push(call.payload);
          return { data: { ...unverified, ...call.payload, id: 'new' }, error: null };
        }
        return { data: null, error: null };
      },
    });
    await service.add(ADMIN, { domain: 'students.riverside.edu', audience: 'student' });
    await service.add(ADMIN, { domain: 'riverside.edu', audience: 'staff' });
    expect(inserted[0]).toMatchObject({ domain: 'students.riverside.edu', auto_join: true });
    expect(inserted[1]).toMatchObject({ domain: 'riverside.edu', auto_join: false });
    expect(inserted[0].verification_token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('EmailDomainService.verify', () => {
  test('without the TXT record it stays unverified', async () => {
    (dns as any).resolveTxt = mock(async () => [['v=spf1 -all']]);
    const { service, supabase } = build({
      'public.school_email_domain': { data: unverified, error: null },
    });
    await expect(service.verify(ADMIN, 'dom-1')).rejects.toThrow('TXT record');
    expect(supabase._calls.some((c: any) => c.op === 'update')).toBe(false);
  });

  test('with the record it verifies', async () => {
    (dns as any).resolveTxt = mock(async () => [['gradebook-verification=tok']]);
    const { service } = build({
      'public.school_email_domain': (call: any) =>
        call.op === 'update'
          ? { data: { ...unverified, verified_at: '2026-10-21T01:00:00Z' }, error: null }
          : { data: unverified, error: null },
    });
    const res = await service.verify(ADMIN, 'dom-1');
    expect(res.verified).toBe(true);
  });

  test('the dev bypass is ignored in production', async () => {
    process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS = 'true';
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    (dns as any).resolveTxt = mock(async () => []);
    const { service } = build({
      'public.school_email_domain': { data: unverified, error: null },
    });
    try {
      await expect(service.verify(ADMIN, 'dom-1')).rejects.toThrow('TXT record');
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});

describe('EmailDomainService.matchFor', () => {
  const verifiedStudentDomain = {
    id: 'dom-2',
    domain: 'students.riverside.edu',
    audience: 'student',
    auto_join: true,
    school_id: SCHOOL,
    school: { name: 'Riverside', is_active: true },
  };

  test('a student address matches a student account', async () => {
    const { service } = build({
      'public.user_profile': {
        data: { school_id: null, account_type: 'student', first_name: 'Jo' },
        error: null,
      },
      'public.school_email_domain': { data: verifiedStudentDomain, error: null },
    });
    const match = await service.matchFor('u1', 'jo@students.riverside.edu');
    expect(match).toMatchObject({ schoolName: 'Riverside', audience: 'student' });
  });

  test('looks only for the account type it is, and only verified domains', async () => {
    const { service, supabase } = build({
      'public.user_profile': {
        data: { school_id: null, account_type: 'staff', first_name: 'Jo' },
        error: null,
      },
      'public.school_email_domain': { data: null, error: null },
    });
    expect(await service.matchFor('u1', 'jo@students.riverside.edu')).toBeNull();
    const lookup = supabase._calls.find((c: any) => c.table === 'school_email_domain');
    expect(lookup?.filters).toMatchObject({ domain: 'students.riverside.edu' });
  });

  test('a shared domain lets students in outright and staff by its setting', async () => {
    const shared = {
      ...verifiedStudentDomain,
      domain: 'srmss.edu.gd',
      audience: 'any',
      auto_join: false,
    };
    for (const [accountType, audience, autoJoin] of [
      ['student', 'student', true],
      ['staff', 'staff', false],
    ] as const) {
      const { service } = build({
        'public.user_profile': {
          data: { school_id: null, account_type: accountType, first_name: 'Jo' },
          error: null,
        },
        'public.school_email_domain': { data: shared, error: null },
      });
      const match = await service.matchFor('u1', 'jo@srmss.edu.gd');
      expect(match).toMatchObject({ audience, autoJoin, domain: 'srmss.edu.gd' });
    }
  });

  test('someone already in a school, or not yet onboarded, gets nothing', async () => {
    for (const profile of [
      { school_id: 'x', account_type: 'student', first_name: 'Jo' },
      { school_id: null, account_type: 'student', first_name: null },
    ]) {
      const { service } = build({
        'public.user_profile': { data: profile, error: null },
        'public.school_email_domain': { data: verifiedStudentDomain, error: null },
      });
      expect(await service.matchFor('u1', 'jo@students.riverside.edu')).toBeNull();
    }
  });
});
