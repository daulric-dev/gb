import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { insecureCookieWarning, isOriginAllowed } from './config/origins';
import cookie from '@fastify/cookie';
import { acceptEmptyQueryBodies, CORS_METHODS } from './common/http-query';
import { AppExceptionFilter } from './common/exception.filter';
import { HealthService } from './health/health.service';
import { registerCsrfProtection, useBodyParsers } from './common/csrf';

const trustProxyHops = (() => {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  const value = Number.isInteger(hops) && hops >= 0 ? hops : 1;
  return () => value;
})();

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: (_address: string, hop: number) => hop < trustProxyHops(),
    }),
  );

  await app.register(cookie);

  const raw_instance = app.getHttpAdapter().getInstance();

  registerCsrfProtection(raw_instance);
  useBodyParsers(app);

  console.log(`Running in ${process.env.NODE_ENV} mode`);

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('gb api')
      .setDescription('api docs')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  
  app.useGlobalFilters(new AppExceptionFilter(app.getHttpAdapter()));

  acceptEmptyQueryBodies(raw_instance);

  raw_instance.get('/', (_, res) => {
    res.send('gb');
  });

  raw_instance.get('/health', async (_, res) => {
    const health = await app.get(HealthService).check();
    res.status(health.status === 'ok' ? 200 : 503).send(health);
  });

  app.enableCors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    credentials: true,
    // QUERY (search and filter lists) is preflighted; it must be listed.
    methods: CORS_METHODS,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Version',
      'X-GradeBook-Client',
      'X-GradeBook-Device',
      'X-GradeBook-App-Version',
    ],
    exposedHeaders: ['Content-Disposition'],
  });

  await app.init();
  const cookieWarning = insecureCookieWarning();
  if (cookieWarning) new Logger('Auth').warn(cookieWarning);

  return app;
}
