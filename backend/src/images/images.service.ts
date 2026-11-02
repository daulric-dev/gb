import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  ObjectTooLargeError,
  StorageService,
} from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { publicImageUrl } from './public-url';

/** Image types every upload here accepts: never SVG or anything scriptable. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const IMAGE_AREAS = ['course-banners', 'school-logos'] as const;
export type ImageArea = (typeof IMAGE_AREAS)[number];

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024;
  private static readonly ALLOWED_TYPES: readonly string[] = IMAGE_TYPES;
  private static readonly BUCKET = 'images';
  /** How long a presigned avatar upload URL stays valid. */
  private static readonly UPLOAD_URL_TTL = 5 * 60;
  /**
   * Presigned PUTs land here, outside `avatars/`, so nothing is ever served
   * from a key an upload URL was signed for. Completing writes the verified
   * bytes to `avatars/<userId>.<ext>`.
   */
  private static readonly STAGING_PREFIX = 'uploads/';
  private static readonly CACHE_TTL = 3600; // 1 hour
  private static cacheKey(userId: string) {
    return `avatar:${userId}`;
  }

  /** Verify the leading bytes match the declared (allowed) image format. */
  private static matchesImageSignature(
    buffer: Buffer,
    mimetype: string,
  ): boolean {
    if (buffer.length < 12) return false;
    switch (mimetype) {
      case 'image/jpeg':
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      case 'image/png':
        return buffer
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
      case 'image/webp':
        return (
          buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP'
        );
      default:
        return false;
    }
  }

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /** The signed-in user's own avatar, streamed from storage. */
  async getImageFromUserProfile(
    userId: string,
  ): Promise<{ body: Readable; contentType: string; size: number | null }> {
    const key = ImagesService.cacheKey(userId);

    let avatarUrl: string = (await this.cacheService.get(key)) as string;

    if (!avatarUrl) {
      let profileError: Error | null = null;
      const profile = await this.prisma.user_profile
        .findUnique({ where: { id: userId }, select: { avatar_url: true } })
        .catch((err: Error) => {
          profileError = err;
          return null;
        });

      if (!profile?.avatar_url) {
        this.logger.error(
          `Failed to get avatar URL: ${(profileError as Error | null)?.message ?? 'No avatar set'}`,
        );
        throw new BadRequestException('No avatar found for this user');
      }

      avatarUrl = profile.avatar_url;
      await this.cacheService.set(key, avatarUrl, ImagesService.CACHE_TTL);
    }

    const image = await this.readAvatar(this.extractStoragePath(avatarUrl));
    if (!image) {
      this.logger.error(`Avatar object missing for ${userId}`);
      throw new BadRequestException('Failed to download avatar image');
    }
    return image;
  }

  /**
   * An avatar object by its path inside the images area, for the public
   * avatar route. Avatars were a public bucket, so no auth is involved; the
   * name is validated so nothing outside `avatars/` can be read.
   */
  async readAvatar(
    path: string,
  ): Promise<{ body: Readable; contentType: string; size: number | null } | null> {
    if (!ImagesService.AVATAR_PATH.test(path)) return null;
    const obj = await this.storage.get(objectKey(ImagesService.BUCKET, path));
    if (!obj) return null;
    return {
      body: obj.body,
      contentType: obj.contentType || 'application/octet-stream',
      size: obj.size,
    };
  }

  private static readonly AVATAR_PATH = /^avatars\/[A-Za-z0-9._-]+$/;

  /**
   * The object path inside an avatar URL. Accepts both the old hosted-storage
   * public URL (`.../storage/v1/object/public/images/avatars/<file>`) and the
   * URLs written now (`<API_URL>/api/images/avatars/<file>`, or
   * `<S3_PUBLIC_URL>/images/avatars/<file>`).
   */
  private extractStoragePath(url: string): string {
    const marker = `/${ImagesService.BUCKET}/avatars/`;
    const idx = url.indexOf(marker);
    if (idx === -1) {
      throw new BadRequestException('Invalid avatar URL format');
    }
    const raw = url.slice(idx + `/${ImagesService.BUCKET}/`.length).split('?')[0];
    // Defense-in-depth: the stored URL must point at an avatar object and
    // must not contain path-traversal segments.
    if (!ImagesService.AVATAR_PATH.test(raw)) {
      throw new BadRequestException('Invalid avatar URL format');
    }
    return raw;
  }

  /**
   * The URL stored in `user_profile.avatar_url` and rendered by every client
   * as an image source. With S3_PUBLIC_URL (a CDN or public bucket host in
   * front of the store) it points there; otherwise at this API's public
   * avatar route.
   */
  private publicUrl(path: string, requestOrigin?: string): string {
    return publicImageUrl(path, requestOrigin);
  }

  /**
   * A user may only ever reference their own avatar object. The path is
   * always `avatars/<userId>.<ext>` (see buildPath); reject anything else so
   * a client cannot point their profile at another user's object.
   */
  private assertOwnedPath(userId: string, path: string): void {
    if (
      path !==
      `${ImagesService.STAGING_PREFIX}${this.buildPath(userId, this.safeExtension(path))}`
    ) {
      throw new BadRequestException('Upload path does not belong to caller');
    }
  }

  // ── Direct upload (presigned PUT) ───────────────────────────────────

  /**
   * A presigned URL the client PUTs the image to, straight into storage.
   * The URL is bound to the declared size and type, and points at a staging
   * key that is never served.
   *
   * Flow:
   *  1. Client calls this endpoint and gets `{ path, uploadUrl, headers }`
   *  2. Client PUTs the bytes to `uploadUrl` with exactly those headers
   *  3. Client calls `completeResumableUpload` with `path`
   */
  async createResumableUpload(
    userId: string,
    filename: string,
    contentType: string,
    totalSize: number,
  ) {
    const ext = this.safeExtension(filename);
    return this.createImageTicket(
      `${ImagesService.STAGING_PREFIX}${this.buildPath(userId, ext)}`,
      contentType,
      totalSize,
      ImagesService.MAX_FILE_SIZE,
    );
  }


  async completeResumableUpload(userId: string, path: string, requestOrigin?: string) {
    this.assertOwnedPath(userId, path);
    const finalPath = path.slice(ImagesService.STAGING_PREFIX.length);
    await this.finalizeImage(path, finalPath, ImagesService.MAX_FILE_SIZE);

    const avatarUrl = this.cacheBust(this.publicUrl(finalPath, requestOrigin));
    await this.updateProfileAvatar(userId, avatarUrl);

    return { avatar_url: avatarUrl };
  }

  // ── Shared upload steps (avatars, course banners, school logos) ─────

  newImagePath(area: ImageArea, ownerId: string, contentType: string) {
    this.assertAllowedType(contentType);
    const name = `${area}/${ownerId}-${randomBytes(16).toString('hex')}.${EXTENSION[contentType]}`;
    return { staging: `${ImagesService.STAGING_PREFIX}${name}`, served: name };
  }

  servedPathFor(area: ImageArea, ownerId: string, path: string): string {
    const name = path.startsWith(ImagesService.STAGING_PREFIX)
      ? path.slice(ImagesService.STAGING_PREFIX.length)
      : '';
    const re = new RegExp(`^${area}/${escapeRe(ownerId)}-[0-9a-f]{32}\\.(jpg|png|webp)$`);
    if (!re.test(name)) {
      throw new BadRequestException('Upload path does not belong to caller');
    }
    return name;
  }

  async createImageTicket(
    stagingPath: string,
    contentType: string,
    totalSize: number,
    maxBytes: number,
  ) {
    if (!Number.isInteger(totalSize) || totalSize <= 0) {
      throw new BadRequestException('File is empty');
    }
    if (totalSize > maxBytes) {
      throw new BadRequestException(
        `File too large (${(totalSize / 1024 / 1024).toFixed(1)}MB). Maximum is ${mb(maxBytes)}MB.`,
      );
    }
    this.assertAllowedType(contentType);

    const ttl = ImagesService.UPLOAD_URL_TTL;
    let uploadUrl: string;
    try {
      uploadUrl = await this.storage.uploadUrl(
        objectKey(ImagesService.BUCKET, stagingPath),
        contentType,
        ttl,
        totalSize,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create upload URL: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to create upload session');
    }

    return {
      path: stagingPath,
      method: 'PUT' as const,
      uploadUrl,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /**
   * Check a staged upload (size, declared type, leading bytes, reading at
   * most `maxBytes`) and write the checked bytes to `servedPath`. The staged
   * object is deleted whether it passes or not, so a still-valid upload URL
   * cannot change anything after the check.
   */
  async finalizeImage(
    stagingPath: string,
    servedPath: string,
    maxBytes: number,
  ): Promise<void> {
    const key = objectKey(ImagesService.BUCKET, stagingPath);

    const head = await this.storage.exists(key);
    if (!head) {
      throw new BadRequestException(
        `File at "${stagingPath}" not found. Upload may not be complete yet.`,
      );
    }

    const reject = async (message: string): Promise<never> => {
      await this.storage
        .delete(key)
        .catch((err: Error) =>
          this.logger.error(`Could not remove rejected image: ${err.message}`),
        );
      throw new BadRequestException(message);
    };

    if (head.size > maxBytes) {
      await reject(
        `File too large (${(head.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${mb(maxBytes)}MB.`,
      );
    }
    const contentType = head.contentType ?? '';
    if (!ImagesService.ALLOWED_TYPES.includes(contentType)) {
      await reject(
        `Invalid file type "${contentType || 'unknown'}". Allowed: ${ImagesService.ALLOWED_TYPES.join(', ')}`,
      );
    }
    // The object can be replaced between the HEAD and this read, so the read
    // is capped on its own.
    let buffer: Buffer | null = null;
    try {
      buffer = await this.storage.getBuffer(key, maxBytes);
    } catch (error) {
      if (!(error instanceof ObjectTooLargeError)) throw error;
      await reject(`File too large. Maximum is ${mb(maxBytes)}MB.`);
    }
    if (
      !buffer ||
      !ImagesService.matchesImageSignature(buffer, contentType)
    ) {
      await reject('File content does not match an allowed image format');
    }

    try {
      await this.storage.put(
        objectKey(ImagesService.BUCKET, servedPath),
        buffer!,
        contentType,
      );
    } catch (error) {
      this.logger.error(
        `Failed to store image at "${servedPath}": ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to upload image');
    }
    await this.storage
      .delete(key)
      .catch((err: Error) =>
        this.logger.error(`Could not remove staged image: ${err.message}`),
      );
  }

  /** Best-effort removal of a served image that nothing points at any more. */
  async removeImage(path: string | null | undefined): Promise<void> {
    if (!path || !ImagesService.SERVED_PATH.test(path)) return;
    await this.storage
      .delete(objectKey(ImagesService.BUCKET, path))
      .catch((err: Error) =>
        this.logger.error(`Could not remove image "${path}": ${err.message}`),
      );
  }

  /**
   * A course banner or school logo by its path inside the images area, for
   * the public image routes. Null when the path is not one of those or there
   * is no such object.
   */
  async readPublicImage(
    path: string,
  ): Promise<{ body: Readable; contentType: string; size: number | null } | null> {
    if (!ImagesService.SERVED_PATH.test(path)) return null;
    const obj = await this.storage.get(objectKey(ImagesService.BUCKET, path));
    if (!obj) return null;
    return {
      body: obj.body,
      contentType: obj.contentType || 'application/octet-stream',
      size: obj.size,
    };
  }

  private static readonly SERVED_PATH = new RegExp(
    `^(${IMAGE_AREAS.join('|')})/[A-Za-z0-9-]+\\.(jpg|png|webp)$`,
  );

  private assertAllowedType(contentType: string): void {
    if (!ImagesService.ALLOWED_TYPES.includes(contentType)) {
      throw new BadRequestException(
        `Invalid file type "${contentType}". Allowed: ${ImagesService.ALLOWED_TYPES.join(', ')}`,
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private buildPath(userId: string, ext: string): string {
    return `avatars/${userId}.${ext}`;
  }

  private safeExtension(filename: string | undefined): string {
    const raw = filename?.split('.').pop()?.toLowerCase() ?? '';
    return /^[a-z0-9]{1,8}$/.test(raw) ? raw : 'jpg';
  }

  private cacheBust(url: string): string {
    return `${url}?t=${Date.now()}`;
  }

  private async updateProfileAvatar(userId: string, publicUrl: string) {
    let data: { id: string; avatar_url: string | null };
    try {
      data = await this.prisma.user_profile.update({
        where: { id: userId },
        data: { avatar_url: publicUrl },
        select: { id: true, avatar_url: true },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update profile: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to update profile image');
    }

    this.logger.log(`Profile avatar updated: ${JSON.stringify(data)}`);

    await this.cacheService.set(
      ImagesService.cacheKey(userId),
      publicUrl,
      ImagesService.CACHE_TTL,
    );

    await this.cacheService.update<Record<string, unknown>>(
      `profile:${userId}`,
      (profile) => ({ ...profile, avatar_url: publicUrl }),
      3600 * 24 * 30,
    );
  }
}

function mb(bytes: number): string {
  return String(Math.round((bytes / 1024 / 1024) * 10) / 10);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
