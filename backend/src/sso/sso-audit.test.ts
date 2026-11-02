import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { TEST_IDP, OTHER_IDP } from '@/test/saml-idp';
import { AdminGuard } from '@/auth/admin.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { EmailDomainService } from '@/email-domain/email-domain.service';
import { SchoolController } from '@/school/school.controller';
import { SignInController } from '@/organisation/sign-in.controller';
import { SsoSettingsService } from './sso-settings.service';
import { SsoRegistry } from './sso.registry';
import { SchoolSsoService } from './school-sso.service';
import {
  AUDIT_MAX_LIMIT,
  certificateFingerprint,
  SsoAuditService,
  type SsoAuditEntry,
} from './sso-audit.service';
import { isAlerting, SsoAlertService } from './sso-alert.service';
import { ssoChangedEmail } from './sso-alert.email';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ADMIN = { id: 'admin-1', via: 'school_admin' as const };
const ORG = { id: 'org-1', via: 'organisation_admin' as const };

const savedEnv = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
  process.env.API_URL = 'https://api.gb.test';
  process.env.FRONTEND_URL = 'https://gb.test,https://other.gb.test';
  process.env.SSO_PROVIDERS = 'google';
  process.env.GOOGLE_CLIENT_ID = 'env-google-id';
  process.env.GOOGLE_CLIENT_SECRET = 'env-google-secret';
  delete process.env.ORG_ADMIN_EMAILS;
});

const domainRow = {
  id: 'dom-1',
  school_id: SCHOOL,
  domain: 'riverside.edu',
  audience: 'staff',
  auto_join: false,
  staff_role: 'teacher',
  verification_token: 'tok',
  verified_at: new Date('2026-10-21T00:00:00Z'),
  created_at: new Date('2026-10-21T00:00:00Z'),
  sso_provider: null,
  sso_required: false,
  azure_tenant_id: null,
  saml_entry_point: null,
  saml_issuer: null,
  saml_certificate: null,
};

/**
 * EmailDomainService whose `$transaction` hands out a separate client, so a
 * test can tell what ran inside the transaction from what ran outside it.
 */
function domains(row: Record<string, unknown> = domainRow) {
  const prisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  prisma.school_email_domain.findFirst.mockResolvedValue(row);
  tx.school_email_domain.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
  tx.school_email_domain.create.mockImplementation(async ({ data }: any) => ({ ...domainRow, ...data, id: 'dom-new' }));
  const registry = {
    resolve: mock(async (id: string) => (id === 'saml' || id === 'google' ? { adapter: { id } } : undefined)),
  };
  const alerts = { notify: mock(async () => {}) };
  const service = new EmailDomainService(
    prisma as any,
    createMockCacheService() as any,
    registry as any,
    new SsoAuditService(prisma as any),
    alerts as any,
  );
  const logged = () => tx.sso_audit_log.createMany.mock.calls.flatMap((c: any[]) => c[0].data);
  return { service, prisma, tx, alerts, logged };
}

const saml = {
  ssoProvider: 'saml',
  samlEntryPoint: 'https://idp.riverside.edu/sso',
  samlIssuer: 'https://idp.riverside.edu/entity',
  samlCertificate: TEST_IDP.cert,
};

