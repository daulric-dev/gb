import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
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

  async create(dto: CreateSchoolDto) {
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

    await this.cache.update<any[]>(
      'schools:all',
      (list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)),
      SCHOOL_TTL,
    );
    return data;
  }
}
