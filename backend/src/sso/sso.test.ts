import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { User } from '@supabase/supabase-js';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { GoogleAdapter } from './adapters/google.adapter';
import { AzureAdapter } from './adapters/azure.adapter';
import { SamlAdapter } from './adapters/saml.adapter';
import { standardProfile } from './adapters/claims';
import { SsoRegistry } from './sso.registry';
import { safeNext, SsoService } from './sso.service';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

function user(email: string, provider: string, data: Record<string, unknown>): User {
  return {
    id: 'user-1',
    email,
    app_metadata: { provider },
    user_metadata: {},
    identities: [{ provider, identity_data: data } as any],
  } as any;
}

const ctx = (domain: string, azureTenantId: string | null = null) => ({
  domain,
  azureTenantId,
});

describe('GoogleAdapter.vouchesForDomain', () => {
  const google = new GoogleAdapter();

  test('a Workspace account on the domain is vouched for', () => {
    const u = user('kai@srmss.edu.gd', 'google', { email_verified: true, hd: 'srmss.edu.gd' });
    expect(google.vouchesForDomain(u, ctx('srmss.edu.gd'))).toBe(true);
  });

  test('a subdomain under the Workspace domain counts', () => {
    const u = user('kai@students.srmss.edu.gd', 'google', {
      email_verified: true,
      custom_claims: { hd: 'srmss.edu.gd' },
    });
    expect(google.vouchesForDomain(u, ctx('students.srmss.edu.gd'))).toBe(true);
  });

  test('no hosted domain (a personal Google account) is not', () => {
    const u = user('kai@srmss.edu.gd', 'google', { email_verified: true });
    expect(google.vouchesForDomain(u, ctx('srmss.edu.gd'))).toBe(false);
  });

  test('another Workspace, or an unverified email, is not', () => {
    const other = user('kai@srmss.edu.gd', 'google', { email_verified: true, hd: 'smss.edu.gd' });
    const unverified = user('kai@srmss.edu.gd', 'google', { email_verified: false, hd: 'srmss.edu.gd' });
    expect(google.vouchesForDomain(other, ctx('srmss.edu.gd'))).toBe(false);
    expect(google.vouchesForDomain(unverified, ctx('srmss.edu.gd'))).toBe(false);
  });
});

describe('AzureAdapter.vouchesForDomain', () => {
  const azure = new AzureAdapter();

  test('the school tenant vouches, via tid or the issuer', () => {
    const viaTid = user('kai@srmss.edu.gd', 'azure', { custom_claims: { tid: TENANT } });
    const viaIss = user('kai@srmss.edu.gd', 'azure', {
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    });
    expect(azure.vouchesForDomain(viaTid, ctx('srmss.edu.gd', TENANT))).toBe(true);
    expect(azure.vouchesForDomain(viaIss, ctx('srmss.edu.gd', TENANT.toUpperCase()))).toBe(true);
  });

  test('another tenant claiming the address does not (nOAuth)', () => {
    const u = user('kai@srmss.edu.gd', 'azure', {
      custom_claims: { tid: '00000000-0000-0000-0000-000000000001' },
    });
    expect(azure.vouchesForDomain(u, ctx('srmss.edu.gd', TENANT))).toBe(false);
  });

  test('without a tenant on the domain nothing is vouched for', () => {
    const u = user('kai@srmss.edu.gd', 'azure', { custom_claims: { tid: TENANT } });
    expect(azure.vouchesForDomain(u, ctx('srmss.edu.gd', null))).toBe(false);
  });
});

describe('SamlAdapter.vouchesForDomain', () => {
  test('a Supabase SSO identity on the domain is vouched for', () => {
    const saml = new SamlAdapter();
    const u = user('kai@srmss.edu.gd', 'sso:abc', {});
    expect(saml.vouchesForDomain(u, ctx('srmss.edu.gd'))).toBe(true);
    expect(saml.vouchesForDomain(u, ctx('smss.edu.gd'))).toBe(false);
  });
});

