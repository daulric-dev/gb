import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Start (or reuse) a direct conversation with another user in the school. */
export class CreateConversationDto {
  @ApiProperty({ description: 'The other user to message.' })
  @IsUUID()
  userId!: string;
}
