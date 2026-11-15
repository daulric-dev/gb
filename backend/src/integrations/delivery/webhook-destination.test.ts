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
        '192.168.1.1',
        '::1',
        'fc00::1',
        '::ffff:127.0.0.1',
      ]) {
        await expect(resolveWebhookDestination(address)).rejects.toThrow(
          'private or reserved',
        );
      }
      // Link-local has its own refusal; it is never allowed (see below).
      for (const address of ['169.254.169.254', 'fe80::1']) {
        await expect(resolveWebhookDestination(address)).rejects.toThrow(
          'link-local or metadata',
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

describe('link-local and cloud metadata are never allowed', () => {
  // WEBHOOK_ALLOW_PRIVATE (and a per-request allowPrivate) exist so an
  // organisation can reach a service on its own network. Instance metadata
  // hands out credentials to anything that can make a request from the
  // machine, so it stays out of reach either way.
  const METADATA = [
    '169.254.169.254', // AWS, GCP, Azure
    '169.254.170.2', // ECS task metadata
    'fd00:ec2::254', // AWS IPv6
    'fe80::1', // link-local generally
  ];

  test('refused with allowPrivate passed explicitly', async () => {
    for (const address of METADATA) {
      await expect(
        resolveWebhookDestination(address, undefined, { allowPrivate: true }),
      ).rejects.toThrow('link-local or metadata');
    }
  });

  test('refused with WEBHOOK_ALLOW_PRIVATE=true', async () => {
    const previous = process.env.WEBHOOK_ALLOW_PRIVATE;
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    try {
      for (const address of METADATA) {
        await expect(resolveWebhookDestination(address)).rejects.toThrow(
          'link-local or metadata',
        );
      }
    } finally {
      if (previous === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
      else process.env.WEBHOOK_ALLOW_PRIVATE = previous;
    }
  });

  test('refused when a hostname resolves to one', async () => {
    const resolver = async () => [
      { address: '203.0.113.5', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ];
    await expect(
      resolveWebhookDestination('metadata.example.com', resolver, {
        allowPrivate: true,
      }),
    ).rejects.toThrow('link-local or metadata');
  });

  test('an IPv4 metadata address written as IPv6 is refused too', async () => {
    // A dual-stack socket connects every one of these to 169.254.169.254.
    // `new URL('http://[::ffff:169.254.169.254]/').hostname` canonicalises to
    // `[::ffff:a9fe:a9fe]`, so the check cannot be on the text.
    for (const address of [
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '0:0:0:0:0:ffff:169.254.169.254',
      '::169.254.169.254',
      '::ffff:169.254.170.2',
    ]) {
      await expect(
        resolveWebhookDestination(address, undefined, { allowPrivate: true }),
      ).rejects.toThrow('link-local or metadata');
    }
  });

  test('an ordinary address written as IPv4-mapped IPv6 is unaffected', async () => {
    const resolved = await resolveWebhookDestination('::ffff:10.0.0.4', undefined, {
      allowPrivate: true,
    });
    expect(resolved.address).toBe('::ffff:10.0.0.4');
  });

  test('an ordinary private address is still reachable with allowPrivate', async () => {
    const resolved = await resolveWebhookDestination('10.0.0.4', undefined, {
      allowPrivate: true,
    });
    expect(resolved.address).toBe('10.0.0.4');
  });
});
