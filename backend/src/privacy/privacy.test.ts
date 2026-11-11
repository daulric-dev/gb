import { describe, expect, mock, test } from 'bun:test';
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { AuthGuard } from '@/auth/auth.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import type { FeatureService } from '@/features/feature.service';
import { LAWFUL_BASES, PURPOSES, lawfulBasesFor, retentionTable } from './privacy.catalog';
import {
  buildRecipients,
  hostOf,
  isInternalHost,
  providerName,
  smtpHost,
  type RecipientSources,
} from './privacy.recipients';
import { PrivacyService, buildNotice, missingFields, settingsView } from './privacy.service';
import { OrganisationPrivacyController, PrivacyNoticeController } from './privacy.controller';
import { UpdatePrivacySettingsDto } from './privacy.dto';

const ADMIN = '11111111-1111-4111-8111-111111111111';

function sources(over: Partial<RecipientSources> = {}): RecipientSources {
  return {
    env: {},
    features: {},
    aiProviders: [],
    translation: null,
    webhookUrls: [],
    ltiTools: [],
    rosterSources: [],
    schoolSsoProviders: [],
    samlEntryPoints: [],
    additional: [],
    ...over,
  };
}

describe('host helpers', () => {
  test('hostOf reads URLs and bare hosts', () => {
    expect(hostOf('https://API.Example.com/v1')).toBe('api.example.com');
    expect(hostOf('smtps://u:p@smtp.example.com:465')).toBe('smtp.example.com');
    expect(hostOf('smtp.example.com')).toBe('smtp.example.com');
    expect(hostOf('')).toBeNull();
    expect(hostOf(null)).toBeNull();
  });

  test('isInternalHost spots private networks', () => {
    for (const h of ['localhost', '10.1.2.3', '192.168.0.4', '172.20.0.1', '127.0.0.1', 'libre', 'tools.internal', 'nas.local', '[::1]', 'fd00::1']) {
      expect(isInternalHost(h)).toBe(true);
    }
    for (const h of ['api.deepl.com', '8.8.8.8', '172.32.0.1', 'example.org']) {
      expect(isInternalHost(h)).toBe(false);
    }
  });

  test('providerName knows common providers', () => {
    expect(providerName('smtp.gmail.com')).toContain('Google');
    expect(providerName('email-smtp.eu-west-1.amazonaws.com')).toContain('Amazon SES');
    expect(providerName('abc.r2.cloudflarestorage.com')).toContain('Cloudflare');
    expect(providerName('s3.eu-central-1.amazonaws.com')).toBe('Amazon Web Services');
    expect(providerName('unknown.example')).toBeNull();
  });

  test('smtpHost: URL, host, then preset', () => {
    expect(smtpHost({ SMTP_URL: 'smtp://u:p@mail.example.com:587', SMTP_HOST: 'other' })).toBe('mail.example.com');
    expect(smtpHost({ SMTP_HOST: 'relay.example.com' })).toBe('relay.example.com');
    expect(smtpHost({ SMTP_SERVICE: 'gmail' })).toBe('smtp.gmail.com');
    expect(smtpHost({})).toBeNull();
  });
});