describe('audit entries for email domain changes', () => {
  test('a SAML change logs before/after with certificate fingerprints, never the certificate', async () => {
    const before = {
      ...domainRow,
      sso_provider: 'saml',
      saml_entry_point: 'https://old.idp/sso',
      saml_issuer: 'old-issuer',
      saml_certificate: OTHER_IDP.cert,
    };
    const { service, logged, prisma } = domains(before);
    await service.updateInSchool(SCHOOL, 'dom-1', saml, ADMIN);

    const entries = logged();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      school_id: SCHOOL,
      domain_id: 'dom-1',
      domain: 'riverside.edu',
      actor_id: 'admin-1',
      actor_via: 'school_admin',
      action: 'saml_changed',
    });
    const fp = new X509Certificate(TEST_IDP.cert).fingerprint256;
    expect(entries[0].changes).toEqual({
      samlEntryPoint: { before: 'https://old.idp/sso', after: 'https://idp.riverside.edu/sso' },
      samlIssuer: { before: 'old-issuer', after: 'https://idp.riverside.edu/entity' },
      samlCertificate: { before: new X509Certificate(OTHER_IDP.cert).fingerprint256, after: fp },
    });
    const json = JSON.stringify(entries);
    expect(json).not.toContain('BEGIN CERTIFICATE');
    expect(json).not.toContain(TEST_IDP.cert.split('\n')[1]);
    // Only through the transaction client.
    expect(prisma.sso_audit_log.createMany).not.toHaveBeenCalled();
  });

  test('one entry per group that changed: provider, require SSO, tenant, domain settings', async () => {
    const { service, logged } = domains({ ...domainRow, sso_provider: 'google', sso_required: true });
    await service.updateInSchool(SCHOOL, 'dom-1', { ssoProvider: null, autoJoin: true }, ORG);
    const byAction = Object.fromEntries(logged().map((e: any) => [e.action, e]));
    expect(Object.keys(byAction).sort()).toEqual(
      ['domain_settings_changed', 'provider_changed', 'sso_required_changed'].sort(),
    );
    expect(byAction.provider_changed.changes).toEqual({ ssoProvider: { before: 'google', after: null } });
    expect(byAction.sso_required_changed.changes).toEqual({ ssoRequired: { before: true, after: false } });
    expect(byAction.domain_settings_changed.changes).toEqual({ autoJoin: { before: false, after: true } });
    expect(byAction.provider_changed.actor_via).toBe('organisation_admin');
  });

  test('a save that changes nothing logs nothing and alerts nobody', async () => {
    const { service, logged, alerts } = domains({ ...domainRow, auto_join: true });
    await service.updateInSchool(SCHOOL, 'dom-1', { autoJoin: true }, ADMIN);
    expect(logged()).toHaveLength(0);
    expect(alerts.notify).not.toHaveBeenCalled();
  });

  test('add, verify and remove are logged; remove keeps what the domain was set to', async () => {
    const { service, logged, tx, prisma } = domains({
      ...domainRow,
      verified_at: null,
      sso_provider: 'saml',
      saml_certificate: TEST_IDP.cert,
    });
    process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS = 'true';
    await service.addToSchool(SCHOOL, ADMIN, { domain: 'new.riverside.edu', audience: 'student' });
    await service.verifyInSchool(SCHOOL, 'dom-1', ADMIN);
    await service.removeFromSchool(SCHOOL, 'dom-1', ORG);
    delete process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS;

    const [added, verified, removed] = logged();
    expect(added).toMatchObject({ action: 'domain_added', domain_id: 'dom-new', domain: 'new.riverside.edu' });
    expect(added.changes.audience).toEqual({ before: null, after: 'student' });
    expect(verified).toMatchObject({ action: 'domain_verified', changes: { verified: { before: false, after: true } } });
    expect(removed).toMatchObject({ action: 'domain_removed', domain_id: 'dom-1', domain: 'riverside.edu', actor_via: 'organisation_admin' });
    expect(removed.changes.samlCertificate).toEqual({
      before: new X509Certificate(TEST_IDP.cert).fingerprint256,
      after: null,
    });
    expect(tx.school_email_domain.deleteMany).toHaveBeenCalled();
    expect(prisma.school_email_domain.deleteMany).not.toHaveBeenCalled();
  });

  test('if the log cannot be written the change fails with it (same transaction) and nobody is mailed', async () => {
    const { service, tx, alerts } = domains();
    tx.sso_audit_log.createMany.mockRejectedValue(new Error('log insert failed'));
    await expect(service.updateInSchool(SCHOOL, 'dom-1', saml, ADMIN)).rejects.toThrow(BadRequestException);
    expect(alerts.notify).not.toHaveBeenCalled();
  });

  test('one alert call per request with every entry, after the commit', async () => {
    const { service, alerts } = domains({ ...domainRow, sso_provider: 'google', sso_required: true });
    await service.updateInSchool(SCHOOL, 'dom-1', { ...saml, ssoRequired: false, azureTenantId: null }, ADMIN);
    expect(alerts.notify).toHaveBeenCalledTimes(1);
    const [school, actor, entries] = alerts.notify.mock.calls[0] as any[];
    expect(school).toBe(SCHOOL);
    expect(actor).toEqual(ADMIN);
    expect(entries.map((e: SsoAuditEntry) => e.action).sort()).toEqual(
      ['provider_changed', 'saml_changed', 'sso_required_changed'].sort(),
    );
  });

  test('a failing alert does not fail the request', async () => {
    const { service, alerts } = domains();
    alerts.notify.mockImplementation(async () => {
      throw new Error('smtp down');
    });
    // notify is fired and forgotten; its own errors are caught inside it.
    const result = service.updateInSchool(SCHOOL, 'dom-1', saml, ADMIN);
    await expect(result).resolves.toMatchObject({ ssoProvider: 'saml' });
  });
});

