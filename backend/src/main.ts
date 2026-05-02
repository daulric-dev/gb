import { createApp } from './createApp.js';

async function bootstrap() {
  const app = await createApp();

  app.use((req, res, next) => {
    res.setHeader('X-Server-Port', process.env.PORT || '3000');
    console.log(`Port: ${req.socket.localPort}`);
    next();
  });
  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}

bootstrap();
