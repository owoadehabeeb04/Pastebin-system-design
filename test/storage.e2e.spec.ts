import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CodeGenerator } from '../src/code.generator';
import { Shards } from '../src/shards';
import { StorageService } from '../src/storage.service';
import { createApp } from './helpers';

describe('large pastes (S3)', () => {
  let app: NestExpressApplication;
  let shards: Shards;
  let storage: StorageService;
  const http = () => request(app.getHttpServer());
  const create = (text: string) => http().post('/pastes').send({ text, type: 'plain_text' });

  beforeAll(async () => {
    process.env.CACHE_ENABLED = 'false';
    app = await createApp();
    shards = app.get(Shards);
    storage = app.get(StorageService);
  });
  afterAll(async () => {
    await app.close();
    process.env.CACHE_ENABLED = 'true';
  });
  beforeEach(() => shards.all()[0].query('DELETE FROM notes'));

  // 'é' is 2 bytes, so 5120 of them are exactly 10,240 bytes (10 KB) and 5121 are over.
  it('keeps a paste of exactly 10 KB in Postgres', async () => {
    const { body } = await create('é'.repeat(5120)).expect(201);
    const row = await shards.forCode(body.code).findOneByOrFail({ code: body.code });
    expect(row.text).toHaveLength(5120);
    expect(row.s3Key).toBeNull();
  });

  it('stores a paste over 10 KB in S3 and reads it back identically', async () => {
    const text = 'é€😀 line\n'.repeat(1000); // 9,000 characters but 15,000 bytes
    expect(Buffer.byteLength(text)).toBeGreaterThan(10 * 1024);
    expect([...text].length).toBeLessThanOrEqual(10_000);

    const { body } = await create(text).expect(201);
    const row = await shards.forCode(body.code).findOneByOrFail({ code: body.code });
    expect(row.text).toBeNull();
    expect(row.s3Key).toMatch(/^pastes\//);
    expect(await storage.get(row.s3Key!)).toBe(text);

    const got = await http().get(`/pastes/${body.code}`).expect(200);
    expect(got.body.text).toBe(text);
  });

  it('removes the S3 file if no code could be saved', async () => {
    const next = jest.fn(() => 'AAAAAAA');
    const app2 = await createApp((b) => b.overrideProvider(CodeGenerator).useValue({ next }));
    const store = app2.get(StorageService);
    const deleted = jest.spyOn(store, 'deleteMany');
    await request(app2.getHttpServer()).post('/pastes').send({ text: 'a', type: 'plain_text' }).expect(201);
    await request(app2.getHttpServer()).post('/pastes').send({ text: 'é'.repeat(6000), type: 'plain_text' }).expect(500);
    expect(deleted).toHaveBeenCalledTimes(1);
    await expect(store.get(deleted.mock.calls[0][0][0])).rejects.toThrow();
    await app2.close();
  });
});
