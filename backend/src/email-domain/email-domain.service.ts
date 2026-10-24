import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import { isoDate, isUniqueViolation, raisedMessage } from '@/common/db-values';
import { CacheService } from '@/cache/cache.service';
import { permCacheKey } from '@/permission/permission.effective';
import { SsoRegistry } from '@/sso/sso.registry';
import { normalizeCertificate } from '@/sso/adapters/saml.adapter';
import {
  domainOfEmail,
  isFreeMailDomain,
  normalizeDomain,
  txtHasToken,
  VERIFICATION_PREFIX,
} from './email-domain.util';

/** 'any': students and staff share one domain (everyone @srmss.edu.gd). */
export type DomainAudience = 'student' | 'staff' | 'any';
/** What a signed-in account is; a stored 'any' resolves to one of these. */
export type AccountAudience = 'student' | 'staff';
export type DomainStaffRole = 'teacher' | 'member';

const DOMAIN_SELECT = {
  id: true,
  school_id: true,
  domain: true,
  audience: true,
  auto_join: true,
  staff_role: true,
  verification_token: true,
  verified_at: true,
  created_at: true,
  sso_provider: true,
  sso_required: true,
  azure_tenant_id: true,
  saml_entry_point: true,
  saml_issuer: true,
  saml_certificate: true,
} as const;

type DomainRecord = Prisma.school_email_domainGetPayload<{
  select: typeof DOMAIN_SELECT;
}>;

function toDomainRow(d: DomainRecord): DomainRow {
  return {
    ...d,
    staff_role: d.staff_role as DomainStaffRole,
    verified_at: isoDate(d.verified_at),
    created_at: isoDate(d.created_at)!,
  };
}

const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DomainRow {
  id: string;
  school_id: string;
  domain: string;
  audience: DomainAudience;
  auto_join: boolean;
  staff_role: DomainStaffRole;
  verification_token: string;
  verified_at: string | null;
  created_at: string;
  sso_provider: string | null;
  sso_required: boolean;
  azure_tenant_id: string | null;
  saml_entry_point: string | null;
  saml_issuer: string | null;
  saml_certificate: string | null;
}

/** What sign-in needs to know about an address's domain. */
export interface VerifiedDomain {
  id: string;
  schoolId: string;
  domain: string;
  audience: DomainAudience;
  autoJoin: boolean;
  ssoProvider: string | null;
  ssoRequired: boolean;
  azureTenantId: string | null;
  samlEntryPoint: string | null;
  samlIssuer: string | null;
  samlCertificate: string | null;
}

/** An https:// URL with a host, trimmed, or null. */
function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

const hasSamlConfig = (d: {
  saml_entry_point: string | null;
  saml_issuer: string | null;
  saml_certificate: string | null;
}) => !!(d.saml_entry_point && d.saml_issuer && d.saml_certificate);

export interface DomainMatch {
  domainId: string;
  domain: string;
  schoolId: string;
  schoolName: string;
  audience: AccountAudience;
  /** false: staff file a join request instead of joining outright. */
  autoJoin: boolean;
}

export type DomainJoinResult =
  | { status: 'joined'; schoolId: string; audience: AccountAudience }
  | { status: 'requested'; schoolId: string };

/**
 * Email domains a school owns, and joining a school through one.
 *
 * Signing in with an emailed code proves the person controls the address;
 * DNS verification proves the school controls the domain. Only when both hold
 * does an address put someone in a school.
 */
@Injectable()
export class EmailDomainService {
  private readonly logger = new Logger(EmailDomainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly sso: SsoRegistry,
  ) {}

