import { IsIn, IsOptional } from 'class-validator';
import { CreateAnnouncementDto } from './create-announcement.dto';
import { UpdateAnnouncementDto } from './update-announcement.dto';

/**
 * Who a school-wide announcement is for. `staff` is today's staff notice;
 * `everyone` also reaches the school's students and their parents. Kept as a
 * list so further audiences (e.g. `students`, `parents`) slot in later.
 */
export const ANNOUNCEMENT_AUDIENCES = ['staff', 'everyone'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/** POST /api/announcements. Course posts use CreateAnnouncementDto (no audience). */
export class CreateSchoolAnnouncementDto extends CreateAnnouncementDto {
  /** Defaults to `staff`. */
  @IsOptional()
  @IsIn(ANNOUNCEMENT_AUDIENCES)
  audience?: AnnouncementAudience;
}

/** PATCH /api/announcements/:id. Changing the audience is allowed and audited. */
export class UpdateSchoolAnnouncementDto extends UpdateAnnouncementDto {
  @IsOptional()
  @IsIn(ANNOUNCEMENT_AUDIENCES)
  audience?: AnnouncementAudience;
}