/** SchoolSsoService over in-memory rows, with a separate transaction client. */
function apps() {
  const rows: any[] = [];
  const prisma = createMockPrisma();
  const match = (r: any, w: any) =>
    r.school_id === w.school_id_provider.school_id && r.provider === w.school_id_provider.provider;
  prisma.school_sso_provider.findMany.mockImplementation(async ({ where }: any) =>
    rows.filter((r) => r.school_id === where.school_id).map((r) => ({ ...r })),
  );
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  tx.school_sso_provider.findUnique.mockImplementation(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null);
  tx.school_sso_provider.update.mockImplementation(async ({ where, data }: any) => {
    const i = rows.findIndex((r) => match(r, where));
    rows[i] = { ...rows[i], ...data };
    return rows[i];
  });
  tx.school_sso_provider.createMany.mockImplementation(async ({ data }: any) => {
    rows.push(...data.map((r: any) => ({ updated_at: new Date(), settings: {}, ...r })));
    return { count: data.length };
  });
  const settings = new SsoSettingsService(prisma as any);
  const alerts = { notify: mock(async () => {}) };
  const service = new SchoolSsoService(
    new SsoRegistry(settings),
    settings,
    new SsoAuditService(prisma as any),
    alerts as any,
  );
  const logged = () => tx.sso_audit_log.createMany.mock.calls.flatMap((c: any[]) => c[0].data);
  return { service, rows, logged, alerts, prisma };
}

describe('audit entries for sign-in apps', () => {
  test('client ID, on/off and the secret - only as set/cleared', async () => {
    const { service, logged, alerts, prisma } = apps();
    await service.update(SCHOOL, 'google', { enabled: true, clientId: 'g-id', clientSecret: 'super-secret-value' }, ADMIN);
    const first = logged();
    expect(first.map((e: any) => e.action).sort()).toEqual(['app_changed', 'app_enabled', 'app_secret_changed'].sort());
    const by = Object.fromEntries(first.map((e: any) => [e.action, e.changes]));
    expect(by.app_enabled).toEqual({ app: 'google', enabled: { before: null, after: true } });
    expect(by.app_changed).toEqual({ app: 'google', clientId: { before: null, after: 'g-id' } });
    expect(by.app_secret_changed).toEqual({ app: 'google', clientSecret: { before: null, after: 'set' } });
    expect(alerts.notify).toHaveBeenCalledTimes(1);
    expect(prisma.sso_audit_log.createMany).not.toHaveBeenCalled();

    // Replacing the secret, then turning the app off.
    await service.update(SCHOOL, 'google', { clientSecret: 'another-secret' }, ORG);
    await service.update(SCHOOL, 'google', { enabled: false, clientSecret: '' }, ORG);
    const later = logged().slice(first.length);
    expect(later.map((e: any) => e.action)).toEqual(['app_secret_changed', 'app_disabled', 'app_secret_changed']);
    expect(later[0].changes.clientSecret).toEqual({ before: 'set', after: 'set' });
    expect(later[2].changes.clientSecret).toEqual({ before: 'set', after: 'cleared' });
    expect(later[0].actor_via).toBe('organisation_admin');

    const json = JSON.stringify(logged());
    expect(json).not.toContain('super-secret-value');
    expect(json).not.toContain('another-secret');
    expect(json).not.toContain('v1:');
  });
});

