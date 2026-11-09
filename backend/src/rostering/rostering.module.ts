import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { DynamicModule } from '@nestjs/common';
import { OrganisationModule } from '@/organisation/organisation.module';
import { QUEUE_ROSTER_SYNC } from './rostering.constants';
import { RosteringController } from './rostering.controller';
import { RosteringFeatureGuard } from './rostering-feature.guard';
import { RosterSourceService } from './roster-source.service';
import { RosterRunService } from './roster-run.service';
import { RosterStateService } from './roster-state.service';
import { RosterApplyService } from './roster-apply.service';
import { RosterClaimService } from './roster-claim.service';
import { RosteringScheduler } from './rostering.scheduler';
import { RosteringProcessor } from './rostering.processor';

/**
 * Rostering sync (feature `rostering`, organisation only). With Redis
 * (USE_REDIS=true and REDIS_URL, sharing QueueModule's BullMQ connection)
 * dry runs and applies are jobs on the `roster-sync` queue; otherwise they
 * run in this process after the request answers. OrganisationModule gives
 * the guard and InviteService (staff invites).
 */
@Module({})
export class RosteringModule {
  static forRoot(): DynamicModule {
    const useRedis = process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;
    if (!useRedis) new Logger(RosteringModule.name).log('Redis disabled — rostering syncs run in-process');
    return {
      module: RosteringModule,
      imports: [OrganisationModule, ...(useRedis ? [BullModule.registerQueue({ name: QUEUE_ROSTER_SYNC })] : [])],
      controllers: [RosteringController],
      providers: [
        RosteringFeatureGuard,
        RosterSourceService,
        RosterRunService,
        RosterStateService,
        RosterApplyService,
        RosterClaimService,
        RosteringScheduler,
        ...(useRedis ? [RosteringProcessor] : []),
      ],
    };
  }
}