describe('buildRecipients', () => {
  test('nothing configured: nothing listed', () => {
    expect(buildRecipients(sources())).toEqual([]);
  });

  test('email, storage and backups from the environment, with regions', () => {
    const list = buildRecipients(
      sources({
        env: {
          SMTP_SERVICE: 'office365',
          S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
          S3_REGION: 'auto',
          BACKUP_S3_BUCKET: 'gb-backups',
          BACKUP_S3_REGION: 'eu-central-1',
        },
      }),
    );
    const email = list.find((r) => r.category === 'email')!;
    expect(email).toMatchObject({ host: 'smtp.office365.com', name: 'Microsoft (Exchange Online)', internal: false });
    const storage = list.find((r) => r.category === 'storage')!;
    expect(storage).toMatchObject({ host: 'acc.r2.cloudflarestorage.com', name: 'Cloudflare (R2)', location: null });
    const backup = list.find((r) => r.category === 'backup')!;
    expect(backup).toMatchObject({ host: 's3.eu-central-1.amazonaws.com', location: 'eu-central-1' });
  });

  test('push only while the organisation has push notifications on', () => {
    expect(buildRecipients(sources({ features: { push_notifications: false } }))).toEqual([]);
    const push = buildRecipients(sources({ features: { push_notifications: true } }));
    expect(push.map((r) => r.name)).toEqual([
      'Expo',
      'Apple (Push Notification service, iPhone)',
      'Google (Firebase Cloud Messaging, Android)',
    ]);
    expect(push[0].host).toBe('exp.host');
  });

  test('AI providers and the translation engine only while their feature is on', () => {
    const base = {
      aiProviders: [
        { name: 'Claude', kind: 'anthropic', baseUrl: null },
        { name: 'Local', kind: 'openai_compatible', baseUrl: 'http://10.0.0.9:11434/v1' },
      ],
      translation: { engine: 'deepl', url: null, enabled: true },
    };
    expect(buildRecipients(sources(base))).toEqual([]);
    const list = buildRecipients(sources({ ...base, features: { ai_assistance: true, translation: true } }));
    const ai = list.filter((r) => r.category === 'ai');
    expect(ai[0]).toMatchObject({ name: 'Anthropic', host: 'api.anthropic.com', internal: false });
    // Internal hosts are not published.
    expect(ai[1]).toMatchObject({ host: null, internal: true, name: "The organisation's own server" });
    const tr = list.find((r) => r.category === 'translation')!;
    expect(tr).toMatchObject({ name: 'DeepL', host: 'api.deepl.com' });
    expect(tr.purpose).toContain('never names, grades');
  });

  test('a switched-off translation engine is not a recipient', () => {
    const list = buildRecipients(
      sources({ features: { translation: true }, translation: { engine: 'google', url: null, enabled: false } }),
    );
    expect(list).toEqual([]);
  });

  test('LibreTranslate is listed at its own address', () => {
    const list = buildRecipients(
      sources({
        features: { translation: true },
        translation: { engine: 'libre', url: 'https://translate.school.example/', enabled: true },
      }),
    );
    expect(list[0]).toMatchObject({ host: 'translate.school.example', name: 'translate.school.example' });
  });

  test('webhooks, LTI tools and rostering, deduplicated, behind their features', () => {
    const src = sources({
      webhookUrls: ['https://hooks.example.com/a', 'https://hooks.example.com/b', 'http://192.168.1.5/hook', 'http://intranet/hook'],
      ltiTools: [
        { name: 'Quiz Tool', loginUrl: 'https://tool.example.org/login', targetLinkUri: 'https://tool.example.org/launch', sendName: true, sendEmail: false },
      ],
      rosterSources: [
        { name: 'SIS', kind: 'oneroster_api', baseUrl: 'https://sis.example.net/ims/oneroster' },
        { name: 'Upload', kind: 'csv', baseUrl: null },
      ],
    });
    expect(buildRecipients(src)).toEqual([]);
    const list = buildRecipients({ ...src, features: { integrations: true, lti: true, rostering: true } });
    const hooks = list.filter((r) => r.category === 'webhook');
    expect(hooks).toHaveLength(2); // one public host, one internal entry
    expect(hooks[0].host).toBe('hooks.example.com');
    expect(hooks[1]).toMatchObject({ host: null, internal: true });
    const lti = list.find((r) => r.category === 'lti')!;
    expect(lti.host).toBe('tool.example.org');
    expect(lti.purpose).toContain('name');
    expect(lti.purpose).not.toContain('email');
    const roster = list.filter((r) => r.category === 'rostering');
    expect(roster).toHaveLength(1);
    expect(roster[0].host).toBe('sis.example.net');
  });

  test('single sign-on: env providers, school apps, OIDC issuers and SAML', () => {
    const list = buildRecipients(
      sources({
        env: { SSO_PROVIDERS: 'google, azure' },
        schoolSsoProviders: [
          { provider: 'google', issuer: null },
          { provider: 'oidc', issuer: 'https://idp.school.example/realms/main' },
        ],
        samlEntryPoints: ['https://adfs.school.example/adfs/ls'],
      }),
    );
    expect(list.map((r) => r.host)).toEqual([
      'accounts.google.com',
      'login.microsoftonline.com',
      'idp.school.example',
      'adfs.school.example',
    ]);
  });

  test('additional recipients entered by the organisation are listed as given', () => {
    const list = buildRecipients(
      sources({ additional: [{ name: 'Hetzner Online GmbH', purpose: 'Server hosting', location: 'Germany' }] }),
    );
    expect(list).toEqual([
      { category: 'hosting', name: 'Hetzner Online GmbH', host: null, internal: false, purpose: 'Server hosting', location: 'Germany' },
    ]);
  });
});

