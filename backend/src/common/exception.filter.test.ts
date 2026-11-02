import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  Module,
  Post,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerException } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import type { FastifyReply } from 'fastify';
import { AppExceptionFilter, GENERIC_ERROR_MESSAGE } from './exception.filter';
import { stepUpRequired } from '@/auth/step-up.guard';

class NameDto {
  @IsString()
  name!: string;
}

const PRISMA_TEXT =
  'Invalid `prisma.user.findUnique()` invocation:\n\n  at /app/src/user.service.ts:12:3';

@Controller('t')
class TestController {
  @Get('type-error')
  typeError() {
    return (undefined as any).boom;
  }

  @Get('prisma')
  prisma() {
    throw new Error(PRISMA_TEXT);
  }

  @Get('string')
  thrownString() {
    throw 'raw string';
  }

  @Get('bad-request')
  badRequest() {
    throw new BadRequestException('Name is required');
  }

  @Get('feature')
  feature() {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'FEATURE_DISABLED',
      message: 'This feature is turned off.',
    });
  }

  @Get('step-up')
  stepUp() {
    throw stepUpRequired();
  }

  @Get('update')
  update() {
    throw new HttpException({ statusCode: 426, code: 'update_required', minVersion: '2.0.0' }, 426);
  }

  @Get('throttled')
  throttled() {
    throw new ThrottlerException();
  }

  @Post('body')
  body(@Body() dto: NameDto) {
    return dto;
  }

  @Get('sent')
  sent(@Res() reply: FastifyReply) {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/plain' });
    reply.raw.write('partial');
    throw new Error('after send');
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

describe('AppExceptionFilter', () => {
  let app: NestFastifyApplication;
  const logged: string[] = [];

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      TestModule,
      new FastifyAdapter({ bodyLimit: 1024 }),
      { logger: false },
    );
    // As createApp.ts sets it up.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AppExceptionFilter(app.getHttpAdapter()));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    spyOn(Logger.prototype, 'error').mockImplementation(((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    }) as any);
  });

  afterAll(async () => {
    await app.close();
  });

  const inject = (opts: Record<string, unknown>) =>
    app.getHttpAdapter().getInstance().inject(opts as any);

  test('an unknown error is a generic 500 with an error id, and is logged in full', async () => {
    logged.length = 0;
    const res = await inject({ method: 'GET', url: '/api/t/type-error' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toEqual({
      statusCode: 500,
      message: GENERIC_ERROR_MESSAGE,
      errorId: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(res.body).not.toContain('TypeError');
    expect(logged.join('\n')).toContain(`[${body.errorId}] GET /api/t/type-error`);
    expect(logged.join('\n')).toContain('TypeError');
  });

  test('Prisma text and stack frames never reach the client', async () => {
    logged.length = 0;
    const res = await inject({ method: 'GET', url: '/api/t/prisma' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('prisma');
    expect(res.body).not.toContain('/app/src');
    expect(logged.join('\n')).toContain('Invalid `prisma.user.findUnique()`');
  });

  test('a thrown non-Error is a generic 500', async () => {
    const res = await inject({ method: 'GET', url: '/api/t/string' });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe(GENERIC_ERROR_MESSAGE);
  });

  test('HttpExceptions are unchanged', async () => {
    const res = await inject({ method: 'GET', url: '/api/t/bad-request' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      statusCode: 400,
      message: 'Name is required',
      error: 'Bad Request',
    });
  });

  test('custom-code bodies are unchanged', async () => {
    const feature = await inject({ method: 'GET', url: '/api/t/feature' });
    expect(feature.statusCode).toBe(403);
    expect(feature.json()).toEqual({
      statusCode: 403,
      code: 'FEATURE_DISABLED',
      message: 'This feature is turned off.',
    });

    const stepUp = await inject({ method: 'GET', url: '/api/t/step-up' });
    expect(stepUp.statusCode).toBe(403);
    expect(stepUp.json()).toEqual(stepUpRequired().getResponse());

    const update = await inject({ method: 'GET', url: '/api/t/update' });
    expect(update.statusCode).toBe(426);
    expect(update.json()).toEqual({ statusCode: 426, code: 'update_required', minVersion: '2.0.0' });
  });

  test('throttler 429s are unchanged', async () => {
    const res = await inject({ method: 'GET', url: '/api/t/throttled' });
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toBe('ThrottlerException: Too Many Requests');
  });

  test('validation 400s list the problems as before', async () => {
    const res = await inject({ method: 'POST', url: '/api/t/body', payload: { name: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toEqual(['name must be a string']);
  });

  test('Fastify errors keep their status and short message', async () => {
    const notFound = await inject({ method: 'GET', url: '/api/nope' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().message).toBe('Cannot GET /api/nope');

    const badJson = await inject({
      method: 'POST',
      url: '/api/t/body',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().statusCode).toBe(400);

    const tooLarge = await inject({
      method: 'POST',
      url: '/api/t/body',
      payload: { name: 'x'.repeat(2048) },
    });
    expect(tooLarge.statusCode).toBe(413);
  });

  test('a response already sent is ended, not rewritten', async () => {
    const res = await inject({ method: 'GET', url: '/api/t/sent' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('partial');
  });
});
