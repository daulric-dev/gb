import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  insecureCookieWarning,
  isOriginAllowed,
  primaryOrigin,
  sharedCookieDomainWarning,
} from './config/origins';
import cookie from '@fastify/cookie';
import { acceptEmptyQueryBodies, CORS_METHODS } from './common/http-query';
import { AppExceptionFilter } from './common/exception.filter';
import { HealthService } from './health/health.service';
import { isInternalPeer } from './health/health-peer';
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

  // The mobile app opens `<server>/privacy`, and the server it knows is this
  // API: send it on to the web app's privacy notice.
  raw_instance.get('/privacy', (_, res) => {
    const origin = primaryOrigin();
    if (!origin) return res.status(404).send('Not found');
    return res.redirect(`${origin}/privacy`, 302);
  });

  // Which dependency is down is operational detail, so it only goes to
  // callers on the private network (Compose, the cluster). Everyone else gets
  // the verdict and the same status code, which is all a load balancer needs.
  raw_instance.get('/health', async (req, res) => {
    const health = await app.get(HealthService).check();
    const status = health.status === 'ok' ? 200 : 503;
    if (!isInternalPeer(req)) {
      res.status(status).send({ status: health.status });
      return;
    }
    res.status(status).send(health);
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
  const authLog = new Logger('Auth');
  for (const warning of [insecureCookieWarning(), sharedCookieDomainWarning()]) {
    if (warning) authLog.warn(warning);
  }

  return app;
}
