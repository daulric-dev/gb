import { afterEach, describe, expect, test } from 'bun:test';
import { FakeProvider } from '@/test/billing-fakes';
import { BillingRegistry, defaultProviders, info } from './billing.registry';

const saved = process.env.BILLING_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = saved;
});

function setup() {
  const a = new FakeProvider('alpha');
  const b = new FakeProvider('beta');
  b.configured = false;
  const registry = new BillingRegistry([a, b]);
  return { registry, a, b };
}

describe('BillingRegistry', () => {
  test('Stripe is the only built-in provider', () => {
    expect(defaultProviders().map((p) => p.id)).toEqual(['stripe']);
  });

  test('enabled = configured', () => {
    const { registry } = setup();
    expect(registry.enabled().map((p) => p.id)).toEqual(['alpha']);
    expect(registry.getEnabled('alpha')?.id).toBe('alpha');
    expect(registry.getEnabled('beta')).toBeUndefined();
    expect(registry.getEnabled('nope')).toBeUndefined();
    expect(registry.getEnabled(null)).toBeUndefined();
    expect(info(registry.enabled()[0])).toEqual({ id: 'alpha', label: 'Fake alpha' });
  });

  test('a provider whose isConfigured throws counts as unconfigured', () => {
    const { registry, a } = setup();
    a.isConfigured = () => {
      throw new Error('bad key');
    };
    expect(registry.enabled()).toEqual([]);
  });

  test('find sees every registered provider, configured or not; removed ids are unknown', () => {
    const { registry } = setup();
    expect(registry.find('beta')?.id).toBe('beta');
    expect(registry.find('manual')).toBeUndefined();
    expect(registry.find(null)).toBeUndefined();
  });

  test('startup warns only when billing is on and nothing is configured', () => {
    const warned: string[] = [];
    const none = new BillingRegistry([]);
    (none as unknown as { logger: { warn: (m: string) => void } }).logger = {
      warn: (m: string) => warned.push(m),
    };
    delete process.env.BILLING_ENABLED;
    none.onModuleInit();
    expect(warned).toHaveLength(0);
    process.env.BILLING_ENABLED = 'true';
    none.onModuleInit();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('STRIPE_SECRET_KEY');

    const { registry } = setup();
    (registry as unknown as { logger: { warn: (m: string) => void } }).logger = {
      warn: (m: string) => warned.push(m),
    };
    registry.onModuleInit();
    expect(warned).toHaveLength(1);
  });
});
