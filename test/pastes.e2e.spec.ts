import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CodeGenerator } from '../src/code.generator';
import { Shards } from '../src/shards';
import { createApp } from './helpers';

describe('pastes API (Postgres)', () => {
  let app: NestExpressApplication;
  let shards: Shards;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.CACHE_ENABLED = 'false'; // these tests are about Postgres alone; the cache has its own file
    app = await createApp();
    shards = app.get(Shards);
  });
  afterAll(async () => {
    await app.close();
    process.env.CACHE_ENABLED = 'true';
  });
  beforeEach(() => shards.all()[0].query('DELETE FROM notes'));

  it('creates a paste and reads it back', async () => {
    const res = await http().post('/pastes').send({ text: 'console.log(1)', type: 'code', language: 'js', expiresIn: 120 }).expect(201);
    expect(res.body.code).toMatch(/^[0-9a-zA-Z]{7}$/);
    expect(res.body.url).toContain(`/pastes/${res.body.code}`);
    const got = await http().get(`/pastes/${res.body.code}`).expect(200);
    expect(got.body).toEqual({ code: res.body.code, text: 'console.log(1)', type: 'code', language: 'js', expiresAt: res.body.expiresAt });
  });

  it('stores the User-Agent as device_info', async () => {
    const { body } = await http().post('/pastes').set('User-Agent', 'test-agent/1').send({ text: 'x', type: 'plain_text' }).expect(201);
    const row = await shards.forCode(body.code).findOneByOrFail({ code: body.code });
    expect(row.deviceInfo).toBe('test-agent/1');
  });

  it('accepts 10,000 characters and rejects 10,001 with 400', async () => {
    await http().post('/pastes').send({ text: 'a'.repeat(10_000), type: 'plain_text' }).expect(201);
    await http().post('/pastes').send({ text: 'a'.repeat(10_001), type: 'plain_text' }).expect(400);
  });

  it('returns 400 for empty text and bad expiresIn', async () => {
    await http().post('/pastes').send({ text: '', type: 'plain_text' }).expect(400);
    await http().post('/pastes').send({ text: 'x', type: 'plain_text', expiresIn: 5 }).expect(400);
  });

  it('returns 404 for an unknown code and for a malformed code', async () => {
    await http().get('/pastes/zzzzzzz').expect(404);
    await http().get('/pastes/short').expect(404);
  });

  it('returns 404 once expires_at has passed (checked on read, in Postgres)', async () => {
    const { body } = await http().post('/pastes').send({ text: 'x', type: 'plain_text', expiresIn: 60 }).expect(201);
    await http().get(`/pastes/${body.code}`).expect(200);
    await shards.forCode(body.code).update({ code: body.code }, { expiresAt: new Date(Date.now() - 1000) });
    await http().get(`/pastes/${body.code}`).expect(404);
  });
});

describe('code collisions', () => {
  it('retries with a new code when the first one is taken', async () => {
    const next = jest.fn<string, []>();
    const app = await createApp((b) => b.overrideProvider(CodeGenerator).useValue({ next }));
    const http = () => request(app.getHttpServer());
    await app.get(Shards).all()[0].query('DELETE FROM notes');

    next.mockReturnValueOnce('AAAAAAA');
    const first = await http().post('/pastes').send({ text: 'one', type: 'plain_text' }).expect(201);
    expect(first.body.code).toBe('AAAAAAA');

    next.mockClear().mockReturnValueOnce('AAAAAAA').mockReturnValueOnce('BBBBBBB'); // same code once, then a new one
    const second = await http().post('/pastes').send({ text: 'two', type: 'plain_text' }).expect(201);
    expect(second.body.code).toBe('BBBBBBB');
    expect(next).toHaveBeenCalledTimes(2);
    expect((await http().get('/pastes/AAAAAAA')).body.text).toBe('one'); // the first paste was not overwritten

    next.mockClear().mockReturnValue('AAAAAAA'); // always taken: gives up after 5 tries
    await http().post('/pastes').send({ text: 'three', type: 'plain_text' }).expect(500);
    expect(next).toHaveBeenCalledTimes(5);
    await app.close();
  });
});
