import { afterEach, describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { FakeProvider } from '@/test/billing-fakes';
import { BillingRegistry, defaultProviders } from './billing.registry';

const saved = process.env.PAYMENT_PROVIDERS;
afterEach(() => {
  if (saved === undefined) delete process.env.PAYMENT_PROVIDERS;
  else process.env.PAYMENT_PROVIDERS = saved;
});

function setup(switchedOff: string[] = []) {
  const prisma = createMockPrisma();
  prisma.provider_setting.findMany.mockResolvedValue([
    ...switchedOff.map((id) => ({ provider_id: id, enabled: false })),
    { provider_id: 'other', enabled: true },
  ]);
  const a = new FakeProvider('alpha');
  const b = new FakeProvider('beta', 'invoice');
  const c = new FakeProvider('gamma');
  c.configured = false;
  const registry = new BillingRegistry(prisma as never, [a, b, c]);
  return { registry, a, b, c, prisma };
}

describe('BillingRegistry', () => {
  test('registers every built-in provider', () => {
    expect(defaultProviders().map((p) => p.id)).toEqual(['stripe', 'paypal', 'paddle', 'wipay', 'manual']);
  });

  test('nothing is offered without PAYMENT_PROVIDERS', async () => {
    delete process.env.PAYMENT_PROVIDERS;
    const { registry } = setup();
    expect(await registry.enabled()).toEqual([]);
    process.env.PAYMENT_PROVIDERS = '';
    expect(await registry.enabled()).toEqual([]);
  });

  test('enabled = allowed by env AND configured AND not switched off', async () => {
    process.env.PAYMENT_PROVIDERS = 'alpha,beta,gamma';
    const { registry } = setup(['beta']);
    const statuses = await registry.statuses();
    expect(statuses).toEqual([
      { id: 'alpha', label: 'Fake alpha', mode: 'subscription', allowedByEnv: true, configured: true, enabled: true },
      { id: 'beta', label: 'Fake beta', mode: 'invoice', allowedByEnv: true, configured: true, enabled: false },
      { id: 'gamma', label: 'Fake gamma', mode: 'subscription', allowedByEnv: true, configured: false, enabled: false },
    ]);
    expect((await registry.enabled()).map((p) => p.id)).toEqual(['alpha']);
  });

  test('a provider not in the allowlist is never enabled', async () => {
    process.env.PAYMENT_PROVIDERS = 'beta';
    const { registry } = setup();
    expect((await registry.enabled()).map((p) => p.id)).toEqual(['beta']);
    expect(await registry.getEnabled('alpha')).toBeUndefined();
    expect((await registry.getEnabled('beta'))?.id).toBe('beta');
    expect(await registry.getEnabled('nope')).toBeUndefined();
    expect(await registry.getEnabled(null)).toBeUndefined();
  });

  test('a provider whose isConfigured throws counts as unconfigured', async () => {
    process.env.PAYMENT_PROVIDERS = 'alpha';
    const { registry, a } = setup();
    a.isConfigured = () => {
      throw new Error('bad key');
    };
    expect(await registry.enabled()).toEqual([]);
  });

  test('find and known see every registered provider, enabled or not', () => {
    const { registry } = setup();
    expect(registry.find('gamma')?.id).toBe('gamma');
    expect(registry.known('beta')).toBe(true);
    expect(registry.known('stripe')).toBe(false);
  });
});
