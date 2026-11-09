import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE users (
        id          BIGSERIAL PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE notes (
        code         CHAR(7) PRIMARY KEY,
        user_id      BIGINT REFERENCES users(id),
        text         TEXT,
        s3_key       TEXT,
        type         TEXT NOT NULL CHECK (type IN ('code', 'plain_text')),
        language     TEXT,
        device_info  TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ NOT NULL,
        CONSTRAINT notes_text_xor_s3 CHECK ((text IS NULL) <> (s3_key IS NULL))
      )`);
    await q.query(`CREATE INDEX notes_expires_at_idx ON notes (expires_at)`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE notes`);
    await q.query(`DROP TABLE users`);
  }
}
