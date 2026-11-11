import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { openSecret, sealSecret } from '@/account/secret-box';
import {
  ENGINES_NEEDING_KEY,
  TRANSLATION_KEY_AAD,
  TRANSLATION_KEY_INFO,
  type TranslationEngine,
} from './translation.constants';
import { checkLibreUrl, TranslationUrlError, type EngineConfig } from './translation-engine';
import type { TranslationSettingsDto } from './translation.dto';

const SELECT = {
  engine: true,
  url: true,
  key_enc: true,
  allow_private_network: true,
  enabled: true,
  updated_at: true,
} as const;

type Row = {
  engine: string;
  url: string | null;
  key_enc: string | null;
  allow_private_network: boolean;
  enabled: boolean;
  updated_at: Date;
};

/** What `GET /organisation/translation` answers. Never the key. */
export interface TranslationSettingsView {
  engine: TranslationEngine;
  url: string | null;
  hasKey: boolean;
  allowPrivateNetwork: boolean;
  enabled: boolean;
  updatedAt: string | null;
}

export const DEFAULT_VIEW: TranslationSettingsView = {
  engine: 'google',
  url: null,
  hasKey: false,
  allowPrivateNetwork: false,
  enabled: false,
  updatedAt: null,
};

/** The stored settings with the key decrypted (null when none, or unreadable after a server key change). */
export interface StoredTranslationSettings extends EngineConfig {
  enabled: boolean;
  /** A key is stored but cannot be decrypted. */
  keyUnreadable: boolean;
}

/**
 * The organisation's translation engine (one row). The API key is
 * write-only: sealed with secret-box on save, opened only to call the
 * engine (`stored`), answered as `hasKey`.
 */
@Injectable()
export class TranslationSettingsService {
  private readonly logger = new Logger(TranslationSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  private row(): Promise<Row | null> {
    return this.prisma.translation_setting.findUnique({ where: { id: true }, select: SELECT });
  }

  private static view(row: Row | null): TranslationSettingsView {
    if (!row) return { ...DEFAULT_VIEW };
    return {
      engine: row.engine as TranslationEngine,
      url: row.url,
      hasKey: row.key_enc !== null,
      allowPrivateNetwork: row.allow_private_network,
      enabled: row.enabled,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async get(): Promise<TranslationSettingsView> {
    return TranslationSettingsService.view(await this.row());
  }

  /** The settings to call the engine with; null when none are saved. */
  async stored(): Promise<StoredTranslationSettings | null> {
    const row = await this.row();
    if (!row) return null;
    const key = row.key_enc ? openSecret(TRANSLATION_KEY_INFO, TRANSLATION_KEY_AAD, row.key_enc) : null;
    return {
      engine: row.engine as TranslationEngine,
      url: row.url,
      key,
      allowPrivateNetwork: row.allow_private_network,
      enabled: row.enabled,
      keyUnreadable: row.key_enc !== null && key === null,
    };
  }

  async update(dto: TranslationSettingsDto, actorId: string): Promise<TranslationSettingsView> {
    const before = await this.row();
    const engine = dto.engine;
    const allowPrivate = dto.allowPrivateNetwork ?? before?.allow_private_network ?? false;

    // URL: LibreTranslate only. Omitted keeps the stored one (same engine).
    let url: string | null = null;
    if (engine === 'libre') {
      const given = dto.url === undefined ? (before?.engine === 'libre' ? before.url : null) : dto.url;
      url = given?.trim() || null;
      if (url) {
        try {
          checkLibreUrl(url, allowPrivate);
        } catch (err) {
          if (err instanceof TranslationUrlError) throw new BadRequestException(err.message);
          throw err;
        }
      }
      if (dto.enabled && !url) {
        throw new BadRequestException('LibreTranslate needs the address of its server (for example https://translate.example.org)');
      }
    }

    // Key: omitted keeps it (only for the same engine: a key belongs to its
    // engine), null or empty clears it, a value replaces it.
    let keyEnc: string | null;
    let keyChange: 'set' | 'cleared' | null = null;
    if (dto.key === undefined) {
      keyEnc = before && before.engine === engine ? before.key_enc : null;
      if (before?.key_enc && keyEnc === null) keyChange = 'cleared';
    } else {
      const key = dto.key?.trim() || null;
      keyEnc = key ? sealSecret(TRANSLATION_KEY_INFO, TRANSLATION_KEY_AAD, key) : null;
      keyChange = key ? 'set' : before?.key_enc ? 'cleared' : null;
    }
    if (dto.enabled && ENGINES_NEEDING_KEY.has(engine) && !keyEnc) {
      throw new BadRequestException(`${engine === 'deepl' ? 'DeepL' : 'Yandex'} needs an API key`);
    }

    const data = {
      engine,
      url,
      key_enc: keyEnc,
      allow_private_network: allowPrivate,
      enabled: dto.enabled,
      updated_by: actorId,
    };
    const after = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.translation_setting.upsert({
        where: { id: true },
        create: { id: true, ...data },
        update: { ...data, updated_at: new Date() },
        select: SELECT,
      });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'translation_setting',
        entityId: null,
        action: before ? 'update' : 'create',
        changes: auditChanges(
          before
            ? {
                engine: before.engine,
                url: before.url,
                allow_private_network: before.allow_private_network,
                enabled: before.enabled,
              }
            : null,
          {
            engine: saved.engine,
            url: saved.url,
            allow_private_network: saved.allow_private_network,
            enabled: saved.enabled,
            ...(keyChange === 'set' ? { api_key_changed: true } : {}),
            ...(keyChange === 'cleared' ? { api_key_cleared: true } : {}),
          },
        ),
      });
      return saved;
    });
    this.logger.log(`Organisation admin ${actorId} saved the translation settings (${after.engine}, ${after.enabled ? 'on' : 'off'})`);
    return TranslationSettingsService.view(after);
  }
}
