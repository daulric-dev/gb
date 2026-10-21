import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { permCacheKey } from '@/permission/permission.effective';
import { SsoRegistry } from '@/sso/sso.registry';
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

const DOMAIN_COLUMNS =
  'id, school_id, domain, audience, auto_join, staff_role, verification_token, verified_at, created_at, sso_provider, sso_required, azure_tenant_id';

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
}

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
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
    private readonly sso: SsoRegistry,
  ) {}

  private db() {
    return this.supabaseService.getServiceClient();
  }

  /** Local stacks cannot publish DNS for demo.test; production always checks. */
  private skipsDnsCheck(): boolean {
    return (
      process.env.ALLOW_UNVERIFIED_EMAIL_DOMAINS === 'true' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  private async adminSchool(adminUserId: string): Promise<string> {
    const schoolId = await this.supabaseService.getUserSchoolId(adminUserId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    return schoolId;
  }

  private async loadOwn(schoolId: string, id: string): Promise<DomainRow> {
    const { data } = await this.db()
      .from('school_email_domain')
      .select(DOMAIN_COLUMNS)
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Domain not found');
    return data;
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
    const { data, error } = await this.db()
      .from('school_email_domain')
      .select(DOMAIN_COLUMNS)
      .eq('school_id', schoolId)
      .order('domain', { ascending: true });

    if (error) {
      this.logger.error(`Failed to list email domains: ${error.message}`);
      throw new BadRequestException('Failed to load email domains');
    }
    return (data ?? []).map((d) => this.toDomain(d));
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

    const { data: taken } = await this.db()
      .from('school_email_domain')
      .select('school_id')
      .eq('domain', domain)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (taken && taken.school_id !== schoolId) {
      throw new ConflictException('Another school has already verified this domain');
    }

    const { data, error } = await this.db()
      .from('school_email_domain')
      .insert({
        school_id: schoolId,
        domain,
        audience: input.audience,
        // Students always join outright; staff (including on a shared
        // domain) need approval unless the admin says otherwise.
        auto_join: input.autoJoin ?? input.audience === 'student',
        staff_role: input.staffRole ?? 'teacher',
        verification_token: randomBytes(16).toString('hex'),
        created_by: adminUserId,
      })
      .select(DOMAIN_COLUMNS)
      .single();

    if (error?.code === '23505') {
      throw new ConflictException('This domain is already on your list');
    }
    if (error || !data) {
      this.logger.error(`Failed to add email domain: ${error?.message}`);
      throw new BadRequestException('Failed to add the domain');
    }
    return this.toDomain(data);
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
    },
  ) {
    const schoolId = await this.adminSchool(adminUserId);
    const row = await this.loadOwn(schoolId, id);

    const changes: Record<string, unknown> = {};
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
    if (patch.ssoRequired !== undefined) {
      const provider =
        patch.ssoProvider !== undefined ? patch.ssoProvider : row.sso_provider;
      const tenant =
        patch.azureTenantId !== undefined ? changes.azure_tenant_id : row.azure_tenant_id;
      if (patch.ssoRequired) {
        // Requiring SSO before it can work would lock the whole domain out.
        if (!row.verified_at) {
          throw new BadRequestException('Verify the domain before requiring single sign-on');
        }
        if (!provider) {
          throw new BadRequestException('Choose a sign-in provider first');
        }
        if (provider === 'azure' && !tenant) {
          throw new BadRequestException(
            'Add your Microsoft tenant ID before requiring Microsoft sign-in',
          );
        }
      }
      changes.sso_required = patch.ssoRequired;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const { data, error } = await this.db()
      .from('school_email_domain')
      .update(changes)
      .eq('id', id)
      .select(DOMAIN_COLUMNS)
      .single();
    if (error || !data) throw new BadRequestException('Failed to update the domain');
    return this.toDomain(data);
  }

  /** Removing a domain stops new joins; nobody already in is removed. */
  async remove(adminUserId: string, id: string) {
    const schoolId = await this.adminSchool(adminUserId);
    await this.loadOwn(schoolId, id);
    const { error } = await this.db().from('school_email_domain').delete().eq('id', id);
    if (error) throw new BadRequestException('Failed to remove the domain');
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

    const { data, error } = await this.db()
      .from('school_email_domain')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', id)
      .select(DOMAIN_COLUMNS)
      .single();

    if (error?.code === '23505') {
      throw new ConflictException('Another school has already verified this domain');
    }
    if (error || !data) throw new BadRequestException('Failed to verify the domain');
    return this.toDomain(data);
  }

  // ── joining ───────────────────────────────────────────────────────────────

  /**
   * The school a signed-in user's address would put them in, if any. Only
   * users without a school, and only a domain for their kind of account: a
   * student address does not make someone staff, and the other way round.
   */
  async matchFor(userId: string, email: string | null | undefined): Promise<DomainMatch | null> {
    const domain = domainOfEmail(email);
    if (!domain) return null;

    const { data: profile } = await this.db()
      .from('user_profile')
      .select('school_id, account_type, first_name')
      .eq('id', userId)
      .maybeSingle();
    if (!profile || profile.school_id || !profile.first_name) return null;

    const audience: AccountAudience =
      profile.account_type === 'student' ? 'student' : 'staff';

    const { data } = await this.db()
      .from('school_email_domain')
      .select('id, domain, audience, auto_join, school_id, school:school_id(name, is_active)')
      .eq('domain', domain)
      .in('audience', [audience, 'any'])
      .not('verified_at', 'is', null)
      .maybeSingle();

    const school = data?.school as { name?: string; is_active?: boolean } | null | undefined;
    if (!data || school?.is_active === false) return null;

    return {
      domainId: data.id as string,
      domain: data.domain as string,
      schoolId: data.school_id as string,
      schoolName: school?.name ?? 'your school',
      audience,
      // A student on a shared domain joins outright, like on a student one;
      // staff get whatever the domain says.
      autoJoin: audience === 'student' ? true : (data.auto_join as boolean),
    };
  }

  async join(userId: string, email: string | null | undefined): Promise<DomainJoinResult> {
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
      this.logger.warn(`Auto-join by domain failed for ${userId}: ${(err as Error).message}`);
      return null;
    }
  }

  private async joinMatch(userId: string, match: DomainMatch): Promise<DomainJoinResult> {
    const supabase = this.db();

    if (match.audience === 'staff' && !match.autoJoin) {
      const { error } = await supabase
        .from('school_join_request')
        .insert({
          user_id: userId,
          school_id: match.schoolId,
          message: `Signed in with an @${match.domain} address`,
        });
      // A pending request already exists: that is the outcome we wanted.
      if (error && error.code !== '23505') {
        this.logger.error(`Failed to file join request: ${error.message}`);
        throw new BadRequestException('Failed to ask to join the school');
      }
      return { status: 'requested', schoolId: match.schoolId };
    }

    const { data: domainRow } = await supabase
      .from('school_email_domain')
      .select('staff_role')
      .eq('id', match.domainId)
      .maybeSingle();

    const { error } = await supabase.rpc('join_school_by_email_domain', {
      p_user_id: userId,
      p_school_id: match.schoolId,
      p_audience: match.audience,
      p_staff_role: (domainRow?.staff_role as DomainStaffRole | undefined) ?? 'teacher',
    });

    if (error) {
      if (`${error.message}`.includes('already_in_a_school')) {
        throw new ConflictException('This account already belongs to a school');
      }
      this.logger.error(`Domain join failed for ${userId}: ${error.message}`);
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
    return { status: 'joined', schoolId: match.schoolId, audience: match.audience };
  }

  // ── sign-in ───────────────────────────────────────────────────────────────

  /** The verified domain an address belongs to, if a school owns it. */
  async verifiedDomainFor(email: string | null | undefined): Promise<VerifiedDomain | null> {
    const domain = domainOfEmail(email);
    if (!domain) return null;
    const { data } = await this.db()
      .from('school_email_domain')
      .select(DOMAIN_COLUMNS)
      .eq('domain', domain)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (!data) return null;
    const d = data;
    return {
      id: d.id,
      schoolId: d.school_id,
      domain: d.domain,
      audience: d.audience,
      autoJoin: d.auto_join,
      ssoProvider: d.sso_provider,
      ssoRequired: d.sso_required,
      azureTenantId: d.azure_tenant_id,
    };
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
    return adapter ? { providerId: adapter.id, label: adapter.label } : null;
  }
}
