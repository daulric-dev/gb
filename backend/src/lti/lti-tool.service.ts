import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { isUniqueViolation } from '@/common/db-values';
import { PlatformKeyService } from './platform-key.service';
import { ToolKeyService } from './tool-key.service';
import { platformEndpoints } from './lti.constants';
import type { CreateLtiToolDto, UpdateLtiToolDto } from './dto/lti.dto';
import {
  assertPublicKeyPem,
  assertToolUrl,
  newClientId,
  newDeploymentId,
  normaliseCustomParams,
  pemFingerprint,
} from './lti-values';

const TOOL_SELECT = {
  id: true,
  name: true,
  description: true,
  client_id: true,
  login_url: true,
  target_link_uri: true,
  redirect_uris: true,
  jwks_url: true,
  public_key_pem: true,
  ags_enabled: true,
  send_name: true,
  send_email: true,
  custom_params: true,
  enabled: true,
  created_at: true,
  updated_at: true,
  deployments: {
    orderBy: { created_at: 'asc' as const },
    select: { id: true, deployment_id: true, school_id: true, school: { select: { name: true } } },
  },
  _count: { select: { resource_links: true } },
} as const;

type ToolRow = Prisma.lti_toolGetPayload<{ select: typeof TOOL_SELECT }>;

/** What the audit log keeps of a tool: no key material, a fingerprint at most. */
function auditTool(t: Omit<ToolRow, 'deployments' | '_count'>) {
  return {
    name: t.name,
    description: t.description,
    login_url: t.login_url,
    target_link_uri: t.target_link_uri,
    redirect_uris: t.redirect_uris,
    jwks_url: t.jwks_url,
    public_key_fingerprint: pemFingerprint(t.public_key_pem),
    ags_enabled: t.ags_enabled,
    send_name: t.send_name,
    send_email: t.send_email,
    custom_params: t.custom_params,
    enabled: t.enabled,
  };
}

/**
 * The organisation's tool registry. Every change is written to the
 * organisation audit log in the same transaction. GradeBook issues the
 * client id and deployment ids.
 */
