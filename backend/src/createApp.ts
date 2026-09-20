import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import { isOriginAllowed } from './config/origins';
import cookie from '@fastify/cookie';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );

  await app.register(cookie);

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

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

  const raw_instance = app.getHttpAdapter().getInstance();

  raw_instance.get('/', (req, res) => {
    res.send('gb for life');
  });

  raw_instance.get('/health', (req, res) => {
    res.status(200).send('ok');
  });

  app.enableCors({
    // A function, because the web app is not the only browser client any more:
    // the mobile app served over Expo web arrives from its own origin, on an
    // address that changes with the DHCP lease. Native React Native sends no
    // Origin header, so CORS never applies there.
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Version'],
    exposedHeaders: ['Content-Disposition'],
  });

  await app.init();
  return app;
}
