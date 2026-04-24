import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "../supabase/supabase.service";
import { CacheService } from "../cache/cache.service";
import { MultipartFile } from "@fastify/multipart";

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024;
  private static readonly ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  private static readonly BUCKET = 'images';
  private static readonly TUS_CHUNK_SIZE = 6 * 1024 * 1024; // Supabase requires 6MB chunks
  private static readonly CACHE_TTL = 3600; // 1 hour
  private static cacheKey(userId: string) { return `avatar:${userId}`; }

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {}

  async getImageFromUserProfile(userId: string): Promise<{ blob: Blob; contentType: string }> {
    const key = ImagesService.cacheKey(userId);

    let avatarUrl: string = (await this.cacheService.get(key)) as string;

    if (!avatarUrl) {
      const supabase = this.supabaseService.getServiceClient();
      const { data: profile, error: profileError } = await supabase
        .from('user_profile')
        .select('avatar_url')
        .eq('id', userId)
        .single();

      if (profileError || !profile?.avatar_url) {
        this.logger.error(`Failed to get avatar URL: ${profileError?.message ?? 'No avatar set'}`);
        throw new BadRequestException('No avatar found for this user');
      }

      avatarUrl = profile.avatar_url;
      await this.cacheService.set(key, avatarUrl, ImagesService.CACHE_TTL);
    }

    const storagePath = this.extractStoragePath(avatarUrl);
    const supabase = this.supabaseService.getServiceClient();
    const storageBucket = supabase.storage.from(ImagesService.BUCKET);

    const { data, error } = await storageBucket.download(storagePath);

    if (error || !data) {
      this.logger.error(`Failed to download avatar: ${error?.message}`);
      throw new BadRequestException('Failed to download avatar image');
    }

    const contentType = data.type || 'application/octet-stream';

    return { blob: data, contentType };
  }

  private extractStoragePath(publicUrl: string): string {
    const marker = `/object/public/${ImagesService.BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) {
      throw new BadRequestException('Invalid avatar URL format');
    }
    const raw = publicUrl.slice(idx + marker.length);
    return raw.split('?')[0];
  }

  // ── Standard upload (small files, backend-mediated) ─────────────────

  async setImageToUserProfile(userId: string, file: MultipartFile, pathname?: string) {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > ImagesService.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`,
      );
    }

    if (file.mimetype && !ImagesService.ALLOWED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type "${file.mimetype}". Allowed: ${ImagesService.ALLOWED_TYPES.join(', ')}`,
      );
    }

    const ext = file.filename?.split('.').pop() ?? 'jpg';
    const path = this.buildPath(userId, ext, pathname);

    const supabase = this.supabaseService.getServiceClient();
    const storageBucket = supabase.storage.from(ImagesService.BUCKET);

    this.logger.log(`Uploading to bucket "${ImagesService.BUCKET}" at path "${path}" (${buffer.byteLength} bytes, ${file.mimetype})`);

    const { data: uploadData, error: uploadError } = await storageBucket.upload(path, buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

    if (uploadError) {
      this.logger.error(`Failed to upload avatar: ${uploadError.message}`);
      throw new BadRequestException('Failed to upload image');
    }

    this.logger.log(`Upload successful: ${JSON.stringify(uploadData)}`);

    const { data: { publicUrl } } = storageBucket.getPublicUrl(path);
    const avatarUrl = this.cacheBust(publicUrl);
    this.logger.log(`Public URL: ${avatarUrl}`);

    await this.updateProfileAvatar(userId, avatarUrl);

    return { avatar_url: avatarUrl };
  }

  // ── Resumable upload (TUS protocol via Supabase Storage) ────────────

  /**
   * Creates a signed upload URL for the client to use with the TUS protocol.
   * The client uploads directly to Supabase — no chunks pass through the backend.
   *
   * Flow:
   *  1. Client calls this endpoint to get TUS credentials
   *  2. Client uses tus-js-client / Uppy to upload directly to Supabase
   *  3. Client calls `completeResumableUpload` to update the profile
   */
  async createResumableUpload(
    userId: string,
    filename: string,
    contentType: string,
    totalSize: number,
    pathname?: string,
  ) {
    if (totalSize > ImagesService.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large (${(totalSize / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`,
      );
    }

    if (!ImagesService.ALLOWED_TYPES.includes(contentType)) {
      throw new BadRequestException(
        `Invalid file type "${contentType}". Allowed: ${ImagesService.ALLOWED_TYPES.join(', ')}`,
      );
    }

    const ext = filename.split('.').pop() ?? 'jpg';
    const path = this.buildPath(userId, ext, pathname);

    const supabase = this.supabaseService.getServiceClient();
    const storageBucket = supabase.storage.from(ImagesService.BUCKET);

    const { data, error } = await storageBucket.createSignedUploadUrl(path, {
      upsert: true,
    });

    if (error || !data) {
      this.logger.error(`Failed to create signed upload URL: ${error?.message}`);
      throw new BadRequestException('Failed to create upload session');
    }

    const supabaseUrl = this.configService.get<string>('SUPABASE_URL')!;
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const tusEndpoint = `https://${projectRef}.supabase.co/storage/v1/upload/resumable`;

    return {
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      tusEndpoint,
      tusHeaders: {
        authorization: `Bearer ${data.token}`,
        'x-upsert': 'true',
      },
      tusMetadata: {
        bucketName: ImagesService.BUCKET,
        objectName: path,
        contentType,
        cacheControl: '3600',
      },
      chunkSize: ImagesService.TUS_CHUNK_SIZE,
    };
  }

  /**
   * After the client finishes the TUS upload, call this to update the
   * user profile with the public URL of the uploaded image.
   */
  async completeResumableUpload(userId: string, path: string) {
    const supabase = this.supabaseService.getServiceClient();
    const storageBucket = supabase.storage.from(ImagesService.BUCKET);

    const { data: exists } = await storageBucket.exists(path);
    if (!exists) {
      throw new BadRequestException(
        `File at "${path}" not found. Upload may not be complete yet.`,
      );
    }

    const { data: { publicUrl } } = storageBucket.getPublicUrl(path);
    const avatarUrl = this.cacheBust(publicUrl);

    await this.updateProfileAvatar(userId, avatarUrl);

    return { avatar_url: avatarUrl };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private buildPath(userId: string, ext: string, pathname?: string): string {
    if (pathname == null || pathname === '') return `avatars/${userId}.${ext}`;
    if (typeof pathname !== 'string') {
      throw new BadRequestException('Invalid pathname parameter');
    }

    let dir = pathname;
    while (dir.endsWith('/')) dir = dir.slice(0, -1);
    return `${dir}/${userId}.${ext}`;
  }

  private cacheBust(url: string): string {
    return `${url}?t=${Date.now()}`;
  }

  private async updateProfileAvatar(userId: string, publicUrl: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('user_profile')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)
      .select('id, avatar_url')
      .single();

    if (error) {
      this.logger.error(`Failed to update profile: ${error.message}`);
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
