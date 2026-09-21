import { createApp } from '../src/createApp';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let cachedApp: NestFastifyApplication | null = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  cachedApp = await createApp();
  return cachedApp;
}

export default async function handler(req: Request, res: Response) {
  const app = await getApp();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  fastify.server.emit('request', req, res);
}
