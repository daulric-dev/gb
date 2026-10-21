import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * The database, through Prisma 7 and the `pg` driver adapter. The adapter
 * is what lets the same client run in a container, on serverless Node, or on
 * Workers with a pooled connection string - nothing here is host-specific.
 *
 * The API connects as an owner role and enforces access in code, as it did
 * with the Supabase service-role client; row-level security never applied
 * to these queries.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  onModuleInit(): void {
    // Fail loudly but do not block boot: the first query reconnects.
    this.$connect().catch((err: Error) =>
      this.logger.error(`Database connection failed: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
