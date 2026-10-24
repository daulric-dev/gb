import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { allowedOrigins } from '@/config/origins';

export interface StoredObject {
  body: Readable;
  contentType: string | null;
  size: number | null;
}


@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly bucket = process.env.S3_BUCKET ?? 'gradebook';
  private readonly client = makeClient(process.env.S3_ENDPOINT);
  // Presigned URLs embed the host they were signed for, so sign with the
  // address the browser will use.
  private readonly publicClient = process.env.S3_PUBLIC_ENDPOINT
    ? makeClient(process.env.S3_PUBLIC_ENDPOINT)
    : this.client;

  /**
   * Development stores start empty; create the bucket instead of failing, and
   * give it the CORS rule browsers need to PUT to presigned URLs. Production
   * buckets are configured once by hand (docs/content/platform-migration.md).
   */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'production' || !process.env.S3_ENDPOINT) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created development bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.warn(`Storage not reachable: ${(err as Error).message}`);
        return;
      }
    }
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: { CORSRules: [corsRule()] },
        }),
      );
    } catch (err) {
      this.logger.warn(`Could not set bucket CORS: ${(err as Error).message}`);
    }
  }

  async put(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** The object, or null when there is no such key. */
  async get(key: string): Promise<StoredObject | null> {
    let res: GetObjectCommandOutput;
    try {
      res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    return {
      body: res.Body as Readable,
      contentType: res.ContentType ?? null,
      size: res.ContentLength ?? null,
    };
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const obj = await this.get(key);
    if (!obj) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async exists(key: string): Promise<{ size: number; contentType: string | null } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.length === 0) return;
    if (list.length === 1) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: list[0] }));
      return;
    }
    // DeleteObjects takes at most 1000 keys per call.
    for (let i = 0; i < list.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: list.slice(i, i + 1000).map((Key) => ({ Key })) },
        }),
      );
    }
  }

  /** A URL the browser can GET the object from, for `expiresIn` seconds. */
  async downloadUrl(
    key: string,
    opts: { expiresIn?: number; filename?: string; inline?: boolean } = {},
  ): Promise<string> {
    const disposition = opts.filename
      ? `${opts.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`
      : undefined;
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: opts.expiresIn ?? 300 },
    );
  }

  /**
   * A URL the client PUTs the file body to. The content type is part of the
   * signature, so the client must send exactly this Content-Type.
   */
  async uploadUrl(
    key: string,
    contentType: string,
    expiresIn = 15 * 60,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }
}

/** Browsers PUT uploads and GET downloads straight from the web origins. */
export function corsRule() {
  return {
    AllowedOrigins: [...new Set([...allowedOrigins(), 'http://localhost:3000'])],
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['Content-Type'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  };
}

function makeClient(endpoint: string | undefined): S3Client {
  return new S3Client({
    endpoint: endpoint || undefined,
    region: process.env.S3_REGION ?? 'auto',
    // The SDK's default flexible checksums get baked into presigned URLs as
    // a checksum of an empty body, which every non-AWS store rejects on the
    // real upload. Only send checksums when an operation requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    forcePathStyle:
      process.env.S3_FORCE_PATH_STYLE === 'true' || (!!endpoint && process.env.S3_FORCE_PATH_STYLE !== 'false'),
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}