describe('reading the audit log', () => {
  function reader(rows: any[]) {
    const prisma: MockPrisma = createMockPrisma();
    const sorted = [...rows].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1),
    );
    prisma.sso_audit_log.findMany.mockImplementation(async ({ where, take }: any) => {
      let out = sorted.filter((r) => r.school_id === where.school_id);
      if (where.OR) {
        const [lt, eq] = where.OR;
        out = out.filter(
          (r) =>
            r.created_at < lt.created_at.lt ||
            (r.created_at.getTime() === eq.created_at.getTime() && r.id < eq.id.lt),
        );
      }
      return out.slice(0, take);
    });
    prisma.sso_audit_log.findFirst.mockImplementation(async ({ where }: any) =>
      rows.find((r) => r.id === where.id && r.school_id === where.school_id) ?? null,
    );
    prisma.user_profile.findMany.mockResolvedValue([
      { id: 'admin-1', first_name: 'Ada', last_name: 'Lovelace', email: null, app_user: { email: 'ada@riverside.edu' } },
    ]);
    return { audit: new SsoAuditService(prisma as any), prisma };
  }
  const at = (i: number) => new Date(Date.UTC(2026, 10, 1, 0, i));
  const entry = (i: number, over: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    school_id: SCHOOL,
    domain_id: 'dom-1',
    domain: 'riverside.edu',
    actor_id: 'admin-1',
    actor_via: 'school_admin',
    action: 'saml_changed',
    changes: { samlIssuer: { before: 'a', after: 'b' } },
    created_at: at(i),
    ...over,
  });

  test('newest first, with the actor, in the documented shape', async () => {
    const { audit } = reader([entry(1), entry(2, { actor_id: null }), entry(3, { school_id: OTHER })]);
    const items = await audit.list(SCHOOL);
    expect(items.map((i) => i.createdAt)).toEqual([at(2).toISOString(), at(1).toISOString()]);
    expect(items[0].actor).toBeNull();
    expect(items[1]).toEqual({
      id: entry(1).id,
      createdAt: at(1).toISOString(),
      action: 'saml_changed',
      domain: 'riverside.edu',
      actor: { id: 'admin-1', name: 'Ada Lovelace', email: 'ada@riverside.edu' },
      actorVia: 'school_admin',
      changes: { samlIssuer: { before: 'a', after: 'b' } },
    });
  });

  test('pages with limit and before; default 50, at most 200', async () => {
    const rows = Array.from({ length: 260 }, (_, i) => entry(i));
    const { audit, prisma } = reader(rows);
    expect(await audit.list(SCHOOL)).toHaveLength(50);
    expect(await audit.list(SCHOOL, { limit: '1000' })).toHaveLength(AUDIT_MAX_LIMIT);
    const first = await audit.list(SCHOOL, { limit: '3' });
    const next = await audit.list(SCHOOL, { limit: '3', before: first[2].id });
    expect(next.map((i) => i.id)).toEqual([entry(256).id, entry(255).id, entry(254).id]);
    expect(prisma.sso_audit_log.findMany.mock.calls.at(-1)![0].orderBy).toEqual([
      { created_at: 'desc' },
      { id: 'desc' },
    ]);
    await expect(audit.list(SCHOOL, { limit: '0' })).rejects.toThrow(BadRequestException);
    await expect(audit.list(SCHOOL, { before: 'nope' })).rejects.toThrow('Invalid cursor');
    // Another school's entry is not a cursor here.
    await expect(audit.list(OTHER, { before: first[0].id })).rejects.toThrow('Invalid cursor');
  });

  test("school admins read only their active school's log, behind AdminGuard and school:update", async () => {
    const proto = SchoolController.prototype as any;
    expect(Reflect.getMetadata(PERMISSION_KEY, proto.getSsoAudit)).toBe('school:update');
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.getSsoAudit)).toContain(AdminGuard);
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: OTHER });
    const audit = { list: mock(async () => []) };
    const c = new SchoolController({} as any, {} as any, {} as any, prisma as any, {} as any, {} as any, {} as any, audit as any);
    await c.getSsoAudit({ user: { id: 'admin-2' } }, { limit: 10 });
    expect(audit.list.mock.calls[0]).toEqual([OTHER, { limit: 10, before: undefined }] as any);
  });

  test('organisation admins read any school by id; an unknown school is a 404', async () => {
    const audit = { list: mock(async () => []) };
    const requireSchool = mock(async (id: string) => {
      if (id !== SCHOOL && id !== OTHER) throw new NotFoundException('School not found');
    });
    const c = new SignInController({} as any, {} as any, { requireSchool } as any, audit as any);
    await c.schoolSsoAudit(SCHOOL, {});
    await c.schoolSsoAudit(OTHER, { limit: 5 });
    expect(audit.list.mock.calls.map((call: any[]) => call[0])).toEqual([SCHOOL, OTHER]);
    await expect(c.schoolSsoAudit('44444444-4444-4444-8444-444444444444', {})).rejects.toThrow(NotFoundException);
    expect(audit.list).toHaveBeenCalledTimes(2);
  });
});

