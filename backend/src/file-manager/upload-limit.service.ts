import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import {
  MB,
  effectiveUploadMb,
  loadUploadLimitConfig,
  type UploadLimitConfig,
} from './upload-limit.config';

/** Short, so a lowered limit applies on every instance within a minute. */
export const UPLOAD_LIMIT_TTL = 60;

const cacheKey = (schoolId: string) => `upload-limit:${schoolId}`;

/** A school's upload limit, as the API returns it. */
export interface UploadLimit {
  /** The limit uploads are checked against. */
  uploadLimitBytes: number;
  uploadLimitMb: number;
  /** The school's own setting; null means it follows the platform default. */
  maxUploadMb: number | null;
  platformMaxMb: number;
  platformDefaultMb: number;
}

/**
 * Resolves how large a file a school accepts: its `max_upload_mb`, else the
 * platform default, never above the platform ceiling. Only the school's own
 * column is cached, so an env change applies on restart.
 */
@Injectable()
export class UploadLimitService {
  private readonly logger = new Logger(UploadLimitService.name);
  readonly config: UploadLimitConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    this.config = loadUploadLimitConfig(process.env, (m) => this.logger.warn(m));
  }

  async forSchool(schoolId: string): Promise<UploadLimit> {
    return this.present(await this.schoolSetting(schoolId));
  }

  async bytesForSchool(schoolId: string): Promise<number> {
    return (await this.forSchool(schoolId)).uploadLimitBytes;
  }

  /**
   * Set (or, with null, clear) a school's limit. Above the platform ceiling is
   * a 400 rather than a silent clamp, so the admin knows what they got.
   */
  async setForSchool(schoolId: string, mb: number | null): Promise<UploadLimit> {
    if (mb !== null) {
      if (!Number.isInteger(mb) || mb < 1) {
        throw new BadRequestException(
          'The upload limit must be a whole number of MB, at least 1',
        );
      }
      if (mb > this.config.maxMb) {
        throw new BadRequestException(
          `The upload limit can't exceed the platform limit of ${this.config.maxMb} MB`,
        );
      }
    }

    try {
      await this.prisma.school.update({
        where: { id: schoolId },
        data: { max_upload_mb: mb, updated_at: new Date() },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update upload limit for ${schoolId}: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to update the upload limit');
    }
    await this.cache.delete(cacheKey(schoolId));
    return this.present(mb);
  }

  private async schoolSetting(schoolId: string): Promise<number | null> {
    const cached = await this.cache.get(cacheKey(schoolId));
    if (cached && typeof cached === 'object' && 'mb' in cached) {
      return cached.mb as number | null;
    }
    const row = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { max_upload_mb: true },
    });
    const mb = row?.max_upload_mb ?? null;
    await this.cache.set(cacheKey(schoolId), { mb }, UPLOAD_LIMIT_TTL);
    return mb;
  }

  private present(schoolMb: number | null): UploadLimit {
    const mb = effectiveUploadMb(this.config, schoolMb);
    return {
      uploadLimitBytes: mb * MB,
      uploadLimitMb: mb,
      maxUploadMb: schoolMb,
      platformMaxMb: this.config.maxMb,
      platformDefaultMb: this.config.defaultMb,
    };
  }
}