describe('standardProfile', () => {
  test('prefers given/family names, falls back to splitting the full name', () => {
    expect(
      standardProfile(user('a@b.cd', 'google', { given_name: 'Kai', family_name: 'Joseph' }), 'google'),
    ).toMatchObject({ firstName: 'Kai', lastName: 'Joseph' });
    expect(
      standardProfile(user('a@b.cd', 'azure', { full_name: 'Tia Marie Charles' }), 'azure'),
    ).toMatchObject({ firstName: 'Tia', lastName: 'Marie Charles' });
  });
});

describe('safeNext', () => {
  test('keeps same-site paths only', () => {
    expect(safeNext('/portal/courses?x=1')).toBe('/portal/courses?x=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/login', ' /portal', 42]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});

describe('SsoService.provision', () => {
  const env = process.env.SSO_PROVIDERS;
  beforeEach(() => (process.env.SSO_PROVIDERS = 'google,azure,saml'));
  afterEach(() => (process.env.SSO_PROVIDERS = env));

  function build(opts: {
    domain: any;
    profile?: any;
    joined?: string[];
  }) {
    const inserted: any[] = [];
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue(opts.profile ?? null);
    prisma.user_profile.create.mockImplementation(async ({ data }: any) => {
      inserted.push(data);
      return data;
    });
    const joined: string[] = opts.joined ?? [];
    const domains = {
      verifiedDomainFor: async () => opts.domain,
      tryAutoJoin: async (id: string) => {
        joined.push(id);
        return { status: 'joined' };
      },
    };
    const service = new SsoService(
      {} as any, // auth only; provision never touches it
      createMockCacheService() as any,
      new SsoRegistry(),
      domains as any,
      prisma as any,
    );
    return { service, inserted, joined };
  }

  const studentDomain = {
    domain: 'srmss.edu.gd',
    audience: 'student',
    ssoProvider: 'google',
    ssoRequired: true,
    azureTenantId: null,
  };
  const workspaceStudent = user('kai@srmss.edu.gd', 'google', {
    email_verified: true,
    hd: 'srmss.edu.gd',
    given_name: 'Kai',
    family_name: 'Joseph',
  });

  test('a vouched student needs no form: profile made, school joined', async () => {
    const { service, inserted, joined } = build({ domain: studentDomain });
    const to = await service.provision(workspaceStudent, new GoogleAdapter(), '/portal/grades');
    expect(inserted[0]).toMatchObject({
      first_name: 'Kai',
      last_name: 'Joseph',
      account_type: 'student',
    });
    expect(joined).toEqual(['user-1']);
    expect(to).toBe('/portal/grades');
  });

  test('a shared domain asks student-or-staff first, and joins nobody yet', async () => {
    const { service, inserted, joined } = build({
      domain: { ...studentDomain, audience: 'any' },
    });
    const to = await service.provision(workspaceStudent, new GoogleAdapter(), null);
    expect(inserted[0].first_name).toBeUndefined();
    expect(joined).toEqual([]);
    expect(to).toBe('/onboard');
  });

  test('an existing onboarded profile is not re-created', async () => {
    const { service, inserted, joined } = build({
      domain: studentDomain,
      profile: { id: 'user-1', first_name: 'Kai', school_id: null, account_type: 'student' },
    });
    const to = await service.provision(workspaceStudent, new GoogleAdapter(), null);
    expect(inserted).toEqual([]);
    expect(joined).toEqual(['user-1']);
    expect(to).toBe('/');
  });

  test('an unvouched sign-in gets an account but no school', async () => {
    const personal = user('kai@srmss.edu.gd', 'google', { email_verified: true });
    const { service, joined } = build({ domain: studentDomain });
    const to = await service.provision(personal, new GoogleAdapter(), null);
    expect(joined).toEqual([]);
    expect(to).toBe('/onboard');
  });

  test('the wrong provider for a school that requires its own is refused', async () => {
    const { service } = build({ domain: studentDomain });
    const viaMicrosoft = user('kai@srmss.edu.gd', 'azure', { custom_claims: { tid: TENANT } });
    await expect(
      service.provision(viaMicrosoft, new AzureAdapter(), null),
    ).rejects.toThrow('Your school signs in with Google');
  });
});
