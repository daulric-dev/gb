import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { openSecret, sealSecret } from '@/account/secret-box';
import { checkEndpointUrl, OneRosterClient, OneRosterError, type ClientDeps } from './oneroster-client';
import { readSettings, type RosterSettings } from './roster-settings';
import {
  ROSTER_SECRET_INFO,
  ROSTER_UPLOAD_MAX_BYTES,
  ROSTER_UPLOAD_PREFIX,
  rosterSecretAad,
} from './rostering.constants';
import type {
  CreateRosterSourceDto,
  RosterSettingsDto,
  RosterUploadTicketDto,
  UpdateRosterSourceDto,
} from './dto/rostering.dto';

export const SOURCE_SELECT = {
  id: true,
  name: true,
  kind: true,
  base_url: true,
  token_url: true,
  client_id: true,
  client_secret_enc: true,
  settings: true,
  schedule: true,
  auto_apply: true,
  last_scheduled_at: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} as const;

export type SourceRow = Prisma.roster_sourceGetPayload<{ select: typeof SOURCE_SELECT }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rostering sources: CRUD, the encrypted OAuth2 client secret (write-only:
 * responses carry `hasSecret` / `secretUnreadable`, never the value), "test
 * connection", and presigned upload tickets for CSV sources.
 */
@Injectable()
export class RosterSourceService {
  private readonly logger = new Logger(RosterSourceService.name);
  /** Tests swap the OneRoster client's transport. */
  clientDeps: ClientDeps = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  view(s: SourceRow) {
    const secret = s.client_secret_enc ? openSecret(ROSTER_SECRET_INFO, rosterSecretAad(s.id), s.client_secret_enc) : null;
    return {
      id: s.id,
      name: s.name,
      kind: s.kind as 'csv' | 'oneroster_api',
      baseUrl: s.base_url,
      tokenUrl: s.token_url,
      clientId: s.client_id,
      hasSecret: !!s.client_secret_enc,
      secretUnreadable: !!s.client_secret_enc && secret === null,
      settings: readSettings(s.settings),
      schedule: s.schedule as 'off' | 'daily',
      autoApply: s.auto_apply,
      lastScheduledAt: s.last_scheduled_at?.toISOString() ?? null,
      createdAt: s.created_at.toISOString(),
      updatedAt: s.updated_at.toISOString(),
    };
  }

  async list() {
    const rows = await this.prisma.roster_source.findMany({ select: SOURCE_SELECT, orderBy: { created_at: 'asc' } });
    const last = await Promise.all(
      rows.map((r) =>
        this.prisma.roster_run.findFirst({
          where: { source_id: r.id },
          orderBy: { created_at: 'desc' },
          select: { id: true, status: true, created_at: true, finished_at: true, summary: true, trigger: true },
        }),
      ),
    );
    return rows.map((r, i) => ({
      ...this.view(r),
      lastRun: last[i]
        ? {
            id: last[i].id,
            status: last[i].status,
            trigger: last[i].trigger,
            createdAt: last[i].created_at.toISOString(),
            finishedAt: last[i].finished_at?.toISOString() ?? null,
          }
        : null,
    }));
  }

  async require(id: string): Promise<SourceRow> {
    const row = await this.prisma.roster_source.findUnique({ where: { id }, select: SOURCE_SELECT });
    if (!row) throw new NotFoundException('Rostering source not found');
    return row;
  }

  async get(id: string) {
    return this.view(await this.require(id));
  }