describe('catalog', () => {
  test('retention reads the environment, with defaults', () => {
    const defaults = retentionTable({});
    const loc = defaults.find((r) => r.key === 'attendance_location')!;
    expect(loc.period).toContain('24 hours');
    expect(loc.env).toBe('ATTENDANCE_LOCATION_RETENTION_HOURS');
    const custom = retentionTable({ ATTENDANCE_LOCATION_RETENTION_HOURS: '1', BACKUP_RETENTION_DAYS: '14', SOFT_DELETE_RETENTION_DAYS: 'nonsense' });
    expect(custom.find((r) => r.key === 'attendance_location')!.period).toContain('1 hour;');
    expect(custom.find((r) => r.key === 'backups')!.period).toStartWith('14 days');
    expect(custom.find((r) => r.key === 'soft_deleted')!.period).toContain('30 days');
  });

  test('lawful bases: defaults, overrides, unknown keys dropped', () => {
    const def = lawfulBasesFor(null);
    expect(def).toHaveLength(PURPOSES.length);
    expect(def.find((p) => p.purpose === 'translation')!.bases.map((b) => b.key)).toEqual(['consent']);
    expect(def.find((p) => p.purpose === 'safeguarding')!.bases.map((b) => b.key)).toContain('vital_interests');
    const custom = lawfulBasesFor({ education: ['legitimate_interests', 'nonsense'], bogus: ['consent'] });
    const edu = custom.find((p) => p.purpose === 'education')!;
    expect(edu.bases).toEqual([{ key: 'legitimate_interests', label: LAWFUL_BASES.legitimate_interests }]);
    expect(edu.isDefault).toBe(false);
    expect(custom.some((p) => p.purpose === 'bogus')).toBe(false);
  });

  test('consent is the default only for translation', () => {
    const withConsent = PURPOSES.filter((p) => p.defaults.includes('consent')).map((p) => p.key);
    expect(withConsent).toEqual(['translation']);
  });
});

describe('notice', () => {
  test('missing lists the required fields that are empty', () => {
    const empty = settingsView(null);
    expect(missingFields(empty).missing).toEqual([
      'controllerName',
      'controllerAddress',
      'privacyEmail',
      'supervisoryAuthorityName',
      'supervisoryAuthorityUrl',
    ]);
    const notice = buildNotice(empty, 'Example Trust', sources(), {});
    expect(notice.configured).toBe(false);
    expect(notice.organisationName).toBe('Example Trust');
    expect(notice.dpo).toBeNull();
  });

  test('a filled-in notice is configured and carries the controller details', () => {
    const view = {
      ...settingsView(null),
      controllerName: 'Example Trust',
      controllerAddress: '1 High St',
      privacyEmail: 'privacy@trust.example',
      supervisoryAuthorityName: 'ICO',
      supervisoryAuthorityUrl: 'https://ico.org.uk',
      dpoEmail: 'dpo@trust.example',
    };
    const notice = buildNotice(view, null, sources(), {});
    expect(notice.configured).toBe(true);
    expect(notice.missing).toEqual([]);
    expect(notice.recommended).toEqual(['dpoName', 'dataLocation']);
    expect(notice.controller.privacyEmail).toBe('privacy@trust.example');
    expect(notice.dpo).toEqual({ name: null, email: 'dpo@trust.example' });
  });
});

