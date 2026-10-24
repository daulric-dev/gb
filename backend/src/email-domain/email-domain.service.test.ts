import { afterEach, describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { promises as dns } from 'node:dns';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { TEST_IDP } from '@/test/saml-idp';
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
  created_at: new Date('2026-10-21T00:00:00Z'),
  sso_provider: null,
  sso_required: false,
  azure_tenant_id: null,
  saml_entry_point: null,
  saml_issuer: null,
  saml_certificate: null,
};

function build(setup: (prisma: MockPrisma) => void = () => {}) {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
  setup(prisma);
  const cache = createMockCacheService();
  const registry = {
    get: (id: string) =>
      ['google', 'saml'].includes(id) ? { id, label: id, readyFor: () => true } : undefined,
  };
  const service = new EmailDomainService(prisma as any, cache as any, registry as any);
  return { service, prisma, cache };
}

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

const originalResolve = dns.resolveTxt;
afterEach(() => {
  (dns as any).resolveTxt = originalResolve;
  delete process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS;
});

describe('EmailDomainService.add', () => {
  test('refuses public mail providers and junk', async () => {
    const { service } = build();
    await expect(
      service.add(ADMIN, { domain: 'gmail.com', audience: 'student' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.add(ADMIN, { domain: 'not a domain', audience: 'student' }),
    ).rejects.toThrow('Enter a domain');
  });

  test('a domain another school verified is a conflict', async () => {
    const { service, prisma } = build((p) =>
      p.school_email_domain.findFirst.mockResolvedValue({ school_id: 'other-school' }),
    );
    await expect(
      service.add(ADMIN, { domain: 'riverside.edu', audience: 'staff' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.school_email_domain.findFirst.mock.calls[0][0].where).toEqual({
      domain: 'riverside.edu',
      verified_at: { not: null },
    });
  });

  test('a domain already on the list is a conflict', async () => {
    const { service } = build((p) =>
      p.school_email_domain.create.mockRejectedValue(known('P2002')),
    );
    await expect(
      service.add(ADMIN, { domain: 'riverside.edu', audience: 'staff' }),
    ).rejects.toThrow('This domain is already on your list');
  });

  test('an admin without a school is refused', async () => {
    const { service } = build((p) =>
      p.user_profile.findUnique.mockResolvedValue({ school_id: null }),
    );
    await expect(service.list(ADMIN)).rejects.toThrow('You are not assigned to a school');
  });

  test('list maps rows to the API shape', async () => {
    const { service } = build((p) =>
      p.school_email_domain.findMany.mockResolvedValue([unverified]),
    );
    expect(await service.list(ADMIN)).toEqual([
      {
        id: 'dom-1',
        domain: 'riverside.edu',
        audience: 'staff',
        autoJoin: false,
        staffRole: 'teacher',
        verified: false,
        verifiedAt: null,
        createdAt: '2026-10-21T00:00:00.000Z',
        ssoProvider: null,
        ssoRequired: false,
        azureTenantId: null,
        samlEntryPoint: null,
        samlIssuer: null,
        samlCertificate: null,
        dnsRecord: {
          type: 'TXT',
          name: 'riverside.edu',
          value: 'gradebook-verification=tok',
        },
      },
    ]);
  });

  test('student domains join automatically by default; staff ones ask', async () => {
    const inserted: any[] = [];
    const { service } = build((p) =>
      p.school_email_domain.create.mockImplementation(async ({ data }: any) => {
        inserted.push(data);
        return { ...unverified, ...data, id: 'new' };
      }),
    );
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
    const { service, prisma } = build((p) =>
      p.school_email_domain.findFirst.mockResolvedValue(unverified),
    );
    await expect(service.verify(ADMIN, 'dom-1')).rejects.toThrow('TXT record');
    expect(prisma.school_email_domain.update).not.toHaveBeenCalled();
  });

  test('with the record it verifies', async () => {
    (dns as any).resolveTxt = mock(async () => [['gradebook-verification=tok']]);
    const { service, prisma } = build((p) => {
      p.school_email_domain.findFirst.mockResolvedValue(unverified);
      p.school_email_domain.update.mockResolvedValue({
        ...unverified,
        verified_at: new Date('2026-10-21T01:00:00Z'),
      });
    });
    const res = await service.verify(ADMIN, 'dom-1');
    expect(res.verified).toBe(true);
    expect(res.verifiedAt).toBe('2026-10-21T01:00:00.000Z');
    expect(prisma.school_email_domain.findFirst.mock.calls[0][0].where).toEqual({
      id: 'dom-1',
      school_id: SCHOOL,
    });
  });

  test('a domain another school verified first is a conflict', async () => {
    (dns as any).resolveTxt = mock(async () => [['gradebook-verification=tok']]);
    const { service } = build((p) => {
      p.school_email_domain.findFirst.mockResolvedValue(unverified);
      p.school_email_domain.update.mockRejectedValue(known('P2002'));
    });
    await expect(service.verify(ADMIN, 'dom-1')).rejects.toThrow(
      'Another school has already verified this domain',
    );
  });

  test('another school\'s domain is not found', async () => {
    const { service } = build();
    await expect(service.verify(ADMIN, 'dom-9')).rejects.toThrow('Domain not found');
  });

  test('the dev bypass is ignored in production', async () => {
    process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS = 'true';
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    (dns as any).resolveTxt = mock(async () => []);
    const { service } = build((p) =>
      p.school_email_domain.findFirst.mockResolvedValue(unverified),
    );
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
    const { service } = build((p) => {
      p.user_profile.findUnique.mockResolvedValue({
        school_id: null,
        account_type: 'student',
        first_name: 'Jo',
      });
      p.school_email_domain.findFirst.mockResolvedValue(verifiedStudentDomain);
    });
    const match = await service.matchFor('u1', 'jo@students.riverside.edu');
    expect(match).toMatchObject({ schoolName: 'Riverside', audience: 'student' });
  });

  test('looks only for the account type it is, and only verified domains', async () => {
    const { service, prisma } = build((p) =>
      p.user_profile.findUnique.mockResolvedValue({
        school_id: null,
        account_type: 'staff',
        first_name: 'Jo',
      }),
    );
    expect(await service.matchFor('u1', 'jo@students.riverside.edu')).toBeNull();
    expect(prisma.school_email_domain.findFirst.mock.calls[0][0].where).toEqual({
      domain: 'students.riverside.edu',
      audience: { in: ['staff', 'any'] },
      verified_at: { not: null },
    });
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
      const { service } = build((p) => {
        p.user_profile.findUnique.mockResolvedValue({
          school_id: null,
          account_type: accountType,
          first_name: 'Jo',
        });
        p.school_email_domain.findFirst.mockResolvedValue(shared);
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
      const { service } = build((p) => {
        p.user_profile.findUnique.mockResolvedValue(profile);
        p.school_email_domain.findFirst.mockResolvedValue(verifiedStudentDomain);
      });
      expect(await service.matchFor('u1', 'jo@students.riverside.edu')).toBeNull();
    }
  });
});

describe('EmailDomainService.join', () => {
  const match = {
    domainId: 'dom-2',
    domain: 'riverside.edu',
    schoolId: SCHOOL,
    schoolName: 'Riverside',
    audience: 'staff' as const,
    autoJoin: true,
  };
  const joining = (p: MockPrisma) => {
    p.user_profile.findUnique.mockResolvedValue({
      school_id: null,
      account_type: 'staff',
      first_name: 'Jo',
    });
    p.school_email_domain.findFirst.mockResolvedValue({
      id: match.domainId,
      domain: match.domain,
      audience: 'staff',
      auto_join: true,
      school_id: SCHOOL,
      school: { name: 'Riverside', is_active: true },
    });
    p.school_email_domain.findUnique.mockResolvedValue({ staff_role: 'member' });
  };

  test('seats the user through the SQL function and clears caches', async () => {
    const { service, prisma, cache } = build(joining);
    await cache.set('profile:u1', { stale: true }, 60);
    const res = await service.join('u1', 'jo@riverside.edu');
    expect(res).toEqual({ status: 'joined', schoolId: SCHOOL, audience: 'staff' });
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain('public.join_school_by_email_domain(');
    expect(values).toEqual(['u1', SCHOOL, 'staff', 'member']);
    expect(cache._store.has('profile:u1')).toBe(false);
  });

  test('already in a school is a conflict', async () => {
    const { service, prisma } = build(joining);
    prisma.$queryRaw.mockRejectedValue(
      new Error('ERROR: already_in_a_school'),
    );
    await expect(service.join('u1', 'jo@riverside.edu')).rejects.toThrow(
      'This account already belongs to a school',
    );
  });

  test('staff on an approval domain file a request; a pending one is fine', async () => {
    const { service, prisma } = build((p) => {
      joining(p);
      p.school_email_domain.findFirst.mockResolvedValue({
        id: match.domainId,
        domain: match.domain,
        audience: 'staff',
        auto_join: false,
        school_id: SCHOOL,
        school: { name: 'Riverside', is_active: true },
      });
      p.school_join_request.create.mockRejectedValue(known('P2002'));
    });
    expect(await service.join('u1', 'jo@riverside.edu')).toEqual({
      status: 'requested',
      schoolId: SCHOOL,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('EmailDomainService.update (SAML)', () => {
  const verified = { ...unverified, verified_at: new Date('2026-10-21T00:00:00Z') };
  const saml = {
    samlEntryPoint: 'https://idp.riverside.edu/sso',
    samlIssuer: 'https://idp.riverside.edu/entity',
    samlCertificate: TEST_IDP.cert,
  };

  function withRow(row: any) {
    return build((prisma) => {
      prisma.school_email_domain.findFirst.mockResolvedValue(row);
      prisma.school_email_domain.update.mockImplementation(async ({ data }: any) => ({
        ...row,
        ...data,
      }));
    });
  }

  test('choosing SAML with the full connection in one patch works', async () => {
    const { service, prisma } = withRow(verified);
    const out = await service.update(ADMIN, 'dom-1', { ssoProvider: 'saml', ...saml });
    const data = prisma.school_email_domain.update.mock.calls[0][0].data;
    expect(data.sso_provider).toBe('saml');
    expect(data.saml_entry_point).toBe('https://idp.riverside.edu/sso');
    expect(data.saml_certificate).toContain('-----BEGIN CERTIFICATE-----');
    expect(out).toMatchObject({
      ssoProvider: 'saml',
      samlEntryPoint: 'https://idp.riverside.edu/sso',
      samlIssuer: 'https://idp.riverside.edu/entity',
    });
  });

  test('a bare base64 certificate is stored as PEM', async () => {
    const { service, prisma } = withRow(verified);
    const bare = TEST_IDP.cert.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    await service.update(ADMIN, 'dom-1', { ssoProvider: 'saml', ...saml, samlCertificate: bare });
    const data = prisma.school_email_domain.update.mock.calls[0][0].data;
    expect(data.saml_certificate.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
  });

  test('SAML without the whole connection is refused', async () => {
    const { service } = withRow(verified);
    await expect(service.update(ADMIN, 'dom-1', { ssoProvider: 'saml' })).rejects.toThrow(
      'sign-on URL, entity ID and signing certificate',
    );
    await expect(
      service.update(ADMIN, 'dom-1', { ssoProvider: 'saml', ...saml, samlIssuer: '  ' }),
    ).rejects.toThrow(BadRequestException);
  });

  test('the sign-on URL must be https and the certificate X.509', async () => {
    const { service } = withRow(verified);
    await expect(
      service.update(ADMIN, 'dom-1', { ...saml, samlEntryPoint: 'http://idp.riverside.edu/sso' }),
    ).rejects.toThrow('https://');
    await expect(
      service.update(ADMIN, 'dom-1', { ...saml, samlEntryPoint: 'not a url' }),
    ).rejects.toThrow('https://');
    await expect(
      service.update(ADMIN, 'dom-1', { ...saml, samlCertificate: 'MIIBnotreally' }),
    ).rejects.toThrow('X.509');
    await expect(
      service.update(ADMIN, 'dom-1', { ...saml, samlCertificate: TEST_IDP.key }),
    ).rejects.toThrow('X.509');
  });

  test('clearing part of a live SAML connection is refused', async () => {
    const live = {
      ...verified,
      sso_provider: 'saml',
      saml_entry_point: saml.samlEntryPoint,
      saml_issuer: saml.samlIssuer,
      saml_certificate: TEST_IDP.cert,
    };
    const { service } = withRow(live);
    await expect(service.update(ADMIN, 'dom-1', { samlCertificate: null })).rejects.toThrow(
      BadRequestException,
    );
    // Switching SSO off and clearing it together is fine.
    await service.update(ADMIN, 'dom-1', {
      ssoProvider: null,
      samlEntryPoint: null,
      samlIssuer: null,
      samlCertificate: null,
    });
  });

  test('requiring SAML needs a verified domain and the connection', async () => {
    const unverifiedRow = withRow(unverified);
    await expect(
      unverifiedRow.service.update(ADMIN, 'dom-1', { ssoProvider: 'saml', ...saml, ssoRequired: true }),
    ).rejects.toThrow('Verify the domain');

    const { service, prisma } = withRow(verified);
    await service.update(ADMIN, 'dom-1', { ssoProvider: 'saml', ...saml, ssoRequired: true });
    expect(prisma.school_email_domain.update.mock.calls[0][0].data.sso_required).toBe(true);
  });
});
