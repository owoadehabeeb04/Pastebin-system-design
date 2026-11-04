import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from './config';
import { Note } from './note.entity';
import { Init1700000000000 } from './migrations/1700000000000-init';

export const dbOptions = (): DataSourceOptions => ({
  type: 'postgres',
  url: config().databaseUrl,
  entities: [Note],
  migrations: [Init1700000000000],
  extra: { max: 20, connectionTimeoutMillis: 2000 }, // pool size per API container; fail fast if Postgres is down
});

export const newDataSource = () => new DataSource(dbOptions());
