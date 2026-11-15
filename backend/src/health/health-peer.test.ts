import { describe, expect, test } from 'bun:test';
import { isInternalPeer, isPrivateAddress } from './health-peer';

describe('isPrivateAddress', () => {
  test('accepts loopback and private IPv4', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.4',
      '192.168.1.20',
      '172.16.0.1',
      '172.31.255.254',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  test('refuses public IPv4', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '11.0.0.1']) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  test('reads IPv4-mapped IPv6 as IPv4', () => {
    expect(isPrivateAddress('::ffff:10.0.0.4')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  test('accepts IPv6 loopback, unique local and link local', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fe80::1%eth0')).toBe(true);
  });

  test('refuses global IPv6 and anything unparseable', () => {
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
    expect(isPrivateAddress('not-an-address')).toBe(false);
    expect(isPrivateAddress('')).toBe(false);
  });
});

describe('isInternalPeer', () => {
  test('reads the socket peer, not a forwarded header', () => {
    expect(isInternalPeer({ socket: { remoteAddress: '10.0.0.4' } })).toBe(true);
    expect(isInternalPeer({ socket: { remoteAddress: '203.0.113.9' } })).toBe(false);
  });

  test('falls back to the raw socket', () => {
    expect(isInternalPeer({ raw: { socket: { remoteAddress: '127.0.0.1' } } })).toBe(true);
  });

  test('an unknown peer is not internal', () => {
    expect(isInternalPeer({})).toBe(false);
    expect(isInternalPeer({ socket: { remoteAddress: null } })).toBe(false);
  });

  // The bundled Caddy runs on the Compose network, so a request it relays
  // from the internet has a private socket peer. Checking the address alone
  // would hand the detailed health answer to everyone.
  test('a relayed request is never internal, whatever its peer address', () => {
    for (const header of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host']) {
      expect(
        isInternalPeer({
          socket: { remoteAddress: '172.18.0.3' }, // Caddy on the Compose network
          headers: { [header]: '203.0.113.9' },
        }),
      ).toBe(false);
    }
  });

  test('the container health check reaching itself is internal', () => {
    expect(
      isInternalPeer({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }),
    ).toBe(true);
  });

  test('a client adding the header itself can only take detail away', () => {
    expect(
      isInternalPeer({
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'x-forwarded-for': '10.0.0.1' },
      }),
    ).toBe(false);
  });

  test('reads headers off the raw request when Fastify has not parsed them', () => {
    expect(
      isInternalPeer({
        raw: { socket: { remoteAddress: '10.0.0.4' }, headers: { 'x-forwarded-for': '1.2.3.4' } },
      }),
    ).toBe(false);
  });
});
