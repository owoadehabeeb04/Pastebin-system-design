import { NestExpressApplication } from '@nestjs/platform-express';

// Shared by main.ts and the tests.
export function setup(app: NestExpressApplication) {
  // Nginx is the one proxy in front: believe its X-Forwarded-For so req.ip is the real client.
  app.set('trust proxy', 1);
}
