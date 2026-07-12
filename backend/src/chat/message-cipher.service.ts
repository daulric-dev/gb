import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const PREFIX = 'enc';

@Injectable()
export class MessageCipher {
  private readonly logger = new Logger(MessageCipher.name);
  private readonly keyring = new Map<number, Buffer>();
  private readonly currentVersion: number;
  private readonly enabled: boolean;

  constructor() {
    this.loadKeys();
    this.enabled = this.keyring.size > 0;

    if (!this.enabled) {
      if (process.env.NODE_ENV === 'production') {
        // Fail closed: never silently store plaintext in production.
        throw new Error(
          'CHAT_ENCRYPTION_KEY is required in production (message encryption at rest).',
        );
      }
      this.logger.warn(
        'No CHAT_ENCRYPTION_KEY set — chat messages are stored UNENCRYPTED (dev only).',
      );
      this.currentVersion = 0;
      return;
    }

    const pinned = Number(process.env.CHAT_ENCRYPTION_KEY_VERSION);
    this.currentVersion =
      pinned && this.keyring.has(pinned)
        ? pinned
        : Math.max(...this.keyring.keys());
    this.logger.log(
      `Chat message encryption enabled (current key v${this.currentVersion}).`,
    );
  }

  /** Encrypt a plaintext body for storage. Null/empty and disabled pass through. */
  encrypt(plaintext: string | null): string | null {
    if (plaintext === null || plaintext === '' || !this.enabled) {
      return plaintext;
    }
    const key = this.keyring.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}:v${this.currentVersion}:${iv.toString('base64')}:${tag.toString(
      'base64',
    )}:${ct.toString('base64')}`;
  }

  /** Decrypt a stored value. Legacy plaintext (no `enc:` prefix) passes through. */
  decrypt(stored: string | null): string | null {
    if (stored === null || !stored.startsWith(`${PREFIX}:`)) {
      return stored;
    }
    const parts = stored.split(':');
    // enc : v<ver> : iv : tag : ct
    if (parts.length !== 5) {
      this.logger.error('Malformed ciphertext envelope; dropping body');
      return '';
    }
    const version = Number(parts[1].slice(1));
    const key = this.keyring.get(version);
    if (!key) {
      this.logger.error(`No key for message version v${version}`);
      return '';
    }
    try {
      const iv = Buffer.from(parts[2], 'base64');
      const tag = Buffer.from(parts[3], 'base64');
      const ct = Buffer.from(parts[4], 'base64');
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
        'utf8',
      );
    } catch (err) {
      // Wrong key or tampered ciphertext (GCM auth failure). Never surface raw.
      this.logger.error(`Failed to decrypt message: ${(err as Error).message}`);
      return '';
    }
  }

  private loadKeys(): void {
    const ring = process.env.CHAT_ENCRYPTION_KEYS?.trim();
    if (ring) {
      for (const pair of ring.split(',')) {
        const [ver, b64] = pair.split(':').map((s) => s.trim());
        const version = Number(ver);
        if (!version || !b64) continue;
        this.addKey(version, b64);
      }
      return;
    }
    const single = process.env.CHAT_ENCRYPTION_KEY?.trim();
    if (single) this.addKey(1, single);
  }

  private addKey(version: number, b64: string): void {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== KEY_BYTES) {
      throw new Error(
        `CHAT_ENCRYPTION key v${version} must be ${KEY_BYTES} bytes (base64); got ${buf.length}.`,
      );
    }
    this.keyring.set(version, buf);
  }
}
