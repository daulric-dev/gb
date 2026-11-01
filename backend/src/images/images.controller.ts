import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { IMAGE_AREAS, ImagesService } from './images.service';

/**
 * Public avatar images. `user_profile.avatar_url` points here and every client
 * renders it as a plain image source, with no credentials - the same exposure
 * the old public `images` bucket had. Only `avatars/<file>` and the
 * `IMAGE_AREAS` (course banners, school logos) are reachable.
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

  /**
   * Course banners and school logos. Same exposure as avatars: public, but
   * every name carries 128 random bits and changes on each upload, so only
   * someone who was shown the URL (a member of that school) can fetch it.
   */
  @Get(':area/:name')
  @ApiProduces('image/*')
  async image(
    @Param('area') area: string,
    @Param('name') name: string,
    @Res() reply: FastifyReply,
  ) {
    if (!(IMAGE_AREAS as readonly string[]).includes(area)) {
      throw new NotFoundException('Image not found');
    }
    const image = await this.images.readPublicImage(`${area}/${name}`);
    if (!image) throw new NotFoundException('Image not found');

    reply
      .header('Content-Type', image.contentType)
      // A new upload gets a new name, so a cached copy is never stale.
      .header('Cache-Control', 'public, max-age=604800, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox');
    if (image.size !== null) reply.header('Content-Length', image.size);
    return reply.send(image.body);
  }
}
