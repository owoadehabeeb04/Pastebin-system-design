import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './config';
import { setup } from './setup';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  setup(app);
  app.enableShutdownHooks();
  const server = await app.listen(config().port, '0.0.0.0');
  server.keepAliveTimeout = 65_000; // longer than Nginx's 60s idle timeout, so Nginx never reuses a connection Node just closed
}
main();