@Injectable()
export class LtiToolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: PlatformKeyService,
    private readonly toolKeys: ToolKeyService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  toTool(t: ToolRow) {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      clientId: t.client_id,
      loginUrl: t.login_url,
      targetLinkUri: t.target_link_uri,
      redirectUris: t.redirect_uris,
      jwksUrl: t.jwks_url,
      publicKeyPem: t.public_key_pem,
      agsEnabled: t.ags_enabled,
      sendName: t.send_name,
      sendEmail: t.send_email,
      customParams: (t.custom_params ?? {}) as Record<string, string>,
      enabled: t.enabled,
      createdAt: t.created_at.toISOString(),
      updatedAt: t.updated_at.toISOString(),
      deployments: t.deployments.map((d) => ({
        id: d.id,
        deploymentId: d.deployment_id,
        schoolId: d.school_id,
        schoolName: d.school?.name ?? null,
      })),
      linkCount: t._count.resource_links,
    };
  }

  /** What the admin copies into the tool's configuration. */
  async platform() {
    return { ...platformEndpoints(), keys: await this.keys.summaries() };
  }

  async list() {
    const rows = await this.prisma.lti_tool.findMany({ orderBy: { name: 'asc' }, select: TOOL_SELECT });
    return rows.map((t) => this.toTool(t));
  }

  async get(id: string) {
    const row = await this.prisma.lti_tool.findUnique({ where: { id }, select: TOOL_SELECT });
    if (!row) throw new NotFoundException('Tool not found');
    return this.toTool(row);
  }

  private async assertSchools(ids: string[]) {
    if (ids.length === 0) return;
    const found = await this.prisma.school.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new NotFoundException('School not found');
  }

  async create(actorId: string, dto: CreateLtiToolDto) {
    const jwksUrl = dto.jwksUrl ? assertToolUrl(dto.jwksUrl, 'JWKS URL') : null;
    const pem = dto.publicKeyPem?.trim() ? assertPublicKeyPem(dto.publicKeyPem) : null;
    if (!jwksUrl && !pem) {
      throw new BadRequestException("Give the tool's JWKS URL or paste its public key");
    }
    const schoolIds = [...new Set(dto.schoolIds ?? [])];
    await this.assertSchools(schoolIds);

    const data = {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      client_id: newClientId(),
      login_url: assertToolUrl(dto.loginUrl, 'Login URL'),
      target_link_uri: assertToolUrl(dto.targetLinkUri, 'Launch URL'),
      redirect_uris: [...new Set(dto.redirectUris.map((u) => assertToolUrl(u, 'Redirect URL')))],
      jwks_url: jwksUrl,
      public_key_pem: pem,
      ags_enabled: dto.agsEnabled ?? false,
      send_name: dto.sendName ?? false,
      send_email: dto.sendEmail ?? false,
      custom_params: normaliseCustomParams(dto.customParams),
      enabled: dto.enabled ?? true,
      created_by: actorId,
    };
    if (!data.name) throw new BadRequestException('Give the tool a name');

    const created = await this.prisma.$transaction(async (tx) => {
      const tool = await tx.lti_tool.create({ data, select: { id: true } });
      const deployments = schoolIds.length ? schoolIds : [null];
      await tx.lti_deployment.createMany({
        data: deployments.map((schoolId) => ({
          tool_id: tool.id,
          deployment_id: newDeploymentId(),
          school_id: schoolId,
        })),
      });
      const row = await tx.lti_tool.findUniqueOrThrow({ where: { id: tool.id }, select: TOOL_SELECT });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'lti_tool',
        entityId: tool.id,
        action: 'create',
        changes: auditChanges(null, {
          ...auditTool(row),
          client_id: row.client_id,
          deployments: row.deployments.map((d) => ({ deployment_id: d.deployment_id, school_id: d.school_id })),
        }),
      });
      return row;
    });
    return this.toTool(created);
  }

  async update(actorId: string, id: string, dto: UpdateLtiToolDto) {
    const patch: Prisma.lti_toolUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Give the tool a name');
      patch.name = name;
    }
    if (dto.description !== undefined) patch.description = dto.description?.trim() || null;
    if (dto.loginUrl !== undefined) patch.login_url = assertToolUrl(dto.loginUrl, 'Login URL');
    if (dto.targetLinkUri !== undefined) patch.target_link_uri = assertToolUrl(dto.targetLinkUri, 'Launch URL');
    if (dto.redirectUris !== undefined) {
      patch.redirect_uris = [...new Set(dto.redirectUris.map((u) => assertToolUrl(u, 'Redirect URL')))];
    }
    if (dto.jwksUrl !== undefined) patch.jwks_url = dto.jwksUrl ? assertToolUrl(dto.jwksUrl, 'JWKS URL') : null;
    if (dto.publicKeyPem !== undefined) {
      patch.public_key_pem = dto.publicKeyPem?.trim() ? assertPublicKeyPem(dto.publicKeyPem) : null;
    }
    if (dto.agsEnabled !== undefined) patch.ags_enabled = dto.agsEnabled;
    if (dto.sendName !== undefined) patch.send_name = dto.sendName;
    if (dto.sendEmail !== undefined) patch.send_email = dto.sendEmail;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.customParams !== undefined) patch.custom_params = normaliseCustomParams(dto.customParams);
    if (Object.keys(patch).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.lti_tool.findUnique({ where: { id }, select: TOOL_SELECT });
      if (!before) throw new NotFoundException('Tool not found');
      const jwks = patch.jwks_url !== undefined ? patch.jwks_url : before.jwks_url;
      const pem = patch.public_key_pem !== undefined ? patch.public_key_pem : before.public_key_pem;
      if (!jwks && !pem) {
        throw new BadRequestException("Give the tool's JWKS URL or paste its public key");
      }
      const after = await tx.lti_tool.update({
        where: { id },
        data: { ...patch, updated_at: new Date() },
        select: TOOL_SELECT,
      });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'lti_tool',
        entityId: id,
        action: 'update',
        changes: auditChanges(auditTool(before), auditTool(after)),
      });
      return after;
    });
    // New keys or a new JWKS URL take effect now.
    this.toolKeys.forget(id);
    // Tokens issued under the old scopes go when AGS is switched off.
    if (dto.agsEnabled === false || dto.enabled === false) {
      await this.prisma.lti_access_token.deleteMany({ where: { tool_id: id } });
    }
    return this.toTool(updated);
  }

  async remove(actorId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.lti_tool.findUnique({ where: { id }, select: TOOL_SELECT });
      if (!before) throw new NotFoundException('Tool not found');
      if (before._count.resource_links > 0) {
        throw new ConflictException(
          'This tool is used in course modules. Remove those items first, or switch the tool off instead.',
        );
      }
      await tx.lti_tool.delete({ where: { id } });
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'lti_tool',
        entityId: id,
        action: 'delete',
        changes: auditChanges({ ...auditTool(before), client_id: before.client_id }, null),
      });
    });
    this.toolKeys.forget(id);
  }

  async addDeployment(actorId: string, toolId: string, schoolId: string | null) {
    if (schoolId) await this.assertSchools([schoolId]);
    try {
      await this.prisma.$transaction(async (tx) => {
        const tool = await tx.lti_tool.findUnique({ where: { id: toolId }, select: { id: true } });
        if (!tool) throw new NotFoundException('Tool not found');
        const created = await tx.lti_deployment.create({
          data: { tool_id: toolId, deployment_id: newDeploymentId(), school_id: schoolId },
        });
        await this.auditLog?.record(tx, schoolId, { id: actorId }, {
          entity: 'lti_deployment',
          entityId: created.id,
          action: 'create',
          changes: auditChanges(null, { tool_id: toolId, deployment_id: created.deployment_id, school_id: schoolId }),
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          schoolId ? 'The tool is already deployed to that school' : 'The tool already has an all-schools deployment',
        );
      }
      throw error;
    }
    return this.get(toolId);
  }

  async removeDeployment(actorId: string, toolId: string, deploymentId: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.lti_deployment.findFirst({
        where: { id: deploymentId, tool_id: toolId },
        select: { id: true, deployment_id: true, school_id: true, _count: { select: { resource_links: true } } },
      });
      if (!row) throw new NotFoundException('Deployment not found');
      if (row._count.resource_links > 0) {
        throw new ConflictException('Course modules launch through this deployment. Remove those items first.');
      }
      await tx.lti_deployment.delete({ where: { id: row.id } });
      await this.auditLog?.record(tx, row.school_id, { id: actorId }, {
        entity: 'lti_deployment',
        entityId: row.id,
        action: 'delete',
        changes: auditChanges({ tool_id: toolId, deployment_id: row.deployment_id, school_id: row.school_id }, null),
      });
    });
    return this.get(toolId);
  }

  async rotateKey(actorId: string) {
    const { kid, retired } = await this.keys.rotate();
    await this.prisma.$transaction(async (tx) => {
      await this.auditLog?.record(tx, null, { id: actorId }, {
        entity: 'lti_platform_key',
        entityId: null,
        action: 'update',
        changes: auditChanges({ active_kid: retired }, { active_kid: kid }),
      });
    });
    return this.platform();
  }
}