describe('certificateFingerprint', () => {
  test('is the SHA-256 fingerprint identity providers show', () => {
    expect(certificateFingerprint(TEST_IDP.cert)).toBe(new X509Certificate(TEST_IDP.cert).fingerprint256);
    expect(certificateFingerprint(null)).toBeNull();
    expect(certificateFingerprint('junk')).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

describe('SSO change alerts', () => {
  function alerter(opts: { configured?: boolean; fail?: boolean } = {}) {
    const prisma = createMockPrisma();
    prisma.school.findUnique.mockResolvedValue({ name: 'Riverside <High>' });
    prisma.school_management.findMany.mockResolvedValue([
      { user_profile: { app_user: { email: 'Head@Riverside.edu', disabled_at: null } } },
    ]);
    prisma.organisation_admin.findMany.mockResolvedValue([
      { user_profile: { app_user: { email: 'ops@org.test', disabled_at: null } } },
      { user_profile: { app_user: { email: 'gone@org.test', disabled_at: new Date() } } },
      // Also the school's admin: one email.
      { user_profile: { app_user: { email: 'head@riverside.edu', disabled_at: null } } },
    ]);
    prisma.app_user.findMany.mockImplementation(async ({ where }: any) =>
      [{ email: 'env@org.test' }].filter((u) => where.email.in.includes(u.email)),
    );
    prisma.user_profile.findUnique.mockResolvedValue({
      first_name: 'Ada',
      last_name: 'Lovelace',
      app_user: { email: 'ada@riverside.edu' },
    });
    const sent: any[] = [];
    const mail = {
      configured: () => opts.configured ?? true,
      send: mock(async (m: any) => {
        if (opts.fail) throw new Error('smtp down');
        sent.push(m);
      }),
    };
    return { service: new SsoAlertService(prisma as any, mail as any), sent, mail, prisma };
  }
  const samlEntry: SsoAuditEntry = {
    action: 'saml_changed',
    domainId: 'dom-1',
    domain: 'riverside.edu',
    changes: {
      samlCertificate: { before: 'AA:BB', after: 'CC:DD' },
      samlEntryPoint: { before: null, after: 'https://idp.riverside.edu/sso' },
    },
  };
  const secretEntry: SsoAuditEntry = {
    action: 'app_secret_changed',
    changes: { app: 'google', clientSecret: { before: 'set', after: 'set' } },
  };

  test('which changes alert', () => {
    expect(isAlerting(samlEntry)).toBe(true);
    expect(isAlerting(secretEntry)).toBe(true);
    expect(isAlerting({ action: 'provider_changed', changes: {} })).toBe(true);
    expect(isAlerting({ action: 'app_enabled', changes: {} })).toBe(true);
    expect(isAlerting({ action: 'sso_required_changed', changes: { ssoRequired: { before: true, after: false } } })).toBe(true);
    expect(isAlerting({ action: 'sso_required_changed', changes: { ssoRequired: { before: false, after: true } } })).toBe(false);
    expect(isAlerting({ action: 'domain_added', changes: {} })).toBe(false);
    expect(isAlerting({ action: 'domain_settings_changed', changes: {} })).toBe(false);
  });

  test("the school's admin and every organisation admin (stored and verified ORG_ADMIN_EMAILS), once each", async () => {
    process.env.ORG_ADMIN_EMAILS = 'env@org.test, missing@org.test';
    const { service, prisma } = alerter();
    const r = await service.recipients(SCHOOL);
    expect(r.map((x) => x.email).sort()).toEqual(['env@org.test', 'head@riverside.edu', 'ops@org.test']);
    expect(r.find((x) => x.email === 'head@riverside.edu')!.orgAdmin).toBe(true);
    expect(prisma.school_management.findMany.mock.calls[0][0].where).toEqual({ school_id: SCHOOL, role: 'admin' });
    expect(prisma.app_user.findMany.mock.calls[0][0].where).toMatchObject({
      email_verified_at: { not: null },
      disabled_at: null,
    });
  });

  test('one email per recipient per request, covering every change, with links and no secrets', async () => {
    const { service, sent, prisma } = alerter();
    prisma.organisation_admin.findMany.mockResolvedValue([
      { user_profile: { app_user: { email: 'ops@org.test', disabled_at: null } } },
    ]);
    await service.notify(SCHOOL, ADMIN, [samlEntry, secretEntry, { action: 'domain_added', changes: {} }]);
    expect(sent).toHaveLength(2);
    const ops = sent.find((m) => m.to === 'ops@org.test');
    expect(ops.subject).toBe('Single sign-on settings changed for Riverside <High>');
    expect(ops.text).toContain('Ada Lovelace (ada@riverside.edu)');
    expect(ops.text).toContain('CC:DD');
    expect(ops.text).toContain('Client secret: set → set');
    expect(ops.text).not.toContain('domain added');
    expect(ops.text).toContain(`https://gb.test/organisation/schools/${SCHOOL}#single-sign-on`);
    expect(ops.html).toContain('Riverside &lt;High&gt;');
    expect(ops.html).not.toContain('<High>');
    const head = sent.find((m) => m.to === 'head@riverside.edu');
    expect(head.text).toContain('https://gb.test/dashboard/settings#single-sign-on');
  });

  test('nothing alerting: no mail at all', async () => {
    const { service, mail } = alerter();
    await service.notify(SCHOOL, ADMIN, [{ action: 'domain_verified', changes: {} }]);
    expect(mail.send).not.toHaveBeenCalled();
  });

  test('skipped without SMTP, and a failed send never throws', async () => {
    const off = alerter({ configured: false });
    await off.service.notify(SCHOOL, ADMIN, [samlEntry]);
    expect(off.mail.send).not.toHaveBeenCalled();
    expect(off.prisma.school.findUnique).not.toHaveBeenCalled();

    const failing = alerter({ fail: true });
    await expect(failing.service.notify(SCHOOL, ADMIN, [samlEntry])).resolves.toBeUndefined();
    expect(failing.mail.send).toHaveBeenCalledTimes(2);
  });

  test('the email escapes what admins typed', () => {
    const { html } = ssoChangedEmail({
      school: 'S',
      actor: '<script>x</script>',
      via: 'school_admin',
      at: new Date('2026-11-02T10:00:00Z'),
      entries: [{ action: 'saml_changed', domain: 'a.edu', changes: { samlIssuer: { before: null, after: '"><img>' } } }],
      settingsUrl: 'https://gb.test/dashboard/settings',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><img>');
    expect(html).toContain('&lt;script&gt;');
  });
});
