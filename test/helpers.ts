import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { newDataSource } from '../src/db';
import { setup } from '../src/setup';

// Creates the test database tables (idempotent) via the real migration.
export async function migrateTestDb() {
  const ds = await newDataSource().initialize();
  await ds.runMigrations();
  await ds.destroy();
}

export async function createApp(override?: (b: ReturnType<typeof Test.createTestingModule>) => void) {
  await migrateTestDb();
  const builder = Test.createTestingModule({ imports: [AppModule] });
  override?.(builder);
  const app = (await builder.compile()).createNestApplication<NestExpressApplication>();
  setup(app);
  await app.init();
  return app;
}
