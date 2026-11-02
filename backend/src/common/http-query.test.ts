import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  Body,
  Controller,
  Param,
  QueryMethod,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  METHOD_METADATA,
  PARAMTYPES_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { CourseController } from '@/course/course.controller';
import { ListCoursesQueryDto } from '@/course/dto/course.dto';
import { StudentController } from '@/student/student.controller';
import { ListStudentsQueryDto } from '@/student/dto/list-students.query.dto';
import { FileManagerController } from '@/file-manager/file-manager.controller';
import { ListFilesQueryDto } from '@/file-manager/dto/list-files.query.dto';
import { FileListFilter } from '@/file-manager/dto/list-files.filter';
import { BrowseFolderQueryDto } from '@/file-manager/dto/browse-folder.query.dto';
import { ChatController } from '@/chat/chat.controller';
import { ListMessagesQueryDto } from '@/chat/dto/list-messages.query.dto';
import { CourseNotificationController } from '@/course-notification/course-notification.controller';
import { ListCourseNotificationsQueryDto } from '@/course-notification/dto/course-notification.dto';
import { OrganisationController } from '@/organisation/organisation.controller';
import { InviteController } from '@/organisation/invite.controller';
import { SignInController } from '@/organisation/sign-in.controller';
import {
  ListInvitesQueryDto,
  ListOrganisationSchoolsQueryDto,
} from '@/organisation/dto/organisation.dto';
import { SchoolController } from '@/school/school.controller';
import { ListSsoAuditQueryDto } from '@/sso/sso-audit.dto';
import { acceptEmptyQueryBodies, CORS_METHODS } from './http-query';

/** Every route that moved from GET + query string to QUERY + JSON body. */
const QUERY_ROUTES: [controller: any, handler: string, path: string, dto: any][] = [
  [CourseController, 'list', '/', ListCoursesQueryDto],
  [StudentController, 'findAll', '/', ListStudentsQueryDto],
  [FileManagerController, 'list', '/', ListFilesQueryDto],
  [FileManagerController, 'browseFolder', 'folders/contents', BrowseFolderQueryDto],
  [ChatController, 'listMessages', 'conversations/:id/messages', ListMessagesQueryDto],
  [CourseNotificationController, 'list', '/', ListCourseNotificationsQueryDto],
  [OrganisationController, 'schools', 'schools', ListOrganisationSchoolsQueryDto],
  [InviteController, 'list', '/', ListInvitesQueryDto],
  [SchoolController, 'getSsoAudit', 'current/sso/audit', ListSsoAuditQueryDto],
  [SignInController, 'schoolSsoAudit', 'schools/:id/sso/audit', ListSsoAuditQueryDto],
];

