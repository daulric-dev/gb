import { createApp } from './createApp.js';

async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}

bootstrap();
