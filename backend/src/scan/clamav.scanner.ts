import { Injectable, Logger } from '@nestjs/common';
import net from 'node:net';

export interface ScanVerdict {
  clean: boolean;
  /** The signature name when a threat is found (e.g. "Eicar-Test-Signature"). */
  signature?: string;
}

@Injectable()
export class ClamavScanner {
  private readonly logger = new Logger(ClamavScanner.name);
  private readonly host = process.env.CLAMAV_HOST;
  private readonly port = Number(process.env.CLAMAV_PORT ?? 3310);
  private readonly timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS ?? 30000);
  private warnedDisabled = false;

  /** Whether a real scanner backend is configured. */
  get enabled(): boolean {
    return !!this.host;
  }

  async scan(buffer: Buffer): Promise<ScanVerdict> {
    if (!this.enabled) {
      if (!this.warnedDisabled) {
        this.logger.warn(
          'CLAMAV_HOST is not set — virus scanning is DISABLED and all uploads pass through. Configure clamd before production.',
        );
        this.warnedDisabled = true;
      }
      return { clean: true };
    }
    return this.instream(buffer);
  }

  private instream(buffer: Buffer): Promise<ScanVerdict> {
    return new Promise<ScanVerdict>((resolve, reject) => {
      const socket = new net.Socket();
      const chunks: Buffer[] = [];
      let settled = false;

      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };

      socket.setTimeout(this.timeoutMs);
      socket.on('timeout', () =>
        done(() => reject(new Error('clamd scan timed out'))),
      );
      socket.on('error', (err) => done(() => reject(err)));
      socket.on('data', (d: Buffer) => chunks.push(d));
      socket.on('end', () =>
        done(() => {
          try {
            resolve(this.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }),
      );

      socket.connect(this.port, this.host!, () => {
        // "zINSTREAM\0" then length-prefixed chunks, terminated by a zero length.
        socket.write('zINSTREAM\0');
        const CHUNK = 64 * 1024;
        for (let off = 0; off < buffer.length; off += CHUNK) {
          const slice = buffer.subarray(off, off + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(slice.length, 0);
          socket.write(size);
          socket.write(slice);
        }
        const terminator = Buffer.alloc(4); // 0x00000000
        socket.write(terminator);
      });
    });
  }

  /** Interpret a clamd INSTREAM reply line. */
  private parse(reply: string): ScanVerdict {
    const line = reply.replace(/\0/g, '').trim();
    if (/\bOK$/.test(line)) return { clean: true };
    const found = line.match(/^stream:\s+(.*)\s+FOUND$/);
    if (found) return { clean: false, signature: found[1] };
    // Anything else (e.g. "... ERROR") is a scan failure, not a clean result.
    throw new Error(`clamd error: ${line || 'empty reply'}`);
  }
}