/** The app's global pipe (createApp.ts), as the body goes through it. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (dto: any, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: dto, data: undefined });

describe('QUERY routes', () => {
  test.each(QUERY_ROUTES)('%p.%s is QUERY %s with a body DTO', (controller, handler, path, dto) => {
    const fn = controller.prototype[handler];
    expect(RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)]).toBe('QUERY');
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);

    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) ?? {};
    const body = Object.values(args as Record<string, { index: number }>).find(
      (_, i) => Object.keys(args)[i].startsWith(`${RouteParamtypes.BODY}:`),
    );
    expect(body).toBeDefined();
    const types = Reflect.getMetadata(PARAMTYPES_METADATA, controller.prototype, handler);
    expect(types[body!.index]).toBe(dto);
  });

  test.each(QUERY_ROUTES)('%p.%s: an empty body is every default', async (_c, _h, _p, dto) => {
    for (const empty of [undefined, null, {}]) {
      const value = await validate(dto, empty);
      expect(value).toBeInstanceOf(dto);
    }
  });

  test.each(QUERY_ROUTES)('%p.%s: an unknown property is a 400', async (_c, _h, _p, dto) => {
    await expect(validate(dto, { nope: 1 })).rejects.toThrow(BadRequestException);
  });

  test('defaults and accepted values', async () => {
    expect(await validate(ListFilesQueryDto, undefined)).toMatchObject({ filter: FileListFilter.All });
    expect(await validate(ListOrganisationSchoolsQueryDto, undefined)).toMatchObject({ status: 'all' });
    expect(
      await validate(ListOrganisationSchoolsQueryDto, { search: '  north ', status: 'inactive' }),
    ).toMatchObject({ search: 'north', status: 'inactive' });
    expect(await validate(ListCourseNotificationsQueryDto, { unread: true, limit: 10 })).toMatchObject({
      unread: true,
      limit: 10,
    });
    expect(await validate(ListSsoAuditQueryDto, { limit: 200 })).toMatchObject({ limit: 200 });
    expect(await validate(ListInvitesQueryDto, { kind: 'school_admin' })).toMatchObject({
      kind: 'school_admin',
    });
    expect(await validate(ListStudentsQueryDto, { search: 'ada', page: 2 })).toMatchObject({
      search: 'ada',
      page: 2,
    });
  });

  test.each([
    [ListCoursesQueryDto, { status: 'gone' }],
    [ListCoursesQueryDto, { termId: 'not-a-uuid' }],
    [ListStudentsQueryDto, { pageSize: 101 }],
    [ListStudentsQueryDto, { search: 'x'.repeat(101) }],
    [ListFilesQueryDto, { filter: 'mine' }],
    [ListFilesQueryDto, { page: 0 }],
    [BrowseFolderQueryDto, { folderId: 'root' }],
    [ListMessagesQueryDto, { before: 'yesterday' }],
    [ListMessagesQueryDto, { limit: 101 }],
    [ListCourseNotificationsQueryDto, { limit: 0 }],
    [ListOrganisationSchoolsQueryDto, { status: 'closed' }],
    [ListInvitesQueryDto, { kind: 'teacher' }],
    [ListSsoAuditQueryDto, { limit: 201 }],
    [ListSsoAuditQueryDto, { limit: 1.5 }],
    [ListSsoAuditQueryDto, { before: 'e9' }],
  ])('%p rejects %o with a 400', async (dto, body) => {
    await expect(validate(dto, body)).rejects.toThrow(BadRequestException);
  });
});

// ── over HTTP: Fastify routes QUERY and parses its body ─────────────────────

@Controller('things')
class ThingsController {
  @QueryMethod()
  list(@Body() dto: ListCoursesQueryDto) {
    return { dto, isDto: dto instanceof ListCoursesQueryDto };
  }

  @QueryMethod(':id/items')
  items(@Param('id') id: string, @Body() dto: ListSsoAuditQueryDto) {
    return { id, dto };
  }
}

@Module({ controllers: [ThingsController] })
class ThingsModule {}

describe('QUERY over Fastify', () => {
  let app: NestFastifyApplication;
  const ORIGIN = 'https://school.example';

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(ThingsModule, new FastifyAdapter(), {
      logger: false,
    });
    // As createApp.ts sets it up.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(pipe);
    acceptEmptyQueryBodies(app.getHttpAdapter().getInstance());
    app.enableCors({
      origin: (origin, cb) => cb(null, origin === ORIGIN),
      credentials: true,
      methods: CORS_METHODS,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const inject = (opts: Record<string, unknown>) =>
    app.getHttpAdapter().getInstance().inject(opts as any);

  test('a QUERY with a JSON body reaches the handler as the DTO', async () => {
    const res = await inject({
      method: 'QUERY',
      url: '/api/things',
      payload: { status: 'draft' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dto: { status: 'draft' }, isDto: true });
  });

  test('path params still work next to the body', async () => {
    const res = await inject({
      method: 'QUERY',
      url: '/api/things/t-1/items',
      payload: { limit: 5 },
    });
    expect(res.json()).toEqual({ id: 't-1', dto: { limit: 5 } });
  });

  test('no body, or an empty JSON body, is every default (not a 400)', async () => {
    const bare = await inject({ method: 'QUERY', url: '/api/things' });
    expect(bare.statusCode).toBe(200);
    expect(bare.json()).toEqual({ dto: {}, isDto: true });

    const empty = await inject({
      method: 'QUERY',
      url: '/api/things',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ dto: {}, isDto: true });
  });

  test('a bad filter, an unknown filter or broken JSON is a 400', async () => {
    for (const payload of [{ status: 'gone' }, { nope: true }, '{"status":']) {
      const res = await inject({
        method: 'QUERY',
        url: '/api/things',
        headers: { 'content-type': 'application/json' },
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
      expect(res.statusCode).toBe(400);
    }
  });

  test('the old GET is gone: 404', async () => {
    const res = await inject({ method: 'GET', url: '/api/things?status=draft' });
    expect(res.statusCode).toBe(404);
  });

  test('CORS preflight allows QUERY with a JSON body', async () => {
    const res = await inject({
      method: 'OPTIONS',
      url: '/api/things',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'QUERY',
        'access-control-request-headers': 'content-type,x-api-version',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(String(res.headers['access-control-allow-methods']).split(/,\s*/)).toContain('QUERY');
  });
});
