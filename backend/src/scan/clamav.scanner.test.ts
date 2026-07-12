import { describe, test, expect, afterEach } from 'bun:test';
import net from 'node:net';
import { ClamavScanner } from './clamav.scanner';

/**
 * Minimal fake clamd that speaks just enough of the INSTREAM protocol: read the
 * "zINSTREAM\0" command, consume length-prefixed chunks until the zero-length
 * terminator, then reply with a fixed verdict line.
 */
function fakeClamd(reply: string): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let gotCommand = false;
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!gotCommand) {
        const nul = buf.indexOf(0);
        if (nul === -1) return;
        gotCommand = true;
        buf = buf.subarray(nul + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          socket.write(reply);
          socket.end();
          return;
        }
        if (buf.length < 4 + len) return;
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const savedEnv = { ...process.env };
afterEach(() => {
  process.env.CLAMAV_HOST = savedEnv.CLAMAV_HOST;
  process.env.CLAMAV_PORT = savedEnv.CLAMAV_PORT;
});

function point(server: net.Server) {
  const addr = server.address() as net.AddressInfo;
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(addr.port);
}

describe('ClamavScanner', () => {
  test('passes through (clean) and reports disabled when no host is set', async () => {
    delete process.env.CLAMAV_HOST;
    const scanner = new ClamavScanner();
    expect(scanner.enabled).toBe(false);
    expect(await scanner.scan(Buffer.from('anything'))).toEqual({
      clean: true,
    });
  });

  test('reports clean on an OK verdict', async () => {
    const server = await fakeClamd('stream: OK\0');
    point(server);
    const scanner = new ClamavScanner();
    const verdict = await scanner.scan(Buffer.from('harmless bytes'));
    expect(verdict.clean).toBe(true);
    server.close();
  });

  test('reports the signature on a FOUND verdict', async () => {
    const server = await fakeClamd('stream: Eicar-Test-Signature FOUND\0');
    point(server);
    const scanner = new ClamavScanner();
    const verdict = await scanner.scan(Buffer.from('X5O!P%@AP'));
    expect(verdict.clean).toBe(false);
    expect(verdict.signature).toBe('Eicar-Test-Signature');
    server.close();
  });

  test('throws (fails closed) on an ERROR verdict', async () => {
    const server = await fakeClamd('INSTREAM size limit exceeded ERROR\0');
    point(server);
    const scanner = new ClamavScanner();
    expect(scanner.scan(Buffer.from('big'))).rejects.toThrow();
    server.close();
  });
});