  /** Local stacks cannot publish DNS for demo.test; production always checks. */
  private skipsDnsCheck(): boolean {
    return (
      process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS === 'true' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  private async adminSchool(adminUserId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, adminUserId);
    if (!schoolId)
      throw new BadRequestException('You are not assigned to a school');
    return schoolId;
  }

  private async loadOwn(schoolId: string, id: string): Promise<DomainRow> {
    const data = await this.prisma.school_email_domain.findFirst({
      where: { id, school_id: schoolId },
      select: DOMAIN_SELECT,
    });
    if (!data) throw new NotFoundException('Domain not found');
    return toDomainRow(data);
  }

  private toDomain(d: DomainRow) {
    return {
      id: d.id,
      domain: d.domain,
      audience: d.audience,
      autoJoin: d.auto_join,
      staffRole: d.staff_role,
      verified: d.verified_at !== null,
      verifiedAt: d.verified_at,
      createdAt: d.created_at,
      ssoProvider: d.sso_provider,
      ssoRequired: d.sso_required,
      azureTenantId: d.azure_tenant_id,
      samlEntryPoint: d.saml_entry_point,
      samlIssuer: d.saml_issuer,
      samlCertificate: d.saml_certificate,
      // What the admin publishes; shown until the domain is verified.
      dnsRecord: {
        type: 'TXT' as const,
        name: d.domain,
        value: `${VERIFICATION_PREFIX}${d.verification_token}`,
      },
    };
  }

  // ── admin ─────────────────────────────────────────────────────────────────

  async list(adminUserId: string) {
    const schoolId = await this.adminSchool(adminUserId);
    let data: DomainRecord[];
    try {
      data = await this.prisma.school_email_domain.findMany({
        where: { school_id: schoolId },
        select: DOMAIN_SELECT,
        orderBy: { domain: 'asc' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to list email domains: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to load email domains');
    }
    return data.map((d) => this.toDomain(toDomainRow(d)));
  }

  async add(
    adminUserId: string,
    input: {
      domain: string;
      audience: DomainAudience;
      autoJoin?: boolean;
      staffRole?: DomainStaffRole;
    },
  ) {
    const schoolId = await this.adminSchool(adminUserId);
    const domain = normalizeDomain(input.domain);
    if (!domain) {
      throw new BadRequestException('Enter a domain like riverside.edu');
    }
    if (isFreeMailDomain(domain)) {
      throw new BadRequestException(
        `${domain} is a public email provider; a school can only claim its own domain`,
      );
    }

    const taken = await this.prisma.school_email_domain.findFirst({
      where: { domain, verified_at: { not: null } },
      select: { school_id: true },
    });
    if (taken && taken.school_id !== schoolId) {
      throw new ConflictException(
        'Another school has already verified this domain',
      );
    }

    let data: DomainRecord;
    try {
      data = await this.prisma.school_email_domain.create({
        data: {
          school_id: schoolId,
          domain,
          audience: input.audience,
          // Students always join outright; staff (including on a shared
          // domain) need approval unless the admin says otherwise.
          auto_join: input.autoJoin ?? input.audience === 'student',
          staff_role: input.staffRole ?? 'teacher',
          verification_token: randomBytes(16).toString('hex'),
          created_by: adminUserId,
        },
        select: DOMAIN_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This domain is already on your list');
      }
      this.logger.error(
        `Failed to add email domain: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to add the domain');
    }
    return this.toDomain(toDomainRow(data));
  }

  async update(
    adminUserId: string,
    id: string,
    patch: {
      audience?: DomainAudience;
      autoJoin?: boolean;
      staffRole?: DomainStaffRole;
      ssoProvider?: string | null;
      ssoRequired?: boolean;
      azureTenantId?: string | null;
      samlEntryPoint?: string | null;
      samlIssuer?: string | null;
      samlCertificate?: string | null;
    },
  ) {
    const schoolId = await this.adminSchool(adminUserId);
    const row = await this.loadOwn(schoolId, id);

    const changes: Prisma.school_email_domainUncheckedUpdateInput = {};
    if (patch.audience !== undefined) changes.audience = patch.audience;
    if (patch.autoJoin !== undefined) changes.auto_join = patch.autoJoin;
    if (patch.staffRole !== undefined) changes.staff_role = patch.staffRole;

    if (patch.ssoProvider !== undefined) {
      if (patch.ssoProvider !== null && !this.sso.get(patch.ssoProvider)) {
        throw new BadRequestException('That sign-in provider is not available');
      }
      changes.sso_provider = patch.ssoProvider;
      if (patch.ssoProvider === null) changes.sso_required = false;
    }
    if (patch.azureTenantId !== undefined) {
      const tenant = patch.azureTenantId?.trim().toLowerCase() || null;
      if (tenant && !TENANT_ID.test(tenant)) {
        throw new BadRequestException(
          'The Microsoft tenant ID is a GUID like 72f988bf-86f1-41af-91ab-2d7cd011db47',
        );
      }
      changes.azure_tenant_id = tenant;
    }
    if (patch.samlEntryPoint !== undefined) {
      const raw = patch.samlEntryPoint?.trim() || null;
      const url = raw ? httpsUrl(raw) : null;
      if (raw && !url) {
        throw new BadRequestException(
          'The SAML sign-on URL must be an https:// address',
        );
      }
      changes.saml_entry_point = url;
    }
    if (patch.samlIssuer !== undefined) {
      changes.saml_issuer = patch.samlIssuer?.trim() || null;
    }
    if (patch.samlCertificate !== undefined) {
      const raw = patch.samlCertificate?.trim() || null;
      const pem = raw ? normalizeCertificate(raw) : null;
      if (raw && !pem) {
        throw new BadRequestException(
          'The SAML certificate is not a valid X.509 certificate. Paste the PEM (-----BEGIN CERTIFICATE-----) or its base64 body.',
        );
      }
      changes.saml_certificate = pem;
    }

    // The SAML connection after this update.
    const saml = {
      saml_entry_point:
        patch.samlEntryPoint !== undefined
          ? (changes.saml_entry_point as string | null)
          : row.saml_entry_point,
      saml_issuer:
        patch.samlIssuer !== undefined
          ? (changes.saml_issuer as string | null)
          : row.saml_issuer,
      saml_certificate:
        patch.samlCertificate !== undefined
          ? (changes.saml_certificate as string | null)
          : row.saml_certificate,
    };
    const provider =
      patch.ssoProvider !== undefined ? patch.ssoProvider : row.sso_provider;
    const touchesSaml =
      patch.ssoProvider !== undefined ||
      patch.samlEntryPoint !== undefined ||
      patch.samlIssuer !== undefined ||
      patch.samlCertificate !== undefined;
    if (touchesSaml && provider === 'saml' && !hasSamlConfig(saml)) {
      throw new BadRequestException(
        'Add your identity provider\'s sign-on URL, entity ID and signing certificate to use SAML',
      );
    }

    if (patch.ssoRequired !== undefined) {
      const tenant =
        patch.azureTenantId !== undefined
          ? changes.azure_tenant_id
          : row.azure_tenant_id;
      if (patch.ssoRequired) {
        // Requiring SSO before it can work would lock the whole domain out.
        if (!row.verified_at) {
          throw new BadRequestException(
            'Verify the domain before requiring single sign-on',
          );
        }
        if (!provider) {
          throw new BadRequestException('Choose a sign-in provider first');
        }
        if (provider === 'azure' && !tenant) {
          throw new BadRequestException(
            'Add your Microsoft tenant ID before requiring Microsoft sign-in',
          );
        }
        if (provider === 'saml' && !hasSamlConfig(saml)) {
          throw new BadRequestException(
            'Finish the SAML connection before requiring single sign-on',
          );
        }
      }
      changes.sso_required = patch.ssoRequired;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    let data: DomainRecord;
    try {
      data = await this.prisma.school_email_domain.update({
        where: { id },
        data: changes,
        select: DOMAIN_SELECT,
      });
    } catch {
      throw new BadRequestException('Failed to update the domain');
    }
    return this.toDomain(toDomainRow(data));
  }

  /** Removing a domain stops new joins; nobody already in is removed. */
  async remove(adminUserId: string, id: string) {
    const schoolId = await this.adminSchool(adminUserId);
    await this.loadOwn(schoolId, id);
    try {
      await this.prisma.school_email_domain.deleteMany({ where: { id } });
    } catch {
      throw new BadRequestException('Failed to remove the domain');
    }
  }

  /** Look for the TXT record and, if it is there, take the domain. */
  async verify(adminUserId: string, id: string) {
    const schoolId = await this.adminSchool(adminUserId);
    const row = await this.loadOwn(schoolId, id);
    if (row.verified_at) return this.toDomain(row);

    if (!this.skipsDnsCheck()) {
      let records: string[][] = [];
      try {
        records = await dns.resolveTxt(row.domain);
      } catch (err) {
        this.logger.warn(
          `TXT lookup for ${row.domain} failed: ${(err as Error).message}`,
        );
      }
      if (!txtHasToken(records, row.verification_token)) {
        throw new BadRequestException(
          'The TXT record was not found yet. DNS changes can take up to an hour to appear.',
        );
      }
    }

    let data: DomainRecord;
    try {
      data = await this.prisma.school_email_domain.update({
        where: { id },
        data: { verified_at: new Date() },
        select: DOMAIN_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Another school has already verified this domain',
        );
      }
      throw new BadRequestException('Failed to verify the domain');
    }
    return this.toDomain(toDomainRow(data));
  }

  // ── joining ───────────────────────────────────────────────────────────────

  /**
   * The school a signed-in user's address would put them in, if any. Only
   * users without a school, and only a domain for their kind of account: a
   * student address does not make someone staff, and the other way round.
   */
  async matchFor(
    userId: string,
    email: string | null | undefined,
  ): Promise<DomainMatch | null> {
    const domain = domainOfEmail(email);
    if (!domain) return null;

    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true, account_type: true, first_name: true },
    });
    if (!profile || profile.school_id || !profile.first_name) return null;

    const audience: AccountAudience =
      profile.account_type === 'student' ? 'student' : 'staff';

    const data = await this.prisma.school_email_domain.findFirst({
      where: {
        domain,
        audience: { in: [audience, 'any'] },
        verified_at: { not: null },
      },
      select: {
        id: true,
        domain: true,
        audience: true,
        auto_join: true,
        school_id: true,
        school: { select: { name: true, is_active: true } },
      },
    });

    const school = data?.school;
    if (!data || school?.is_active === false) return null;

    return {
      domainId: data.id,
      domain: data.domain,
      schoolId: data.school_id,
      schoolName: school?.name ?? 'your school',
      audience,
      // A student on a shared domain joins outright, like on a student one;
      // staff get whatever the domain says.
      autoJoin: audience === 'student' ? true : data.auto_join,
    };
  }

  async join(
    userId: string,
    email: string | null | undefined,
  ): Promise<DomainJoinResult> {
    const match = await this.matchFor(userId, email);
    if (!match) {
      throw new NotFoundException('No school uses your email domain');
    }
    return this.joinMatch(userId, match);
  }

  /**
   * Called after onboarding: join quietly when the address matches, and say
   * nothing when it does not. Never fails onboarding.
   */
  async tryAutoJoin(
    userId: string,
    email: string | null | undefined,
  ): Promise<DomainJoinResult | null> {
    try {
      const match = await this.matchFor(userId, email);
      return match ? await this.joinMatch(userId, match) : null;
    } catch (err) {
      this.logger.warn(
        `Auto-join by domain failed for ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async joinMatch(
    userId: string,
    match: DomainMatch,
  ): Promise<DomainJoinResult> {
    if (match.audience === 'staff' && !match.autoJoin) {
      try {
        await this.prisma.school_join_request.create({
          data: {
            user_id: userId,
            school_id: match.schoolId,
            message: `Signed in with an @${match.domain} address`,
          },
        });
      } catch (error) {
        // A pending request already exists: that is the outcome we wanted.
        if (!isUniqueViolation(error)) {
          this.logger.error(
            `Failed to file join request: ${(error as Error).message}`,
          );
          throw new BadRequestException('Failed to ask to join the school');
        }
      }
      return { status: 'requested', schoolId: match.schoolId };
    }

    const domainRow = await this.prisma.school_email_domain.findUnique({
      where: { id: match.domainId },
      select: { staff_role: true },
    });
    const staffRole =
      (domainRow?.staff_role as DomainStaffRole | undefined) ?? 'teacher';

    try {
      await this.prisma.$queryRaw`
        SELECT * FROM public.join_school_by_email_domain(
          ${userId}::uuid,
          ${match.schoolId}::uuid,
          ${match.audience}::public.email_domain_audience,
          ${staffRole}::public.role
        )`;
    } catch (error) {
      const message = raisedMessage(error);
      if (message.includes('already_in_a_school')) {
        throw new ConflictException('This account already belongs to a school');
      }
      this.logger.error(`Domain join failed for ${userId}: ${message}`);
      throw new BadRequestException('Failed to join the school');
    }

    await Promise.all([
      this.cache.delete(`profile:${userId}`),
      this.cache.delete(`student-context:${userId}`),
      this.cache.delete(`students:${match.schoolId}`),
      this.cache.delete(permCacheKey(userId, match.schoolId)),
    ]);

    this.logger.log(
      `User ${userId} joined school ${match.schoolId} as ${match.audience} via @${match.domain}`,
    );
    return {
      status: 'joined',
      schoolId: match.schoolId,
      audience: match.audience,
    };
  }

  // ── sign-in ───────────────────────────────────────────────────────────────

  /** The verified domain an address belongs to, if a school owns it. */
  async verifiedDomainFor(
    email: string | null | undefined,
  ): Promise<VerifiedDomain | null> {
    const domain = domainOfEmail(email);
    if (!domain) return null;
    const data = await this.prisma.school_email_domain.findFirst({
      where: { domain, verified_at: { not: null } },
      select: DOMAIN_SELECT,
    });
    return data ? this.toVerified(data) : null;
  }

  private toVerified(d: DomainRecord): VerifiedDomain {
    return {
      id: d.id,
      schoolId: d.school_id,
      domain: d.domain,
      audience: d.audience,
      autoJoin: d.auto_join,
      ssoProvider: d.sso_provider,
      ssoRequired: d.sso_required,
      azureTenantId: d.azure_tenant_id,
      samlEntryPoint: d.saml_entry_point,
      samlIssuer: d.saml_issuer,
      samlCertificate: d.saml_certificate,
    };
  }

  /** A verified domain by id, for finishing a sign-in started for it. */
  async verifiedDomainById(id: string): Promise<VerifiedDomain | null> {
    const d = await this.prisma.school_email_domain.findFirst({
      where: { id, verified_at: { not: null } },
      select: DOMAIN_SELECT,
    });
    return d ? this.toVerified(d) : null;
  }

  /**
   * When an address must sign in through its school's provider, which one.
   * A required provider the deployment has since turned off does not lock
   * anyone out: email codes work again until it is back.
   */
  async ssoRequirement(
    email: string | null | undefined,
  ): Promise<{ providerId: string; label: string } | null> {
    const domain = await this.verifiedDomainFor(email);
    if (!domain?.ssoRequired) return null;
    const adapter = this.sso.get(domain.ssoProvider);
    // Nor does one the school has not finished setting up.
    return adapter && adapter.readyFor(domain) ? { providerId: adapter.id, label: adapter.label } : null;
  }
}
