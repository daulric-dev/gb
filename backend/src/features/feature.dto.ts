import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** PATCH /organisation/features and /schools/current/features. */
export class UpdateFeaturesDto {
  @ApiProperty({
    example: { student_messaging: true, chat_channels: false },
    description: 'Feature key to on/off. Unknown keys are a 400.',
  })
  @IsObject()
  features!: Record<string, boolean>;
}
