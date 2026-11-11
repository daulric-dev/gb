import { createApp } from './createApp.js';
import { startupWarnings, validateStartupConfig } from './config/startup.js';

async function bootstrap() {
  validateStartupConfig();
  for (const warning of startupWarnings()) console.warn(`[startup] ${warning}`);
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}

async function main() {
  await bootstrap();
}

main().catch((err: Error) => {
  console.error('Error starting application', err);
  process.exit(1);
});