describe('PrivacyService', () => {
  function setup() {
    const prisma = createMockPrisma();
    const cache = createMockCacheService();
    const features = { effective: mock(async () => ({ push_notifications: true, translation: false })) } as unknown as FeatureService;
    const auditLog = { record: mock(async () => undefined) };
    const service = new PrivacyService(prisma as never, features, cache as never, auditLog as never);
    return { prisma, cache, features, auditLog, service };
  }

  test('notice gathers the live configuration and is cached', async () => {
    const { prisma, service } = setup();
    prisma.organisation.findFirst.mockResolvedValue({ name: 'Example Trust' });
    prisma.school_webhook.findMany.mockResolvedValue([{ url: 'https://hooks.example.com/x' }]);
    const first = await service.notice();
    expect(first.organisationName).toBe('Example Trust');
    expect(first.recipients.some((r) => r.name === 'Expo')).toBe(true);
    // integrations is off for the organisation: no webhook recipient.
    expect(first.recipients.some((r) => r.category === 'webhook')).toBe(false);
    expect(first.configured).toBe(false);
    await service.notice();
    expect(prisma.organisation.findFirst).toHaveBeenCalledTimes(1);
  });

  test('update trims, clears empty fields, audits and drops the cached notice', async () => {
    const { prisma, cache, auditLog, service } = setup();
    await cache.set('privacy:notice', { stale: true }, 60);
    prisma.privacy_setting.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
      controller_name: create.controller_name ?? null,
      controller_address: null,
      privacy_email: create.privacy_email ?? null,
      dpo_name: null,
      dpo_email: null,
      supervisory_authority_name: null,
      supervisory_authority_url: null,
      data_location: null,
      lawful_bases: create.lawful_bases ?? {},
      additional_recipients: [],
      updated_at: new Date('2026-11-11T00:00:00Z'),
    }));
    const saved = await service.update(
      { controllerName: '  Example Trust ', privacyEmail: '', lawfulBases: { education: ['legitimate_interests'], ai: [] } },
      ADMIN,
    );
    const call = prisma.privacy_setting.upsert.mock.calls[0][0];
    expect(call.create.controller_name).toBe('Example Trust');
    expect(call.create.privacy_email).toBeNull();
    expect(call.create.lawful_bases).toEqual({ education: ['legitimate_interests'] });
    expect(call.create.updated_by).toBe(ADMIN);
    expect(saved.controllerName).toBe('Example Trust');
    expect(saved.missing).toContain('privacyEmail');
    expect(auditLog.record).toHaveBeenCalledTimes(1);
    const entry = (auditLog.record.mock.calls[0] as unknown[])[3] as { entity: string; action: string };
    expect(entry).toMatchObject({ entity: 'privacy_setting', action: 'create' });
    expect(await cache.get('privacy:notice')).toBeNull();
  });
});

describe('DTO and routes', () => {
  test('validates emails, URLs and lawful bases', async () => {
    const ok = plainToInstance(UpdatePrivacySettingsDto, {
      privacyEmail: 'privacy@trust.example',
      supervisoryAuthorityUrl: 'https://ico.org.uk',
      lawfulBases: { education: ['public_task'] },
      additionalRecipients: [{ name: 'Host', purpose: 'Servers' }],
      controllerAddress: '',
    });
    expect(await validate(ok)).toEqual([]);
    for (const bad of [
      { privacyEmail: 'not-an-email' },
      { supervisoryAuthorityUrl: 'ico.org.uk' },
      { lawfulBases: { education: ['magic'] } },
      { lawfulBases: { unknown: ['consent'] } },
      { additionalRecipients: [{ name: '', purpose: 'x' }] },
    ]) {
      expect((await validate(plainToInstance(UpdatePrivacySettingsDto, bad))).length).toBeGreaterThan(0);
    }
  });

  test('the notice is public; the settings are for organisation admins', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PrivacyNoticeController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, OrganisationPrivacyController)).toEqual([AuthGuard, OrganisationAdminGuard]);
  });
});
