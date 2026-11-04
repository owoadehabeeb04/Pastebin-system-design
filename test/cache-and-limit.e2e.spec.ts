import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { cacheKey } from '../src/cache.service';
import { rateKey } from '../src/rate-limit.guard';
import { RedisService } from '../src/redis.service';
import { Shards } from '../src/shards';
import { createApp } from './helpers';

describe('Redis cache and rate limit', () => {
  let app: NestExpressApplication;
  let redis: RedisService['client'];
  let shards: Shards;
  const http = () => request(app.getHttpServer());
  const create = (extra = {}) => http().post('/pastes').send({ text: 'hello', type: 'plain_text', expiresIn: 120, ...extra });

  beforeAll(async () => {
    app = await createApp();
    redis = app.get(RedisService).client;
    shards = app.get(Shards);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await redis.flushdb();
    await shards.all()[0].query('DELETE FROM notes');
    process.env.CACHE_ENABLED = 'true';
    process.env.RATE_LIMIT_PER_MIN = '0';
  });

  describe('cache', () => {
    it('fills Redis on the first read, with a TTL no longer than the time left', async () => {
      const { body } = await create().expect(201);
      expect(await redis.exists(cacheKey(body.code))).toBe(0);
      await http().get(`/pastes/${body.code}`).expect(200);
      const ttl = await redis.pttl(cacheKey(body.code));
      expect(ttl).toBeGreaterThan(100_000);
      expect(ttl).toBeLessThanOrEqual(120_000);
    });

    it('serves from Redis when Postgres no longer has the row', async () => {
      const { body } = await create().expect(201);
      await http().get(`/pastes/${body.code}`).expect(200);
      await shards.forCode(body.code).delete({ code: body.code });
      await http().get(`/pastes/${body.code}`).expect(200); // proves the second read came from Redis
    });

    it('returns 404 for an expired paste even if it is still in Redis', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      await redis.set(cacheKey('abcdefg'), JSON.stringify({ code: 'abcdefg', text: 'old', type: 'plain_text', language: null, expiresAt: past }), 'EX', 600);
      await http().get('/pastes/abcdefg').expect(404);
    });

    it('caches a 404 for at most 30 seconds', async () => {
      await http().get('/pastes/short').expect(404); // bad format: never touches Redis
      expect(await redis.exists(cacheKey('short'))).toBe(0);
      await http().get('/pastes/Missing').expect(404);
      const ttl = await redis.pttl(cacheKey('Missing'));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30_000);
    });

    it('uses the cached 404 instead of asking Postgres again', async () => {
      await http().get('/pastes/Missing').expect(404);
      await shards.forCode('Missing').insert({ code: 'Missing', text: 'x', s3Key: null, type: 'plain_text', language: null, deviceInfo: null, expiresAt: new Date(Date.now() + 60_000) });
      await http().get('/pastes/Missing').expect(404); // still the cached answer
      await redis.del(cacheKey('Missing'));
      await http().get('/pastes/Missing').expect(200);
    });

    it('does not touch Redis when CACHE_ENABLED=false', async () => {
      process.env.CACHE_ENABLED = 'false';
      const { body } = await create().expect(201);
      await http().get(`/pastes/${body.code}`).expect(200);
      await http().get('/pastes/Missing').expect(404);
      expect(await redis.keys('paste:*')).toEqual([]);
    });
  });

  describe('rate limit', () => {
    it('allows 10 pastes a minute from one IP, blocks the 11th with 429, and works again after the minute', async () => {
      process.env.RATE_LIMIT_PER_MIN = '10';
      for (let i = 0; i < 10; i++) await create().expect(201);
      await create().expect(429);
      await create().expect(429);

      const [key] = await redis.keys('rate:*');
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      expect(await redis.ttl(key)).toBeLessThanOrEqual(60);
      await redis.pexpire(key, 1); // fast-forward: the minute is over
      await new Promise((r) => setTimeout(r, 20));
      await create().expect(201);
    });

    it('counts each IP separately, using X-Forwarded-For from the proxy', async () => {
      process.env.RATE_LIMIT_PER_MIN = '1';
      await create().set('X-Forwarded-For', '1.1.1.1').expect(201);
      await create().set('X-Forwarded-For', '1.1.1.1').expect(429);
      await create().set('X-Forwarded-For', '2.2.2.2').expect(201);
      expect(await redis.exists(rateKey('1.1.1.1'))).toBe(1);
    });

    it('does not limit reads', async () => {
      process.env.RATE_LIMIT_PER_MIN = '1';
      const { body } = await create().expect(201);
      for (let i = 0; i < 5; i++) await http().get(`/pastes/${body.code}`).expect(200);
    });
  });
});
