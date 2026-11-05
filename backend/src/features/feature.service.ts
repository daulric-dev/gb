import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import {
  FEATURES,
  effectiveForOrganisation,
  effectiveForSchool,
  featureDefinition,
  isFeatureKey,
  organisationSettings,
  type FeatureKey,
  type FeatureMap,
} from './feature.catalog';
import { FeatureDisabledException } from './feature-disabled.exception';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';

/** Short: a change is invalidated on this replica, and others catch up. */
const FEATURE_TTL = 30; // seconds
const ORG_KEY = 'features:org';
const schoolKey = (schoolId: string) => `features:school:${schoolId}`;

export interface OrganisationFeatureRow {
  key: FeatureKey;
  label: string;
  description: string;
  /** The organisation's own setting (its override, else the default). */
  enabled: boolean;
  default: boolean;
  requires: FeatureKey[];
}

export interface SchoolFeatureRow {
  key: FeatureKey;
  label: string;
  description: string;
  /** Effective for the organisation: its setting and its requirements. */
  availableInOrganisation: boolean;
  /** The school admin has not switched it off. */
  enabledForSchool: boolean;
  /** What the school actually gets. */
  effective: boolean;
  requires: FeatureKey[];
}

export type FeaturePatch = Record<string, unknown>;

/**
 * Which platform features are on: the organisation's settings over the
 * catalog defaults, narrowed by what each school switched off. Lookups are
 * cached briefly and dropped on every change.
 */
