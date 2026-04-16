import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../src/createApp.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let cachedApp: NestFastifyApplication | null = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  cachedApp = await createApp();
  return cachedApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  fastify.server.emit('request', req, res);
}