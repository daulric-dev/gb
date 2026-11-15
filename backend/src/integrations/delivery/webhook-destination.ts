import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type ResolvedAddress = { address: string; family: number };
type Resolver = (
  hostname: string,
) => Promise<ResolvedAddress[]>;

const RESTRICTED_IPV4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/**
 * Never allowed, whatever `allowPrivate` says.
 *
 * Link-local carries the cloud instance metadata services (169.254.169.254 on
 * AWS, GCP and Azure; fd00:ec2::254 on AWS IPv6), which hand out credentials
 * to anything that can make an HTTP request from the instance. `allowPrivate`
 * exists so an organisation can reach a service on its own network - an
 * on-premise Ollama, an internal OneRoster server. Nothing legitimate lives on
 * a link-local address, so the switch does not reach these.
 */
const ALWAYS_BLOCKED_IPV4: [string, number][] = [['169.254.0.0', 16]];
const ALWAYS_BLOCKED_IPV6 = [
  { base: 'fe80::', prefix: 10 },
  { base: 'fd00:ec2::', prefix: 32 },
];

const IPV6_GLOBAL_UNICAST = { base: '2000::', prefix: 3 };
const RESTRICTED_IPV6_RANGES = [
  { base: '2001::', prefix: 23 },
  { base: '2001:db8::', prefix: 32 },
  { base: '2002::', prefix: 16 },
  { base: '3fff::', prefix: 20 },
];

export interface DestinationOptions {
  /**
   * Whether private / loopback / reserved addresses are allowed. When left
   * out, the install-wide WEBHOOK_ALLOW_PRIVATE switch decides (webhooks,
   * LTI keysets, OneRoster). Callers with their own rule (AI providers, per
   * provider) pass an explicit boolean and the environment is not read.
   */
  allowPrivate?: boolean;
}

export async function resolveWebhookDestination(
  hostname: string,
  resolver: Resolver = (name) =>
    dnsLookup(name, { all: true, verbatim: true }),
  options: DestinationOptions = {},
): Promise<ResolvedAddress> {
  return (await resolveWebhookDestinations(hostname, resolver, options))[0];
}

/**
 * Every address the host resolves to, in resolver order, after the same
 * check as `resolveWebhookDestination` (all of them must pass). The sender
 * tries them in turn, so a host that answers on only one family (e.g.
 * `localhost` resolving to ::1 first while the server listens on 127.0.0.1)
 * is still reached - each attempt pinned to a checked address.
 */
export async function resolveWebhookDestinations(
  hostname: string,
  resolver: Resolver = (name) =>
    dnsLookup(name, { all: true, verbatim: true }),
  options: DestinationOptions = {},
): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(host);
  const addresses = literalFamily
    ? [{ address: host, family: literalFamily }]
    : await resolver(host);

  if (addresses.length === 0) {
    throw new Error('Webhook host did not resolve to an IP address');
  }

  // Checked before anything else: no setting makes these reachable.
  if (addresses.some(({ address }) => isAlwaysBlocked(address))) {
    throw new Error('Webhook host resolves to a link-local or metadata address');
  }

  const allowPrivate =
    options.allowPrivate ?? process.env.WEBHOOK_ALLOW_PRIVATE === 'true';
  if (!allowPrivate) {
    if (addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new Error('Webhook host resolves to a private or reserved address');
    }
  }

  // Duplicates add nothing to try.
  const seen = new Set<string>();
  return addresses.filter(({ address }) => !seen.has(address) && seen.add(address));
}

/** `::ffff:0:0/96` (v4-mapped) and `::/96` (v4-compatible) carry an IPv4 address. */
const V4_MAPPED_PREFIX = '::ffff:0:0';
const V4_EMBEDDED_PREFIX_BITS = 96;

/**
 * The IPv4 address carried inside an IPv6 one, or null.
 *
 * `::ffff:169.254.169.254` is an IPv6 literal to `isIP`, and a dual-stack
 * socket connects it to 169.254.169.254 all the same - so the IPv4 rules have
 * to be applied to it. `new URL()` makes this worse by canonicalising the host
 * to `[::ffff:a9fe:a9fe]`, the same address written in hex, so matching on the
 * text would not catch it either. Comparing numbers catches every spelling.
 */
function embeddedIpv4(address: string): bigint | null {
  let value: bigint;
  try {
    value = ipv6Value(address);
  } catch {
    return null;
  }
  const mapped = inCidrValue(
    value,
    ipv6Value(V4_MAPPED_PREFIX),
    V4_EMBEDDED_PREFIX_BITS,
    128,
  );
  const compatible = inCidrValue(value, 0n, V4_EMBEDDED_PREFIX_BITS, 128);
  if (!mapped && !compatible) return null;
  return value & 0xffffffffn;
}

function isBlockedIpv4(value: bigint): boolean {
  return ALWAYS_BLOCKED_IPV4.some(([base, prefix]) =>
    inCidrValue(value, ipv4Value(base), prefix, 32),
  );
}

/** Link-local and cloud metadata, refused however the install is configured. */
export function isAlwaysBlocked(address: string): boolean {
  const family = isIP(address);
  try {
    if (family === 4) return isBlockedIpv4(ipv4Value(address));
    if (family === 6) {
      if (
        ALWAYS_BLOCKED_IPV6.some(({ base, prefix }) =>
          inCidr(address, base, prefix, 128),
        )
      ) {
        return true;
      }
      // An IPv4 address written as IPv6 is still that IPv4 address.
      const embedded = embeddedIpv4(address);
      return embedded !== null && isBlockedIpv4(embedded);
    }
  } catch {
    // An address neither check could parse is not one we will connect to.
    return true;
  }
  // Not an IP address at all: nothing to connect to, and the callers below
  // treat it as non-public anyway.
  return false;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !RESTRICTED_IPV4_RANGES.some(([base, prefix]) =>
      inCidr(address, base, prefix, 32),
    );
  }
  if (family !== 6) return false;

  if (!inCidr(address, IPV6_GLOBAL_UNICAST.base, IPV6_GLOBAL_UNICAST.prefix, 128)) {
    return false;
  }
  return !RESTRICTED_IPV6_RANGES.some(({ base, prefix }) =>
    inCidr(address, base, prefix, 128),
  );
}

function inCidr(
  address: string,
  base: string,
  prefix: number,
  bitLength: 32 | 128,
): boolean {
  const value = bitLength === 32 ? ipv4Value(address) : ipv6Value(address);
  const network = bitLength === 32 ? ipv4Value(base) : ipv6Value(base);
  return inCidrValue(value, network, prefix, bitLength);
}

function inCidrValue(
  value: bigint,
  network: bigint,
  prefix: number,
  bitLength: 32 | 128,
): boolean {
  const shift = BigInt(bitLength - prefix);
  return (value >> shift) === (network >> shift);
}

function ipv4Value(address: string): bigint {
  return address
    .split('.')
    .reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);
}

function ipv6Value(address: string): bigint {
  let value = address.toLowerCase();
  const ipv4Tail = value.match(/(?:\d{1,3}\.){3}\d{1,3}$/)?.[0];
  if (ipv4Tail) {
    const octets = ipv4Tail.split('.').map(Number);
    if (octets.some((part) => part < 0 || part > 255)) {
      throw new Error('Invalid IPv6 address');
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = value.slice(0, -ipv4Tail.length) + `${high}:${low}`;
  }

  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    throw new Error('Invalid IPv6 address');
  }
  const words = [...left, ...new Array<string>(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) {
    throw new Error('Invalid IPv6 address');
  }
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}
