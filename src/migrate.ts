import { newDataSource } from './db';

// Run once before the API containers start (see docker-compose.yml).
(async () => {
  const ds = await newDataSource().initialize();
  const done = await ds.runMigrations();
  console.log(`migrations run: ${done.map((m) => m.name).join(', ') || 'none (up to date)'}`);
  await ds.destroy();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