  private async cleanSettings(current: RosterSettings, patch: RosterSettingsDto | undefined): Promise<RosterSettings> {
    if (!patch) return current;
    const next = readSettings({ ...current, ...patch, matchBy: { ...current.matchBy, ...(patch.matchBy ?? {}) } });
    if (patch.orgMap) {
      const ids = new Set<string>();
      for (const [org, school] of Object.entries(patch.orgMap)) {
        if (org.length > 255) throw new BadRequestException('An org id is too long');
        if (school !== null && (typeof school !== 'string' || !UUID.test(school))) {
          throw new BadRequestException(`The school for org ${org} is not a school id`);
        }
        if (school) ids.add(school.toLowerCase());
      }
      if (ids.size) {
        const found = await this.prisma.school.count({ where: { id: { in: [...ids] } } });
        if (found !== ids.size) throw new BadRequestException('A mapped school does not exist');
      }
      next.orgMap = Object.fromEntries(
        Object.entries(patch.orgMap).map(([k, v]) => [k, v === null ? null : v.toLowerCase()]),
      );
    }
    return next;
  }

  private checkApi(input: { baseUrl?: string | null; tokenUrl?: string | null; clientId?: string | null }) {
    try {
      if (!input.baseUrl) throw new OneRosterError('The endpoint URL is required');
      if (!input.tokenUrl) throw new OneRosterError('The token URL is required');
      if (!input.clientId) throw new OneRosterError('The client ID is required');
      checkEndpointUrl(input.baseUrl, 'endpoint URL');
      checkEndpointUrl(input.tokenUrl, 'token URL');
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  async create(dto: CreateRosterSourceDto, actorId: string) {
    const api = dto.kind === 'oneroster_api';
    if (api) {
      this.checkApi(dto);
      if (!dto.clientSecret) throw new BadRequestException('The client secret is required');
    }
    if (!api && dto.schedule === 'daily') {
      throw new BadRequestException('Only a OneRoster endpoint can sync on a schedule; CSV sources sync when you upload');
    }
    const settings = await this.cleanSettings(readSettings({}), dto.settings);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roster_source.create({
        data: {
          name: dto.name.trim(),
          kind: dto.kind,
          base_url: api ? dto.baseUrl!.trim() : null,
          token_url: api ? dto.tokenUrl!.trim() : null,
          client_id: api ? dto.clientId!.trim() : null,
          settings: settings as unknown as Prisma.InputJsonObject,
          schedule: api ? (dto.schedule ?? 'off') : 'off',
          auto_apply: dto.autoApply ?? false,
          created_by: actorId,
        },
        select: { id: true },
      });
      const updated = await tx.roster_source.update({
        where: { id: created.id },
        data: api
          ? { client_secret_enc: sealSecret(ROSTER_SECRET_INFO, rosterSecretAad(created.id), dto.clientSecret!) }
          : {},
        select: SOURCE_SELECT,
      });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'roster_source',
        entityId: created.id,
        action: 'create',
        changes: auditChanges(null, {
          name: updated.name,
          kind: updated.kind,
          base_url: updated.base_url,
          token_url: updated.token_url,
          client_id: updated.client_id,
          schedule: updated.schedule,
          auto_apply: updated.auto_apply,
        }),
      });
      return updated;
    });
    this.logger.log(`Organisation admin ${actorId} added rostering source ${row.id} (${row.kind})`);
    return this.view(row);
  }

  async update(id: string, dto: UpdateRosterSourceDto, actorId: string) {
    const before = await this.require(id);
    const api = before.kind === 'oneroster_api';
    const data: Prisma.roster_sourceUpdateInput = { updated_at: new Date() };
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (api) {
      const next = {
        baseUrl: dto.baseUrl?.trim() ?? before.base_url,
        tokenUrl: dto.tokenUrl?.trim() ?? before.token_url,
        clientId: dto.clientId?.trim() ?? before.client_id,
      };
      this.checkApi(next);
      data.base_url = next.baseUrl;
      data.token_url = next.tokenUrl;
      data.client_id = next.clientId;
      if (dto.clientSecret) data.client_secret_enc = sealSecret(ROSTER_SECRET_INFO, rosterSecretAad(id), dto.clientSecret);
    } else if (dto.baseUrl || dto.tokenUrl || dto.clientId || dto.clientSecret) {
      throw new BadRequestException('A CSV source has no endpoint or credentials');
    }
    if (dto.schedule !== undefined) {
      if (!api && dto.schedule === 'daily') {
        throw new BadRequestException('Only a OneRoster endpoint can sync on a schedule; CSV sources sync when you upload');
      }
      data.schedule = dto.schedule;
    }
    if (dto.autoApply !== undefined) data.auto_apply = dto.autoApply;
    if (dto.settings) {
      data.settings = (await this.cleanSettings(readSettings(before.settings), dto.settings)) as unknown as Prisma.InputJsonObject;
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const after = await tx.roster_source.update({ where: { id }, data, select: SOURCE_SELECT });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'roster_source',
        entityId: id,
        action: 'update',
        changes: auditChanges(
          {
            name: before.name, base_url: before.base_url, token_url: before.token_url, client_id: before.client_id,
            schedule: before.schedule, auto_apply: before.auto_apply, settings: before.settings,
          },
          {
            name: after.name, base_url: after.base_url, token_url: after.token_url, client_id: after.client_id,
            schedule: after.schedule, auto_apply: after.auto_apply, settings: after.settings,
            ...(dto.clientSecret ? { client_secret_changed: true } : {}),
          },
        ),
      });
      return after;
    });
    return this.view(row);
  }

  /** Removes the source, its links and run history. GradeBook records it created stay. */
  async remove(id: string, actorId: string) {
    const before = await this.require(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.roster_source.delete({ where: { id } });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'roster_source',
        entityId: id,
        action: 'delete',
        changes: auditChanges({ name: before.name, kind: before.kind }, null),
      });
    });
  }

  /** The OneRoster client for a stored source (secret decrypted here only). */
  clientFor(s: SourceRow): OneRosterClient {
    if (s.kind !== 'oneroster_api' || !s.base_url || !s.token_url || !s.client_id || !s.client_secret_enc) {
      throw new BadRequestException('This source has no OneRoster endpoint');
    }
    const secret = openSecret(ROSTER_SECRET_INFO, rosterSecretAad(s.id), s.client_secret_enc);
    if (secret === null) {
      throw new BadRequestException('The stored client secret cannot be read (the server key changed); enter it again');
    }
    return new OneRosterClient(
      { baseUrl: s.base_url, tokenUrl: s.token_url, clientId: s.client_id, clientSecret: secret, scope: readSettings(s.settings).scope },
      this.clientDeps,
    );
  }

  /**
   * Test a saved source. Only saved sources can be tested: the endpoint URLs
   * were validated and stored (behind step-up) when the source was saved, so
   * no request body ever reaches an outbound request directly.
   */
  async testConnection(sourceId: string) {
    let client: OneRosterClient;
    try {
      client = this.clientFor(await this.require(sourceId));
      const out = await client.test();
      return { ok: true as const, message: `Connected: the server answered with ${out.orgs} org${out.orgs === 1 ? '' : 's'} on the first page.` };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      return { ok: false as const, message: (err as Error).message };
    }
  }

  async uploadTicket(sourceId: string, dto: RosterUploadTicketDto) {
    const source = await this.require(sourceId);
    if (source.kind !== 'csv') throw new BadRequestException('Only CSV sources take uploads');
    if (dto.size > ROSTER_UPLOAD_MAX_BYTES) throw new BadRequestException('The file is too large');
    const ext = /\.zip$/i.test(dto.filename) ? 'zip' : 'csv';
    const base = dto.filename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'roster';
    const key = `${ROSTER_UPLOAD_PREFIX}${sourceId}/${randomBytes(12).toString('hex')}-${base}.${ext}`;
    const url = await this.storage.uploadUrl(key, dto.contentType, 600, dto.size);
    return { key, method: 'PUT' as const, uploadUrl: url, headers: { 'Content-Type': dto.contentType } };
  }
}