@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly auditLog?: AuditLogService,
  ) {}

  // --- lookups ---------------------------------------------------------------

  /** Effective features for a school, or for the organisation without one. */
  async effective(schoolId: string | null | undefined): Promise<FeatureMap> {
    const org = await this.organisationSettings();
    if (!schoolId) return effectiveForOrganisation(org);
    return effectiveForSchool(org, await this.schoolDisabled(schoolId));
  }

  async isEnabled(
    schoolId: string | null | undefined,
    key: FeatureKey,
  ): Promise<boolean> {
    return (await this.effective(schoolId))[key];
  }

  /** Throws the FEATURE_DISABLED 403 when `key` is off. */
  async assertEnabled(
    schoolId: string | null | undefined,
    key: FeatureKey,
  ): Promise<void> {
    if (!(await this.isEnabled(schoolId, key))) {
      throw new FeatureDisabledException(key);
    }
  }

  /** The school a user works in: their active school, or a student's own. */
  async schoolOfUser(userId: string): Promise<string | null> {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true, account_type: true },
    });
    if (profile?.school_id) return profile.school_id;
    if (profile?.account_type !== 'student') return null;
    const student = await this.prisma.student.findFirst({
      where: { user_profile_id: userId },
      select: { school_id: true },
    });
    return student?.school_id ?? null;
  }

  // --- organisation ----------------------------------------------------------

  async organisationFeatures(): Promise<OrganisationFeatureRow[]> {
    const org = await this.organisationSettings();
    return FEATURES.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      enabled: org[f.key],
      default: f.default,
      requires: [...f.requires],
    }));
  }

  /** Merge `{ key: boolean }` into the organisation's overrides. */
  async updateOrganisationFeatures(
    patch: FeaturePatch,
    actorId?: string,
  ): Promise<OrganisationFeatureRow[]> {
    const changes = validatePatch(patch);
    const org = await this.prisma.organisation.findFirst({
      select: { id: true, features: true },
    });
    if (!org) throw new NotFoundException('GradeBook is not set up yet');

    // Keep only known keys; unknown ones from older versions drop out.
    const current = organisationSettings(org.features);
    const stored: Record<string, boolean> = {};
    const raw = (org.features ?? {}) as Record<string, unknown>;
    for (const f of FEATURES) {
      if (typeof raw[f.key] === 'boolean') stored[f.key] = current[f.key];
    }
    Object.assign(stored, changes);

    const before = organisationSettings(org.features);
    await this.prisma.$transaction(async (tx) => {
      await tx.organisation.update({
        where: { id: org.id },
        data: {
          features: stored,
          updated_at: new Date(),
        },
      });
      if (actorId) {
        const keys = Object.keys(changes) as FeatureKey[];
        await this.auditLog?.record(
          tx,
          null,
          { id: actorId },
          {
            entity: 'platform_features',
            entityId: org.id,
            action: 'update',
            changes: auditChanges(
              Object.fromEntries(keys.map((key) => [key, before[key]])),
              Object.fromEntries(keys.map((key) => [key, changes[key]])),
            ),
          },
        );
      }
    });
    this.logger.log(
      `Organisation features changed: ${JSON.stringify(changes)}`,
    );
    await this.invalidate();
    return this.organisationFeatures();
  }

  // --- school ----------------------------------------------------------------

  async schoolFeatures(schoolId: string): Promise<SchoolFeatureRow[]> {
    const org = await this.organisationSettings();
    const disabled = await this.schoolDisabled(schoolId);
    const available = effectiveForOrganisation(org);
    const effective = effectiveForSchool(org, disabled);
    const off = new Set(disabled);
    return FEATURES.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      availableInOrganisation: available[f.key],
      enabledForSchool: !off.has(f.key),
      effective: effective[f.key],
      requires: [...f.requires],
    }));
  }

  /**
   * Switch features off (false) or back on (true) for a school. A school can
   * never switch on what the organisation does not allow.
   */
  async updateSchoolFeatures(
    schoolId: string,
    patch: FeaturePatch,
    actorId?: string,
  ): Promise<SchoolFeatureRow[]> {
    const changes = validatePatch(patch);
    const available = effectiveForOrganisation(
      await this.organisationSettings(),
    );
    for (const [key, on] of Object.entries(changes) as [
      FeatureKey,
      boolean,
    ][]) {
      if (on && !available[key]) {
        throw new BadRequestException(
          `${featureDefinition(key).label} is turned off for your organisation`,
        );
      }
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { disabled_features: true },
    });
    if (!school) throw new NotFoundException('School not found');

    const off = new Set(school.disabled_features.filter(isFeatureKey));
    for (const [key, on] of Object.entries(changes)) {
      if (on) off.delete(key as FeatureKey);
      else off.add(key as FeatureKey);
    }
    const before = Object.fromEntries(
      Object.keys(changes).map((key) => [
        key,
        !school.disabled_features.includes(key),
      ]),
    );
    const after = Object.fromEntries(
      Object.keys(changes).map((key) => [key, changes[key]]),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.school.update({
        where: { id: schoolId },
        data: {
          disabled_features: FEATURES.map((f) => f.key).filter((k) =>
            off.has(k),
          ),
          updated_at: new Date(),
        },
      });
      if (actorId) {
        await this.auditLog?.record(
          tx,
          schoolId,
          { id: actorId },
          {
            entity: 'school_features',
            entityId: schoolId,
            action: 'update',
            changes: auditChanges(before, after),
          },
        );
      }
    });
    this.logger.log(
      `School ${schoolId} features changed: ${JSON.stringify(changes)}`,
    );
    await this.invalidate(schoolId);
    return this.schoolFeatures(schoolId);
  }

  // --- internals -------------------------------------------------------------

  private async organisationSettings(): Promise<FeatureMap> {
    const cached = (await this.cache.get(ORG_KEY)) as FeatureMap | null;
    if (cached && typeof cached === 'object') return cached;
    const org = await this.prisma.organisation.findFirst({
      select: { features: true },
    });
    const settings = organisationSettings(org?.features);
    await this.cache.set(ORG_KEY, settings, FEATURE_TTL);
    return settings;
  }

  private async schoolDisabled(schoolId: string): Promise<string[]> {
    const key = schoolKey(schoolId);
    const cached = (await this.cache.get(key)) as string[] | null;
    if (Array.isArray(cached)) return cached;
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { disabled_features: true },
    });
    const disabled = school?.disabled_features ?? [];
    await this.cache.set(key, disabled, FEATURE_TTL);
    return disabled;
  }

  /** Drop cached settings and every profile (profiles carry `features`). */
  private async invalidate(schoolId?: string) {
    await Promise.all([
      schoolId
        ? this.cache.delete(schoolKey(schoolId))
        : this.cache.deleteByPrefix('features:'),
      this.cache.delete(ORG_KEY),
      this.cache.deleteByPrefix('profile:'),
    ]);
  }
}

/** `{ key: boolean }` with only catalog keys; 400 otherwise. */
function validatePatch(patch: FeaturePatch): Partial<FeatureMap> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new BadRequestException('features must be an object of feature keys');
  }
  const out: Partial<FeatureMap> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!isFeatureKey(key)) {
      throw new BadRequestException(`Unknown feature: ${key}`);
    }
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`${key} must be true or false`);
    }
    out[key] = value;
  }
  return out;
}
