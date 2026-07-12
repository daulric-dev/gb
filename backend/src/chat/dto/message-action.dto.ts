import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** Act on a system message's inline action (accept / dismiss). */
export class MessageActionDto {
  @ApiProperty({ enum: ['accept', 'dismiss'] })
  @IsIn(['accept', 'dismiss'])
  action!: 'accept' | 'dismiss';
}
