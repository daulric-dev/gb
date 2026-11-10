import { describe, expect, test } from 'bun:test';
import { resolveWebhookDestination, resolveWebhookDestinations } from './webhook-destination';

describe('resolveWebhookDestination', () => {
  test('allows public IPv4 and IPv6 addresses', async () => {
    expect(await resolveWebhookDestination('8.8.8.8')).toEqual({
      address: '8.8.8.8',
      family: 4,
    });
    expect(await resolveWebhookDestination('2606:4700:4700::1111')).toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });

  test('blocks private, loopback, link-local, and reserved addresses', async () => {
    const previous = process.env.WEBHOOK_ALLOW_PRIVATE;
    process.env.WEBHOOK_ALLOW_PRIVATE = 'false';
    try {
      for (const address of [
        '10.0.0.1',
        '127.0.0.1',
        '169.254.169.254',
        '192.168.1.1',
        '::1',
        'fe80::1',
        'fc00::1',
        '::ffff:127.0.0.1',
      ]) {
        await expect(resolveWebhookDestination(address)).rejects.toThrow(
          'private or reserved',
        );
      }
    } finally {
      if (previous === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
      else process.env.WEBHOOK_ALLOW_PRIVATE = previous;
    }
  });

  test('rejects a hostname if any DNS answer is private', async () => {
    const previous = process.env.WEBHOOK_ALLOW_PRIVATE;
    process.env.WEBHOOK_ALLOW_PRIVATE = 'false';
    try {
      await expect(
        resolveWebhookDestination('hooks.example', async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ]),
      ).rejects.toThrow('private or reserved');
    } finally {
      if (previous === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
      else process.env.WEBHOOK_ALLOW_PRIVATE = previous;
    }
  });

  test('uses the first validated DNS address as the pinned destination', async () => {
    const resolved = await resolveWebhookDestination(
      'hooks.example',
      async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
    );
    expect(resolved).toEqual({ address: '8.8.8.8', family: 4 });
  });

  describe('the allowPrivate option (AI providers decide per provider)', () => {
    const withEnv = async (value: string | undefined, fn: () => Promise<void>) => {
      const previous = process.env.WEBHOOK_ALLOW_PRIVATE;
      if (value === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
      else process.env.WEBHOOK_ALLOW_PRIVATE = value;
      try {
        await fn();
      } finally {
        if (previous === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
        else process.env.WEBHOOK_ALLOW_PRIVATE = previous;
      }
    };

    test('without the option, webhooks keep following WEBHOOK_ALLOW_PRIVATE', async () => {
      await withEnv(undefined, async () => {
        await expect(resolveWebhookDestination('127.0.0.1')).rejects.toThrow('private or reserved');
        await expect(resolveWebhookDestination('127.0.0.1', undefined, {})).rejects.toThrow('private or reserved');
      });
      await withEnv('true', async () => {
        expect(await resolveWebhookDestination('127.0.0.1')).toEqual({ address: '127.0.0.1', family: 4 });
        expect(await resolveWebhookDestination('10.0.0.1', undefined, {})).toEqual({ address: '10.0.0.1', family: 4 });
      });
    });

    test('allowPrivate: false refuses private addresses even with WEBHOOK_ALLOW_PRIVATE=true', async () => {
      await withEnv('true', async () => {
        await expect(
          resolveWebhookDestination('127.0.0.1', undefined, { allowPrivate: false }),
        ).rejects.toThrow('private or reserved');
        await expect(
          resolveWebhookDestination('llm.example', async () => [{ address: '192.168.1.5', family: 4 }], {
            allowPrivate: false,
          }),
        ).rejects.toThrow('private or reserved');
      });
    });

    test('allowPrivate: true allows them without WEBHOOK_ALLOW_PRIVATE', async () => {
      await withEnv('false', async () => {
        expect(await resolveWebhookDestination('127.0.0.1', undefined, { allowPrivate: true })).toEqual({
          address: '127.0.0.1',
          family: 4,
        });
      });
    });
  });
});

describe('resolveWebhookDestinations', () => {
  test('returns every checked address in resolver order, without duplicates', async () => {
    const out = await resolveWebhookDestinations(
      'localhost',
      async () => [
        { address: '::1', family: 6 },
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      { allowPrivate: true },
    );
    expect(out).toEqual([
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ]);
  });

  test('refuses the host if any address is private when private is not allowed', async () => {
    await expect(
      resolveWebhookDestinations(
        'mixed.example',
        async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ],
        { allowPrivate: false },
      ),
    ).rejects.toThrow('private or reserved');
  });
});
