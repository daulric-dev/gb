import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { CreateSchoolDto } from './dto/create-school.dto';

const SCHOOL_TTL = 60 * 60 * 24 * 30;

@Injectable()
export class SchoolService {
  private readonly logger = new Logger(SchoolService.name);
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async findAll() {
    const cached = await this.cache.get('schools:all');
    if (cached) return cached;

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('school')
      .select('id, name, parish, school_type')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch schools: ${error.message}`);
      return [];
    }

    await this.cache.set('schools:all', data, SCHOOL_TTL);
    return data;
  }

  async create(dto: CreateSchoolDto, userId: string) {
    if (process.env.DEDICATED_DEPLOYMENT === 'true') {
      const supabase = this.supabaseService.getServiceClient();
      const { count } = await supabase
        .from('school')
        .select('id', { count: 'exact', head: true });

      if ((count ?? 0) > 0) {
        throw new ForbiddenException(
          'School creation is disabled on dedicated deployments',
        );
      }
    }

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('school')
      .insert({
        name: dto.name,
        code: dto.code ?? null,
        school_type: dto.schoolType,
        parish: dto.parish,
        address: dto.address ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        is_active: true,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create school: ${error?.message}`);
      throw new BadRequestException('Failed to create school');
    }

    // Canonical membership record - creator is admin
    const { error: managementError } = await supabase
      .from('school_management')
      .insert({ user_id: userId, school_id: data.id, role: 'admin' });

    if (managementError) {
      this.logger.error(
        `Failed to create school_management row for ${userId} at ${data.id}: ${managementError.message}`,
      );
    }

    // Mirror to user_profile (denormalized cache for active school + role)
    const { error: profileError } = await supabase
      .from('user_profile')
      .update({ school_id: data.id, role: 'admin' })
      .eq('id', userId);

    if (profileError) {
      this.logger.error(
        `Failed to assign creator ${userId} to school ${data.id}: ${profileError.message}`,
      );
    }

    await this.cache.delete(`profile:${userId}`);
    await this.cache.update<any[]>(
      'schools:all',
      (list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)),
      SCHOOL_TTL,
    );
    return data;
  }

  async createJoinRequest(userId: string, schoolId: string, message?: string) {
    const supabase = this.supabaseService.getServiceClient();

    // Verify the school exists and is active
    const { data: school } = await supabase
      .from('school')
      .select('id, name')
      .eq('id', schoolId)
      .eq('is_active', true)
      .single();

    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Bootstrap rule: if this school has no admin yet, auto-assign this user
    // as admin instead of creating a request (orphaned school takeover).
    const { data: existingAdmin } = await supabase
      .from('school_management')
      .select('id')
      .eq('school_id', schoolId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (!existingAdmin) {
      const { error: managementError } = await supabase
        .from('school_management')
        .upsert(
          { user_id: userId, school_id: schoolId, role: 'admin' },
          { onConflict: 'user_id,school_id' },
        );

      if (managementError) {
        this.logger.error(
          `Failed to auto-assign admin for ${userId} at ${schoolId}: ${managementError.message}`,
        );
        throw new BadRequestException('Failed to join school');
      }

      const { error: profileError } = await supabase
        .from('user_profile')
        .update({ school_id: schoolId, role: 'admin', is_active: true })
        .eq('id', userId);

      if (profileError) {
        this.logger.error(
          `Failed to update profile for ${userId}: ${profileError.message}`,
        );
        throw new BadRequestException('Failed to join school');
      }

      await this.cache.delete(`profile:${userId}`);
      return { autoJoined: true, school };
    }

    // Prevent duplicate pending requests across any school
    const { data: existing } = await supabase
      .from('school_join_request')
      .select('id, school_id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      throw new BadRequestException(
        'You already have a pending join request. Please wait for it to be reviewed.',
      );
    }

    const { data, error } = await supabase
      .from('school_join_request')
      .insert({
        user_id: userId,
        school_id: schoolId,
        message: message ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to create join request for user ${userId}: ${error?.message}`,
      );
      throw new BadRequestException('Failed to submit join request');
    }

    return { ...data, school };
  }

  async getPendingRequests(adminUserId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: adminProfile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', adminUserId)
      .single();

    if (!adminProfile?.school_id) {
      throw new BadRequestException('Admin is not assigned to a school');
    }

    const { data, error } = await supabase
      .from('school_join_request')
      .select(
        `id, status, message, requested_at,
         user:user_id ( id, first_name, last_name ),
         school:school_id ( id, name )`,
      )
      .eq('school_id', adminProfile.school_id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch join requests: ${error.message}`);
      throw new BadRequestException('Failed to fetch join requests');
    }

    return data ?? [];
  }

  async approveRequest(
    adminUserId: string,
    requestId: string,
    role: 'admin' | 'member' | 'teacher',
  ) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: adminProfile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', adminUserId)
      .single();

    if (!adminProfile?.school_id) {
      throw new BadRequestException('Admin is not assigned to a school');
    }

    const { data: request } = await supabase
      .from('school_join_request')
      .select('id, user_id, school_id, status')
      .eq('id', requestId)
      .single();

    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    if (request.school_id !== adminProfile.school_id) {
      throw new ForbiddenException(
        'This request does not belong to your school',
      );
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }

    // Canonical membership record (upsert in case a prior membership exists for this pair)
    const { error: managementError } = await supabase
      .from('school_management')
      .upsert(
        {
          user_id: request.user_id,
          school_id: request.school_id,
          role,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,school_id' },
      );

    if (managementError) {
      this.logger.error(
        `Failed to upsert school_management for ${request.user_id}: ${managementError.message}`,
      );
      throw new BadRequestException('Failed to approve request');
    }

    // Mirror to user_profile (denormalized cache)
    const { error: profileError } = await supabase
      .from('user_profile')
      .update({ school_id: request.school_id, role, is_active: true })
      .eq('id', request.user_id);

    if (profileError) {
      this.logger.error(
        `Failed to update profile for user ${request.user_id}: ${profileError.message}`,
      );
      throw new BadRequestException('Failed to approve request');
    }

    const { data: updated, error } = await supabase
      .from('school_join_request')
      .update({
        status: 'approved',
        reviewed_by: adminUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) {
      this.logger.error(
        `Failed to update join request ${requestId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to approve request');
    }

    await this.cache.delete(`profile:${request.user_id}`);
    return updated;
  }

  async getMyPendingRequest(userId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data } = await supabase
      .from('school_join_request')
      .select('id, school_id, status, requested_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    return data;
  }

  async getMembers(userId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (!profile?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const { data, error } = await supabase
      .from('school_management')
      .select(
        `id, role, created_at,
         user:user_id ( id, first_name, last_name, avatar_url )`,
      )
      .eq('school_id', profile.school_id)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch school members: ${error.message}`);
      throw new BadRequestException('Failed to fetch school members');
    }

    return data ?? [];
  }

  async leaveSchool(userId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('school_id, role')
      .eq('id', userId)
      .single();

    if (!profile?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }

    if (profile.role === 'admin') {
      const { count } = await supabase
        .from('school_management')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', profile.school_id)
        .eq('role', 'admin');

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          'You are the only admin. Assign another admin before leaving.',
        );
      }
    }

    await supabase
      .from('school_management')
      .delete()
      .eq('user_id', userId)
      .eq('school_id', profile.school_id);

    await supabase
      .from('user_profile')
      .update({ school_id: null, role: null })
      .eq('id', userId);

    await this.cache.delete(`profile:${userId}`);
    return { left: true };
  }

  async removeMember(adminUserId: string, membershipId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: adminProfile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', adminUserId)
      .single();

    if (!adminProfile?.school_id) {
      throw new BadRequestException('Admin is not assigned to a school');
    }

    const { data: membership } = await supabase
      .from('school_management')
      .select('id, user_id, school_id, role')
      .eq('id', membershipId)
      .single();

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    if (membership.school_id !== adminProfile.school_id) {
      throw new ForbiddenException(
        'This membership does not belong to your school',
      );
    }

    if (membership.user_id === adminUserId) {
      throw new BadRequestException('You cannot remove yourself');
    }

    if (membership.role === 'admin') {
      throw new ForbiddenException('You cannot remove another admin');
    }

    const { error } = await supabase
      .from('school_management')
      .delete()
      .eq('id', membershipId);

    if (error) {
      this.logger.error(
        `Failed to remove member ${membershipId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to remove member');
    }

    await supabase
      .from('user_profile')
      .update({ school_id: null, role: null })
      .eq('id', membership.user_id);

    await this.cache.delete(`profile:${membership.user_id}`);
    return { removed: true };
  }

  async rejectRequest(adminUserId: string, requestId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: adminProfile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', adminUserId)
      .single();

    if (!adminProfile?.school_id) {
      throw new BadRequestException('Admin is not assigned to a school');
    }

    const { data: request } = await supabase
      .from('school_join_request')
      .select('id, school_id, status')
      .eq('id', requestId)
      .single();

    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    if (request.school_id !== adminProfile.school_id) {
      throw new ForbiddenException(
        'This request does not belong to your school',
      );
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }

    const { data: updated, error } = await supabase
      .from('school_join_request')
      .update({
        status: 'rejected',
        reviewed_by: adminUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) {
      this.logger.error(
        `Failed to reject join request ${requestId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to reject request');
    }

    return updated;
  }
}
