import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ImagesService } from './images.service';

/**
 * Public avatar images. `user_profile.avatar_url` points here and every client
 * renders it as a plain image source, with no credentials - the same exposure
 * the old public `images` bucket had. Only `avatars/<file>` is reachable.
 */
@ApiTags('Images')
@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get('avatars/:name')
  @ApiProduces('image/*')
  async avatar(@Param('name') name: string, @Res() reply: FastifyReply) {
    const image = await this.images.readAvatar(`avatars/${name}`);
    if (!image) throw new NotFoundException('Avatar not found');

    reply
      .header('Content-Type', image.contentType)
      // URLs carry a ?t= cache-buster that changes on every upload.
      .header('Cache-Control', 'public, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox');
    if (image.size !== null) reply.header('Content-Length', image.size);
    return reply.send(image.body);
  }
}
